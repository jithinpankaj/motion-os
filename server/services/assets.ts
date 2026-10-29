import { forEachAction, mapActions } from '../../shared/motion/logic';
import type { Action } from '../../shared/scene/schema';
import type { Db } from '../db';
import type { SceneDocument } from '../../shared/scene/schema';
import { uid } from '../../shared/util/random';

/** Every asset id a scene depends on (image layers, mesh textures, fonts, image parameter options). */
export function sceneAssetIds(doc: SceneDocument): string[] {
  const ids = new Set<string>();
  for (const l of doc.layers) {
    if (l.type === 'image' && l.props.assetId) ids.add(l.props.assetId);
    if (l.type === 'mesh' && l.props.material.textureAssetId) ids.add(l.props.material.textureAssetId);
    if (l.type === 'text' && l.props.fontAssetId) ids.add(l.props.fontAssetId);
  }
  for (const r of doc.machine.rules) forEachAction([...r.do, ...(r.exit ?? [])], (a) => { if (a.type === 'sound' && a.assetId) ids.add(a.assetId); });
  return [...ids];
}

/** Rewrite asset ids in a scene (publishing to and remixing from the community copy assets). */
export function remapSceneAssets(doc: SceneDocument, map: Record<string, string | null>): SceneDocument {
  const m = (id: string | null) => (id && id in map ? map[id] : id);
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.type === 'image') return { ...l, props: { ...l.props, assetId: m(l.props.assetId) } };
      if (l.type === 'mesh') return { ...l, props: { ...l.props, material: { ...l.props.material, textureAssetId: m(l.props.material.textureAssetId) } } };
      if (l.type === 'text') return { ...l, props: { ...l.props, fontAssetId: m(l.props.fontAssetId) } };
      return l;
    }),
    machine: {
      ...doc.machine,
      // A sound whose file wasn't copied falls back to a built-in click rather than pointing nowhere.
      rules: doc.machine.rules.map((r) => { const fix = (list: Action[]) => mapActions(list, (a) => (a.type === 'sound' && a.assetId ? (m(a.assetId) ? { ...a, assetId: m(a.assetId) } : { ...a, assetId: null, sound: 'click' as const }) : a)); return { ...r, do: fix(r.do), ...(r.exit ? { exit: fix(r.exit) } : {}) }; }),
    },
  };
}

/**
 * Keep asset_references in sync for a referencing object. Drafts follow the current asset version
 * unless already pinned; template versions pin the exact version for reproducibility.
 */
export async function syncAssetRefs(db: Db, wsId: string, refType: 'scene' | 'export', refId: string, assetIds: string[], pin: boolean) {
  const valid = assetIds.length
    ? await db.query(`SELECT id, current_version_id FROM media_assets WHERE workspace_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`, [wsId, assetIds])
    : [];
  await db.query(`DELETE FROM asset_references WHERE ref_type = $1 AND ref_id = $2 AND NOT (asset_id = ANY($3::text[]))`, [refType, refId, valid.map((v) => v.id)]);
  const pins: Record<string, string> = {};
  for (const a of valid) {
    pins[a.id] = a.current_version_id;
    await db.query(
      `INSERT INTO asset_references (id, workspace_id, asset_id, asset_version_id, ref_type, ref_id, pinned) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (asset_id, ref_type, ref_id) DO ${pin ? 'UPDATE SET asset_version_id = EXCLUDED.asset_version_id, pinned = true' : 'NOTHING'}`,
      [uid('ref'), wsId, a.id, pin ? a.current_version_id : null, refType, refId, pin],
    );
  }
  return pins;
}
