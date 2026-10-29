import type { Db } from '../db';
import { uid } from '../../shared/util/random';
import { PERMISSIONS, SYSTEM_ROLES } from '../../shared/permissions';
import { DEFAULT_BRAND_TOKENS } from '../../shared/brand';
import { CHANNEL_FORMATS } from '../../shared/formats';

export async function ensureGlobals(db: Db) {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.query(`INSERT INTO permissions (key, description) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`, [key, description]);
  }
  for (const f of CHANNEL_FORMATS) {
    await db.query(
      `INSERT INTO channel_presets (id, name, platform, width, height, safe_area) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, width = EXCLUDED.width, height = EXCLUDED.height, safe_area = EXCLUDED.safe_area`,
      [f.id, f.name, f.platform, f.width, f.height, JSON.stringify(f.safe)],
    );
  }
}

export const TEAM_NAMES = ['Design', 'Marketing', 'Engineering', 'Operations'];

/** Create organisation + workspace with system roles, default teams and a default brand. */
export async function provisionWorkspace(db: Db, ownerId: string, name: string) {
  return db.tx(async (tx) => {
    const orgId = uid('org'), wsId = uid('ws');
    await tx.query(`INSERT INTO organisations (id, name) VALUES ($1, $2)`, [orgId, name]);
    await tx.query(`INSERT INTO workspaces (id, organisation_id, name, slug) VALUES ($1, $2, $3, $4)`, [wsId, orgId, name, slugify(name)]);
    for (const r of SYSTEM_ROLES) {
      const roleId = uid('role');
      await tx.query(`INSERT INTO roles (id, workspace_id, key, name, description, is_system) VALUES ($1, $2, $3, $4, $5, true)`, [roleId, wsId, r.key, r.name, r.description]);
      for (const p of r.permissions) await tx.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)`, [roleId, p]);
    }
    const teamIds: Record<string, string> = {};
    for (const t of TEAM_NAMES) {
      teamIds[t] = uid('team');
      await tx.query(`INSERT INTO teams (id, workspace_id, name, slug) VALUES ($1, $2, $3, $4)`, [teamIds[t], wsId, t, slugify(t)]);
    }
    const brandId = uid('brand');
    await tx.query(`INSERT INTO brands (id, workspace_id, name, slug) VALUES ($1, $2, $3, $4)`, [brandId, wsId, `${name} Brand`, 'primary']);
    for (const t of DEFAULT_BRAND_TOKENS) {
      await tx.query(`INSERT INTO brand_tokens (id, brand_id, workspace_id, key, category, value, description) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [uid('tok'), brandId, wsId, t.key, t.category, JSON.stringify(t.value), t.description]);
    }
    await tx.query(`INSERT INTO token_versions (id, brand_id, workspace_id, version, snapshot, note, created_by) VALUES ($1, $2, $3, 1, $4, 'Initial brand tokens', $5)`, [uid('tv'), brandId, wsId, JSON.stringify(DEFAULT_BRAND_TOKENS), ownerId]);
    await addMember(tx, wsId, ownerId, ['owner'], [teamIds.Design]);
    return { workspaceId: wsId, brandId, teamIds };
  });
}

export async function addMember(db: Db, wsId: string, userId: string, roleKeys: string[], teamIds: string[]) {
  let m = await db.one(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [wsId, userId]);
  if (!m) {
    m = { id: uid('mem') };
    await db.query(`INSERT INTO workspace_memberships (id, workspace_id, user_id) VALUES ($1, $2, $3)`, [m.id, wsId, userId]);
  }
  await setMemberRoles(db, wsId, m.id, roleKeys);
  for (const t of teamIds) await db.query(`INSERT INTO team_memberships (team_id, user_id) SELECT id, $2 FROM teams WHERE id = $1 AND workspace_id = $3 ON CONFLICT DO NOTHING`, [t, userId, wsId]);
  return m.id as string;
}

export async function setMemberRoles(db: Db, wsId: string, membershipId: string, roleKeys: string[]) {
  const roles = await db.query(`SELECT id, key FROM roles WHERE workspace_id = $1 AND key = ANY($2::text[])`, [wsId, roleKeys]);
  if (roles.length !== new Set(roleKeys).size) throw new Error('unknown role');
  await db.query(`DELETE FROM membership_roles WHERE membership_id = $1`, [membershipId]);
  for (const r of roles) await db.query(`INSERT INTO membership_roles (membership_id, role_id) VALUES ($1, $2)`, [membershipId, r.id]);
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'workspace';
