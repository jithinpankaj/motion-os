import { Router, type Request } from 'express';
import { z } from 'zod';
import { createSession, hashPassword, newToken, requireUser, setSessionCookie, sha256, verifyPassword, SESSION_COOKIE } from '../auth';
import { HttpError, badRequest, parse, rateLimit } from '../http';
import { provisionWorkspace, addMember } from '../services/workspace';
import { uid } from '../../shared/util/random';
import { DEMO_USERS } from '../seed';

const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(10, 'Use at least 10 characters').max(200);
const authLimit = rateLimit({ name: 'auth', windowMs: 60_000, max: 20, key: (r) => r.ip ?? 'ip' });

export function authRoutes() {
  const r = Router();

  r.post('/auth/register', authLimit, async (req, res) => {
    const body = parse(z.object({ email, name: z.string().trim().min(1).max(80), password, workspaceName: z.string().trim().max(80).optional(), inviteToken: z.string().optional() }), req.body);
    const { db } = req.ctx;
    if (await db.one(`SELECT 1 FROM users WHERE lower(email) = $1`, [body.email])) throw new HttpError(409, 'email_taken', 'An account with this email already exists. Try signing in.');
    const userId = uid('usr');
    await db.query(`INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)`, [userId, body.email, body.name, await hashPassword(body.password)]);
    if (body.inviteToken) await acceptInvite(req, body.inviteToken, userId, body.email);
    else await provisionWorkspace(db, userId, body.workspaceName || `${body.name.split(' ')[0]}'s Studio`);
    setSessionCookie(res, await createSession(db, userId, req), req.ctx.isProd);
    res.status(201).json({ ok: true });
  });

  r.post('/auth/login', authLimit, async (req, res) => {
    const body = parse(z.object({ email, password: z.string().max(200) }), req.body);
    const u = await req.ctx.db.one(`SELECT id, password_hash FROM users WHERE lower(email) = $1`, [body.email]);
    // Same work and same message whether or not the account exists.
    const ok = u ? await verifyPassword(body.password, u.password_hash) : (await hashPassword(body.password), false);
    if (!u || !ok) throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
    setSessionCookie(res, await createSession(req.ctx.db, u.id, req), req.ctx.isProd);
    res.json({ ok: true });
  });

  r.post('/auth/logout', async (req, res) => {
    if (req.user) await req.ctx.db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [req.user.sessionId]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.post('/auth/reset/request', authLimit, async (req, res) => {
    const body = parse(z.object({ email }), req.body);
    const u = await req.ctx.db.one(`SELECT id, email FROM users WHERE lower(email) = $1`, [body.email]);
    if (u) {
      const token = newToken();
      await req.ctx.db.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`, [sha256(token), u.id]);
      await req.ctx.db.query(`INSERT INTO dev_mailbox (to_email, subject, body) VALUES ($1, $2, $3)`, [u.email, 'Reset your Twylo password', `/reset?token=${token}`]);
    }
    res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
  });

  r.post('/auth/reset/confirm', authLimit, async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
    const { db } = req.ctx;
    const row = await db.one(`SELECT * FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [sha256(body.token)]);
    if (!row) throw badRequest('This reset link is invalid or has expired. Request a new one.');
    await db.tx(async (tx) => {
      await tx.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [row.user_id, await hashPassword(body.password)]);
      await tx.query(`UPDATE password_resets SET used_at = now() WHERE token_hash = $1`, [row.token_hash]);
      await tx.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [row.user_id]);
    });
    res.json({ ok: true });
  });

  r.get('/invitations/:token', async (req, res) => {
    const inv = await req.ctx.db.one(
      `SELECT i.email, i.role_keys, w.name AS workspace FROM invitations i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
      [sha256(String(req.params.token))],
    );
    if (!inv) throw new HttpError(404, 'invite_invalid', 'This invitation is invalid or has expired');
    res.json({ email: inv.email, roles: inv.role_keys, workspace: inv.workspace });
  });

  r.post('/invitations/:token/accept', requireUser, async (req, res) => {
    const wsId = await acceptInvite(req, String(req.params.token), req.user!.id, req.user!.email);
    res.json({ ok: true, workspaceId: wsId });
  });

  // Development mail sink so reset and invitation flows are testable without an SMTP provider.
  r.get('/dev/mailbox', async (req, res) => {
    if (req.ctx.isProd) throw new HttpError(404, 'not_found', 'Not found');
    const rows = await req.ctx.db.query(`SELECT to_email, subject, body, created_at FROM dev_mailbox WHERE lower(to_email) = lower($1) ORDER BY id DESC LIMIT 10`, [String(req.query.email ?? '')]);
    res.json({ messages: rows });
  });

  // Development sign-in without a password, limited to seeded demo accounts and loopback callers.
  // Off in production; set DEV_AUTO_LOGIN=0 to turn it off locally.
  const devLoginEnabled = (req: Request) => {
    const ip = req.socket.remoteAddress ?? '';
    return !req.ctx.isProd && process.env.DEV_AUTO_LOGIN !== '0' && (ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('127.'));
  };
  r.get('/dev/accounts', (req, res) => {
    if (!devLoginEnabled(req)) throw new HttpError(404, 'not_found', 'Not found');
    res.json({ accounts: DEMO_USERS.map(({ email, name, roles }) => ({ email, name, roles })) });
  });
  r.post('/auth/dev-login', async (req, res) => {
    if (!devLoginEnabled(req)) throw new HttpError(404, 'not_found', 'Not found');
    const body = parse(z.object({ email: email.optional() }), req.body ?? {});
    const target = body.email ?? process.env.DEV_LOGIN_EMAIL?.toLowerCase() ?? DEMO_USERS[0].email;
    if (!DEMO_USERS.some((u) => u.email === target)) throw badRequest('Only seeded demo accounts can use development sign-in');
    const u = await req.ctx.db.one(`SELECT id FROM users WHERE lower(email) = $1`, [target]);
    if (!u) throw new HttpError(404, 'not_found', 'Demo account not seeded');
    setSessionCookie(res, await createSession(req.ctx.db, u.id, req), false);
    res.json({ ok: true, email: target });
  });

  r.get('/session', async (req, res) => {
    if (!req.user) { res.json({ user: null }); return; }
    const { db } = req.ctx;
    const rows = await db.query(
      `SELECT w.id, w.name, array_agg(DISTINCT r.key) AS roles, array_agg(DISTINCT rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL) AS perms
         FROM workspace_memberships m JOIN workspaces w ON w.id = m.workspace_id
         JOIN membership_roles mr ON mr.membership_id = m.id JOIN roles r ON r.id = mr.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE m.user_id = $1 AND m.status = 'active' GROUP BY w.id, w.name ORDER BY w.name`,
      [req.user.id],
    );
    const workspaces = [];
    for (const w of rows) {
      const brands = await db.query(`SELECT id, name FROM brands WHERE workspace_id = $1 ORDER BY created_at`, [w.id]);
      const teams = await db.query(`SELECT t.id, t.name FROM team_memberships tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = $1 AND t.workspace_id = $2`, [req.user.id, w.id]);
      workspaces.push({ id: w.id, name: w.name, roles: w.roles, permissions: w.perms ?? [], brands, teams });
    }
    res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name }, workspaces });
  });

  r.get('/auth/sessions', requireUser, async (req, res) => {
    const rows = await req.ctx.db.query(`SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [req.user!.id]);
    res.json({ sessions: rows.map((s) => ({ ...s, id: s.id.slice(0, 12), current: s.id === req.user!.sessionId })) });
  });

  r.delete('/auth/sessions/:prefix', requireUser, async (req, res) => {
    await req.ctx.db.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND left(id, 12) = $2`, [req.user!.id, String(req.params.prefix)]);
    res.json({ ok: true });
  });

  r.post('/auth/password', requireUser, async (req, res) => {
    const body = parse(z.object({ current: z.string().max(200), password }), req.body);
    const u = await req.ctx.db.one(`SELECT password_hash FROM users WHERE id = $1`, [req.user!.id]);
    if (!(await verifyPassword(body.current, u!.password_hash))) throw badRequest('Current password is incorrect');
    await req.ctx.db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [req.user!.id, await hashPassword(body.password)]);
    await req.ctx.db.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2`, [req.user!.id, req.user!.sessionId]);
    res.json({ ok: true });
  });

  return r;
}

async function acceptInvite(req: any, token: string, userId: string, userEmail: string) {
  const { db } = req.ctx;
  const inv = await db.one(`SELECT * FROM invitations WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()`, [sha256(token)]);
  if (!inv) throw new HttpError(404, 'invite_invalid', 'This invitation is invalid or has expired');
  if (inv.email.toLowerCase() !== userEmail.toLowerCase()) throw new HttpError(403, 'invite_email_mismatch', `This invitation was sent to ${inv.email}`);
  await db.tx(async (tx: any) => {
    await addMember(tx, inv.workspace_id, userId, inv.role_keys, inv.team_ids);
    await tx.query(`UPDATE invitations SET accepted_at = now() WHERE id = $1`, [inv.id]);
    await tx.query(`INSERT INTO audit_events (workspace_id, actor_id, action, subject_type, subject_id, data) VALUES ($1, $2, 'member.join', 'user', $2, $3)`, [inv.workspace_id, userId, JSON.stringify({ roles: inv.role_keys })]);
  });
  return inv.workspace_id as string;
}
