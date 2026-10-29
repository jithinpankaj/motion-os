import type { Db } from '../db';
import type { SceneDocument } from '../../shared/scene/schema';
import { uid } from '../../shared/util/random';

/** Immutable snapshot of a scene (named versions, restore points, community publishing). */
export async function snapshotSceneVersion(db: Db, wsId: string, sceneId: string, doc: SceneDocument, note: string, userId: string | null, branch = 'main', parent: string | null = null) {
  const next = await db.one(`SELECT coalesce(max(version), 0) + 1 AS v FROM scene_versions WHERE scene_id = $1`, [sceneId]);
  const id = uid('sv');
  await db.query(
    `INSERT INTO scene_versions (id, scene_id, workspace_id, version, branch, parent_version_id, doc, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, sceneId, wsId, next!.v, branch, parent, JSON.stringify(doc), note, userId],
  );
  return { id, version: next!.v as number };
}
