import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db';
import { HttpError, forbidden } from './http';
import type { PermissionKey } from '../shared/permissions';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
export const SESSION_COOKIE = 'mos_session';
const SESSION_DAYS = 14;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: 8, p: 1 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export async function createSession(db: Db, userId: string, req: Request) {
  const token = newToken();
  await db.query(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days', $3, $4)`,
    [sha256(token), userId, req.ip ?? null, String(req.headers['user-agent'] ?? '').slice(0, 300)],
  );
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  return token;
}

export function setSessionCookie(res: Response, token: string, secure: boolean) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_DAYS * 86400_000, path: '/' });
}

/** Attach req.user when a valid session cookie (or Bearer token) is present. */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  const token = req.cookies?.[SESSION_COOKIE] ?? bearer;
  if (token && typeof token === 'string') {
    const row = await req.ctx.db.one(
      `SELECT s.id AS sid, u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [sha256(token)],
    );
    if (row) {
      req.user = { id: row.id, email: row.email, name: row.name, sessionId: row.sid };
      req.ctx.db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.sid]).catch(() => {});
    }
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, 'unauthenticated', 'Please sign in to continue');
  next();
}

export async function loadMembership(db: Db, workspaceId: string, userId: string) {
  const rows = await db.query(
    `SELECT m.id AS mid, r.key AS role, rp.permission_key AS perm
       FROM workspace_memberships m
       JOIN membership_roles mr ON mr.membership_id = m.id
       JOIN roles r ON r.id = mr.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [workspaceId, userId],
  );
  if (!rows.length) return null;
  const teams = await db.query(
    `SELECT t.id FROM team_memberships tm JOIN teams t ON t.id = tm.team_id WHERE t.workspace_id = $1 AND tm.user_id = $2`,
    [workspaceId, userId],
  );
  return {
    id: workspaceId,
    membershipId: rows[0].mid as string,
    roles: [...new Set(rows.map((r) => r.role as string))],
    perms: new Set(rows.map((r) => r.perm as string).filter(Boolean)),
    teams: teams.map((t) => t.id as string),
  };
}

/**
 * Workspace boundary: every tenant route runs behind this. Membership and permissions are
 * re-read on every request so permission changes take effect immediately (even mid-edit).
 */
export async function requireWorkspace(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, 'unauthenticated', 'Please sign in to continue');
  const wsId = String(req.headers['x-workspace-id'] ?? req.query.ws ?? '');
  if (!wsId) throw new HttpError(400, 'workspace_required', 'Missing X-Workspace-Id header');
  const m = await loadMembership(req.ctx.db, wsId, req.user.id);
  if (!m) throw new HttpError(403, 'workspace_access_lost', 'You no longer have access to this workspace');
  req.ws = m;
  next();
}

export const requirePerm = (...keys: PermissionKey[]) => (req: Request, _res: Response, next: NextFunction) => {
  const missing = keys.filter((k) => !req.ws?.perms.has(k));
  if (missing.length) throw forbidden(`Missing permission: ${missing.join(', ')}`);
  next();
};

export const has = (req: Request, key: PermissionKey) => !!req.ws?.perms.has(key);
