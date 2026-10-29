import { Router } from 'express';
import { z } from 'zod';
import { newToken, requirePerm, sha256 } from '../auth';
import { badRequest, conflict, forbidden, notFound, parse } from '../http';
import { audit } from '../audit';
import { setMemberRoles, slugify } from '../services/workspace';
import { PERMISSIONS } from '../../shared/permissions';
import { uid } from '../../shared/util/random';

export function workspaceRoutes() {
  const r = Router();

  r.get('/workspace', requirePerm('workspace.view'), async (req, res) => {
    const { db } = req.ctx, ws = req.ws!.id;
    const workspace = await db.one(`SELECT id, name, slug, settings FROM workspaces WHERE id = $1`, [ws]);
    const members = await db.query(
      `SELECT u.id, u.name, u.email, m.status, m.created_at,
              coalesce(array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles,
              coalesce((SELECT array_agg(tm.team_id) FROM team_memberships tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = u.id AND t.workspace_id = $1), '{}') AS teams
         FROM workspace_memberships m JOIN users u ON u.id = m.user_id
         LEFT JOIN membership_roles mr ON mr.membership_id = m.id LEFT JOIN roles r ON r.id = mr.role_id
        WHERE m.workspace_id = $1 GROUP BY u.id, m.status, m.created_at ORDER BY m.created_at`,
      [ws],
    );
    const roles = await db.query(
      `SELECT r.id, r.key, r.name, r.description, r.is_system, coalesce(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id WHERE r.workspace_id = $1 GROUP BY r.id ORDER BY r.is_system DESC, r.name`,
      [ws],
    );
    const teams = await db.query(`SELECT id, name, slug FROM teams WHERE workspace_id = $1 ORDER BY name`, [ws]);
    const invitations = req.ws!.perms.has('members.manage')
      ? await db.query(`SELECT id, email, role_keys, created_at, expires_at FROM invitations WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [ws])
      : [];
    res.json({ workspace, members, roles, teams, invitations, permissionCatalog: PERMISSIONS });
  });

  r.post('/workspace/invitations', requirePerm('members.manage'), async (req, res) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), roles: z.array(z.string()).min(1).max(7), teams: z.array(z.string()).max(20).default([]) }), req.body);
    const { db } = req.ctx, ws = req.ws!.id;
    if (body.roles.includes('owner') && !req.ws!.roles.includes('owner')) throw forbidden('Only owners can invite owners');
    const known = await db.query(`SELECT key FROM roles WHERE workspace_id = $1 AND key = ANY($2::text[])`, [ws, body.roles]);
    if (known.length !== body.roles.length) throw badRequest('Unknown role');
    const token = newToken();
    const id = uid('inv');
    await db.query(`INSERT INTO invitations (id, workspace_id, email, role_keys, team_ids, token_hash, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '7 days')`, [id, ws, body.email, body.roles, body.teams, sha256(token), req.user!.id]);
    await db.query(`INSERT INTO dev_mailbox (to_email, subject, body) VALUES ($1, $2, $3)`, [body.email, `You're invited to Motion OS`, `/invite/${token}`]);
    await audit(db, req, 'permission.invite', 'invitation', id, { email: body.email, roles: body.roles });
    res.status(201).json({ id, link: `/invite/${token}`, delivery: 'Email delivery is not configured in this environment; share the link directly.' });
  });

  r.delete('/workspace/invitations/:id', requirePerm('members.manage'), async (req, res) => {
    await req.ctx.db.query(`DELETE FROM invitations WHERE id = $1 AND workspace_id = $2`, [req.params.id, req.ws!.id]);
    res.json({ ok: true });
  });

  r.put('/workspace/members/:userId/roles', requirePerm('members.manage'), async (req, res) => {
    const body = parse(z.object({ roles: z.array(z.string()).min(1).max(7) }), req.body);
    const { db } = req.ctx, ws = req.ws!.id;
    const m = await db.one(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [ws, req.params.userId]);
    if (!m) throw notFound('Member');
    const before = await db.query(`SELECT r.key FROM membership_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.membership_id = $1`, [m.id]);
    const touchesOwner = before.some((x) => x.key === 'owner') !== body.roles.includes('owner');
    if (touchesOwner && !req.ws!.roles.includes('owner')) throw forbidden('Only owners can grant or remove the owner role');
    if (before.some((x) => x.key === 'owner') && !body.roles.includes('owner')) {
      const owners = await db.one(`SELECT count(*)::int AS n FROM membership_roles mr JOIN roles r ON r.id = mr.role_id JOIN workspace_memberships m ON m.id = mr.membership_id WHERE r.key = 'owner' AND m.workspace_id = $1`, [ws]);
      if (owners!.n <= 1) throw conflict('A workspace needs at least one owner');
    }
    await db.tx((tx) => setMemberRoles(tx, ws, m.id, body.roles)).catch((e) => { throw badRequest(e.message); });
    await audit(db, req, 'permission.change', 'user', String(req.params.userId), { from: before.map((x) => x.key), to: body.roles });
    res.json({ ok: true });
  });

  r.put('/workspace/members/:userId/teams', requirePerm('members.manage'), async (req, res) => {
    const body = parse(z.object({ teams: z.array(z.string()).max(50) }), req.body);
    const { db } = req.ctx, ws = req.ws!.id;
    await db.tx(async (tx) => {
      await tx.query(`DELETE FROM team_memberships WHERE user_id = $1 AND team_id IN (SELECT id FROM teams WHERE workspace_id = $2)`, [req.params.userId, ws]);
      for (const t of body.teams) await tx.query(`INSERT INTO team_memberships (team_id, user_id) SELECT id, $2 FROM teams WHERE id = $1 AND workspace_id = $3`, [t, req.params.userId, ws]);
    });
    await audit(db, req, 'permission.teams', 'user', String(req.params.userId), { teams: body.teams });
    res.json({ ok: true });
  });

  r.delete('/workspace/members/:userId', requirePerm('members.manage'), async (req, res) => {
    const { db } = req.ctx, ws = req.ws!.id;
    if (req.params.userId === req.user!.id) throw badRequest('You cannot remove yourself');
    const isOwner = await db.one(`SELECT 1 FROM workspace_memberships m JOIN membership_roles mr ON mr.membership_id = m.id JOIN roles r ON r.id = mr.role_id WHERE m.workspace_id = $1 AND m.user_id = $2 AND r.key = 'owner'`, [ws, req.params.userId]);
    if (isOwner && !req.ws!.roles.includes('owner')) throw forbidden('Only owners can remove owners');
    await db.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [ws, req.params.userId]);
    await db.query(`DELETE FROM team_memberships WHERE user_id = $1 AND team_id IN (SELECT id FROM teams WHERE workspace_id = $2)`, [req.params.userId, ws]);
    await audit(db, req, 'permission.remove', 'user', String(req.params.userId));
    res.json({ ok: true });
  });

  r.post('/workspace/teams', requirePerm('members.manage'), async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    const id = uid('team');
    await req.ctx.db.query(`INSERT INTO teams (id, workspace_id, name, slug) VALUES ($1, $2, $3, $4)`, [id, req.ws!.id, body.name, slugify(body.name)]).catch(() => { throw conflict('A team with that name exists'); });
    res.status(201).json({ id });
  });

  r.post('/workspace/roles', requirePerm('roles.manage'), async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(40), description: z.string().max(200).default(''), permissions: z.array(z.string()).max(64) }), req.body);
    const bad = body.permissions.filter((p) => !(p in PERMISSIONS));
    if (bad.length) throw badRequest(`Unknown permissions: ${bad.join(', ')}`);
    const id = uid('role'), key = slugify(body.name).replace(/-/g, '_');
    await req.ctx.db.tx(async (tx) => {
      await tx.query(`INSERT INTO roles (id, workspace_id, key, name, description) VALUES ($1, $2, $3, $4, $5)`, [id, req.ws!.id, key, body.name, body.description]);
      for (const p of body.permissions) await tx.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)`, [id, p]);
    }).catch(() => { throw conflict('A role with that name exists'); });
    await audit(req.ctx.db, req, 'permission.role.create', 'role', id, { name: body.name, permissions: body.permissions });
    res.status(201).json({ id });
  });

  r.put('/workspace/roles/:roleId/permissions', requirePerm('roles.manage'), async (req, res) => {
    const body = parse(z.object({ permissions: z.array(z.string()).max(64) }), req.body);
    const { db } = req.ctx;
    const role = await db.one(`SELECT * FROM roles WHERE id = $1 AND workspace_id = $2`, [req.params.roleId, req.ws!.id]);
    if (!role) throw notFound('Role');
    if (role.key === 'owner') throw forbidden('The owner role always has every permission');
    const bad = body.permissions.filter((p) => !(p in PERMISSIONS));
    if (bad.length) throw badRequest(`Unknown permissions: ${bad.join(', ')}`);
    const before = await db.query(`SELECT permission_key FROM role_permissions WHERE role_id = $1`, [role.id]);
    await db.tx(async (tx) => {
      await tx.query(`DELETE FROM role_permissions WHERE role_id = $1`, [role.id]);
      for (const p of body.permissions) await tx.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)`, [role.id, p]);
    });
    await audit(db, req, 'permission.role.update', 'role', role.id, { role: role.key, from: before.map((b) => b.permission_key), to: body.permissions });
    res.json({ ok: true });
  });

  r.get('/audit', requirePerm('audit.view'), async (req, res) => {
    const rows = await req.ctx.db.query(
      `SELECT a.id, a.action, a.subject_type, a.subject_id, a.data, a.created_at, u.name AS actor FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id WHERE a.workspace_id = $1 ORDER BY a.id DESC LIMIT 200`,
      [req.ws!.id],
    );
    res.json({ events: rows });
  });

  return r;
}
