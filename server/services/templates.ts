import type { Db } from '../db';
import type { SceneDocument } from '../../shared/scene/schema';
import { deserializeScene } from '../../shared/scene/serialize';
import { uid } from '../../shared/util/random';
import { sceneAssetIds, syncAssetRefs } from './assets';

export async function snapshotSceneVersion(db: Db, wsId: string, sceneId: string, doc: SceneDocument, note: string, userId: string | null, branch = 'main', parent: string | null = null) {
  const next = await db.one(`SELECT coalesce(max(version), 0) + 1 AS v FROM scene_versions WHERE scene_id = $1`, [sceneId]);
  const id = uid('sv');
  await db.query(
    `INSERT INTO scene_versions (id, scene_id, workspace_id, version, branch, parent_version_id, doc, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, sceneId, wsId, next!.v, branch, parent, JSON.stringify(doc), note, userId],
  );
  return { id, version: next!.v as number };
}

/** Creates (or reuses) the template for a project and adds an immutable version in review. */
export async function submitTemplateVersion(db: Db, wsId: string, userId: string, projectId: string, meta: { name: string; description: string; category: string; channels: string[]; visibleTeamIds: string[]; changelog: string; interaction?: string }) {
  const scene = await db.one(`SELECT s.*, p.brand_id FROM motion_scenes s JOIN motion_projects p ON p.id = s.project_id WHERE s.project_id = $1 AND s.workspace_id = $2`, [projectId, wsId]);
  if (!scene) throw new Error('scene missing');
  const doc = deserializeScene(scene.doc);
  const sv = await snapshotSceneVersion(db, wsId, scene.id, doc, meta.changelog || 'Submitted for review', userId);
  let tpl = await db.one(`SELECT * FROM motion_templates WHERE project_id = $1 AND workspace_id = $2 AND status <> 'archived'`, [projectId, wsId]);
  const interaction = meta.interaction ?? (doc.interactions.length ? 'pointer' : 'none');
  if (!tpl) {
    tpl = { id: uid('tpl'), status: 'draft' };
    await db.query(
      `INSERT INTO motion_templates (id, workspace_id, project_id, brand_id, name, description, category, interaction, channels, visible_team_ids, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'review', $11)`,
      [tpl.id, wsId, projectId, scene.brand_id, meta.name, meta.description, meta.category, interaction, meta.channels, meta.visibleTeamIds, userId],
    );
  } else {
    await db.query(
      `UPDATE motion_templates SET name = $2, description = $3, category = $4, channels = $5, visible_team_ids = $6, interaction = $7,
              status = CASE WHEN status IN ('published', 'deprecated') THEN status ELSE 'review' END, updated_at = now() WHERE id = $1`,
      [tpl.id, meta.name, meta.description, meta.category, meta.channels, meta.visibleTeamIds, interaction],
    );
  }
  const v = await db.one(`SELECT coalesce(max(version), 0) + 1 AS v FROM template_versions WHERE template_id = $1`, [tpl.id]);
  const tvId = uid('tv');
  await db.query(
    `INSERT INTO template_versions (id, template_id, workspace_id, version, scene_version_id, status, changelog, created_by) VALUES ($1, $2, $3, $4, $5, 'review', $6, $7)`,
    [tvId, tpl.id, wsId, v!.v, sv.id, meta.changelog, userId],
  );
  for (const p of doc.exposed) {
    await db.query(`INSERT INTO template_parameters (id, template_version_id, workspace_id, key, definition) VALUES ($1, $2, $3, $4, $5)`, [uid('tp'), tvId, wsId, p.key, JSON.stringify(p)]);
  }
  // Cancel stale pending reviews of older versions of this template.
  await db.query(
    `UPDATE approval_requests SET status = 'cancelled', decided_at = now() WHERE workspace_id = $1 AND status = 'pending' AND subject_type = 'template_version'
       AND subject_id IN (SELECT id FROM template_versions WHERE template_id = $2 AND id <> $3)`,
    [wsId, tpl.id, tvId],
  );
  await db.query(`UPDATE template_versions SET status = 'draft' WHERE template_id = $1 AND id <> $2 AND status = 'review'`, [tpl.id, tvId]);
  const reqId = uid('apr');
  await db.query(`INSERT INTO approval_requests (id, workspace_id, subject_type, subject_id, requested_by, note) VALUES ($1, $2, 'template_version', $3, $4, $5)`, [reqId, wsId, tvId, userId, meta.changelog]);
  return { templateId: tpl.id as string, versionId: tvId, version: v!.v as number, approvalRequestId: reqId };
}

export async function approveTemplateVersion(db: Db, wsId: string, versionId: string, approve: boolean) {
  const tv = await db.one(`SELECT * FROM template_versions WHERE id = $1 AND workspace_id = $2`, [versionId, wsId]);
  if (!tv) throw new Error('version missing');
  await db.query(`UPDATE template_versions SET status = $2 WHERE id = $1`, [versionId, approve ? 'approved' : 'rejected']);
  await db.query(
    `UPDATE motion_templates SET status = CASE WHEN status IN ('published', 'deprecated') THEN status WHEN $2 THEN 'approved' ELSE 'draft' END, updated_at = now() WHERE id = $1`,
    [tv.template_id, approve],
  );
  return tv;
}

export async function publishTemplateVersion(db: Db, wsId: string, templateId: string, versionId: string) {
  const tv = await db.one(`SELECT tv.*, sv.doc FROM template_versions tv JOIN scene_versions sv ON sv.id = tv.scene_version_id WHERE tv.id = $1 AND tv.template_id = $2 AND tv.workspace_id = $3`, [versionId, templateId, wsId]);
  if (!tv) throw new Error('version missing');
  const doc = deserializeScene(tv.doc);
  const pins = await syncAssetRefs(db, wsId, 'template_version', versionId, sceneAssetIds(doc), true);
  await db.query(`UPDATE template_versions SET status = 'published', published_at = now(), asset_pins = $2 WHERE id = $1`, [versionId, JSON.stringify(pins)]);
  await db.query(`UPDATE motion_templates SET status = 'published', published_version_id = $2, updated_at = now() WHERE id = $1`, [templateId, versionId]);
  return { pins };
}

export type TemplateVersionRow = { id: string; version: number; template_id: string; status: string; asset_pins: Record<string, string>; published_at: string | null; changelog: string; doc: SceneDocument };

/** Load the immutable scene for a template version, plus parameters and pins. */
export async function loadTemplateVersion(db: Db, wsId: string, versionId: string) {
  const row = await db.one(
    `SELECT tv.id, tv.version, tv.template_id, tv.status, tv.asset_pins, tv.published_at, tv.changelog, sv.doc
       FROM template_versions tv JOIN scene_versions sv ON sv.id = tv.scene_version_id WHERE tv.id = $1 AND tv.workspace_id = $2`,
    [versionId, wsId],
  );
  if (!row) return undefined;
  return { ...row, doc: deserializeScene(row.doc) } as TemplateVersionRow;
}
