import { Router } from 'express';
import { z } from 'zod';
import { requirePerm } from '../auth';
import { badRequest, conflict, notFound, parse } from '../http';
import { audit } from '../audit';
import { deserializeScene } from '../../shared/scene/serialize';
import { createScene } from '../../shared/scene/defaults';
import { MOTION_PRESETS } from '../../shared/motion/presets';
import { uid } from '../../shared/util/random';
import { sceneAssetIds, syncAssetRefs } from '../services/assets';
import { snapshotSceneVersion } from '../services/versions';
import type { Db } from '../db';

export async function createProject(db: Db, wsId: string, userId: string, name: string, doc: any, brandId: string | null, description = '') {
  const projectId = uid('prj'), sceneId = uid('scene');
  const scene = deserializeScene({ ...doc, meta: { ...doc.meta, name } });
  await db.tx(async (tx) => {
    await tx.query(`INSERT INTO motion_projects (id, workspace_id, brand_id, name, description, owner_id) VALUES ($1, $2, $3, $4, $5, $6)`, [projectId, wsId, brandId, name, description, userId]);
    await tx.query(`INSERT INTO motion_scenes (id, project_id, workspace_id, doc, updated_by) VALUES ($1, $2, $3, $4, $5)`, [sceneId, projectId, wsId, JSON.stringify(scene), userId]);
    await syncAssetRefs(tx, wsId, 'scene', sceneId, sceneAssetIds(scene), false);
  });
  return { projectId, sceneId, scene };
}

export function projectRoutes() {
  const r = Router();

  const load = async (req: any) => {
    const p = await req.ctx.db.one(
      `SELECT p.*, s.id AS scene_id, s.doc, s.revision, s.updated_at AS scene_updated_at, u.name AS updated_by_name
         FROM motion_projects p JOIN motion_scenes s ON s.project_id = p.id LEFT JOIN users u ON u.id = s.updated_by
        WHERE p.id = $1 AND p.workspace_id = $2 AND p.deleted_at IS NULL`,
      [req.params.id, req.ws.id],
    );
    if (!p) throw notFound('Project');
    return p;
  };

  r.get('/projects', requirePerm('scene.view'), async (req, res) => {
    const rows = await req.ctx.db.query(
      `SELECT p.id, p.name, p.description, p.updated_at, p.created_at, u.name AS owner, s.doc,
              (SELECT c.id FROM community_posts c WHERE c.project_id = p.id AND c.unpublished_at IS NULL LIMIT 1) AS community_id
         FROM motion_projects p JOIN motion_scenes s ON s.project_id = p.id LEFT JOIN users u ON u.id = p.owner_id
        WHERE p.workspace_id = $1 AND p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 200`,
      [req.ws!.id],
    );
    res.json({ projects: rows });
  });

  r.post('/projects', requirePerm('scene.create'), async (req, res) => {
    const body = parse(z.object({
      name: z.string().trim().min(1).max(120), preset: z.string().max(60).optional(), scene: z.unknown().optional(),
      width: z.number().int().min(16).max(4096).optional(), height: z.number().int().min(16).max(4096).optional(), background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }), req.body);
    let doc: any;
    if (body.scene !== undefined) doc = { ...deserializeScene(body.scene), id: uid('scn') }; // untrusted import → migrate + validate
    else if (body.preset) {
      const p = MOTION_PRESETS.find((x) => x.key === body.preset);
      if (!p) throw badRequest('Unknown preset');
      doc = p.build();
    } else {
      const base = createScene();
      doc = { ...base, canvas: { ...base.canvas, width: body.width ?? 1080, height: body.height ?? 1080, background: body.background ?? '#0b0b10' } };
    }
    const out = await createProject(req.ctx.db, req.ws!.id, req.user!.id, body.name, doc, null);
    res.status(201).json({ id: out.projectId });
  });

  r.get('/projects/:id', requirePerm('scene.view'), async (req, res) => {
    const p = await load(req);
    const post = await req.ctx.db.one(`SELECT id, published_at, updated_at FROM community_posts WHERE project_id = $1 AND unpublished_at IS NULL`, [p.id]);
    res.json({
      project: { id: p.id, name: p.name, description: p.description, updatedAt: p.updated_at, remixOf: p.remix_of ?? null },
      scene: { doc: deserializeScene(p.doc), revision: p.revision, updatedAt: p.scene_updated_at, updatedBy: p.updated_by_name },
      community: post ? { id: post.id, publishedAt: post.published_at, updatedAt: post.updated_at } : null,
    });
  });

  r.put('/projects/:id/scene', requirePerm('scene.edit'), async (req, res) => {
    const body = parse(z.object({ doc: z.unknown(), baseRevision: z.number().int(), force: z.boolean().optional() }), req.body);
    const p = await load(req);
    const doc = deserializeScene(body.doc);
    const { db } = req.ctx;
    if (p.revision !== body.baseRevision && !body.force) {
      throw conflict(`${p.updated_by_name ?? 'Someone'} saved a newer version of this scene`, { revision: p.revision, updatedBy: p.updated_by_name, updatedAt: p.scene_updated_at, doc: deserializeScene(p.doc) });
    }
    const updated = await db.one(
      `UPDATE motion_scenes SET doc = $2, revision = revision + 1, updated_by = $3, updated_at = now() WHERE id = $1 ${body.force ? '' : 'AND revision = $4'} RETURNING revision, updated_at`,
      body.force ? [p.scene_id, JSON.stringify(doc), req.user!.id] : [p.scene_id, JSON.stringify(doc), req.user!.id, body.baseRevision],
    );
    if (!updated) throw conflict('Scene changed while saving; reload to merge');
    await db.query(`UPDATE motion_projects SET updated_at = now(), name = $2 WHERE id = $1`, [p.id, doc.meta.name]);
    await syncAssetRefs(db, req.ws!.id, 'scene', p.scene_id, sceneAssetIds(doc), false);
    res.json({ revision: updated.revision, updatedAt: updated.updated_at });
  });

  r.patch('/projects/:id', requirePerm('scene.edit'), async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(2000).optional() }), req.body);
    const p = await load(req);
    await req.ctx.db.query(`UPDATE motion_projects SET name = coalesce($2, name), description = coalesce($3, description), updated_at = now() WHERE id = $1`, [p.id, body.name ?? null, body.description ?? null]);
    res.json({ ok: true });
  });

  r.delete('/projects/:id', requirePerm('scene.delete'), async (req, res) => {
    const p = await load(req);
    await req.ctx.db.query(`UPDATE motion_projects SET deleted_at = now() WHERE id = $1`, [p.id]);
    await audit(req.ctx.db, req, 'project.delete', 'project', p.id, { name: p.name });
    res.json({ ok: true });
  });

  r.post('/projects/:id/duplicate', requirePerm('scene.create'), async (req, res) => {
    const p = await load(req);
    const out = await createProject(req.ctx.db, req.ws!.id, req.user!.id, `${p.name} copy`, { ...p.doc, id: uid('scn') }, p.brand_id);
    res.status(201).json({ id: out.projectId });
  });

  r.get('/projects/:id/versions', requirePerm('scene.view'), async (req, res) => {
    const p = await load(req);
    const rows = await req.ctx.db.query(`SELECT v.id, v.version, v.branch, v.note, v.created_at, v.parent_version_id, u.name AS author FROM scene_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.scene_id = $1 ORDER BY v.version DESC`, [p.scene_id]);
    res.json({ versions: rows });
  });

  r.get('/projects/:id/versions/:vid', requirePerm('scene.view'), async (req, res) => {
    const p = await load(req);
    const v = await req.ctx.db.one(`SELECT id, version, note, doc, created_at FROM scene_versions WHERE id = $1 AND scene_id = $2`, [req.params.vid, p.scene_id]);
    if (!v) throw notFound('Version');
    res.json({ version: { ...v, doc: deserializeScene(v.doc) } });
  });

  r.post('/projects/:id/versions', requirePerm('scene.edit'), async (req, res) => {
    const body = parse(z.object({ note: z.string().max(300).default('') }), req.body);
    const p = await load(req);
    const v = await snapshotSceneVersion(req.ctx.db, req.ws!.id, p.scene_id, deserializeScene(p.doc), body.note, req.user!.id);
    res.status(201).json(v);
  });

  r.post('/projects/:id/versions/:vid/restore', requirePerm('scene.edit'), async (req, res) => {
    const p = await load(req);
    const { db } = req.ctx;
    const v = await db.one(`SELECT id, version, doc FROM scene_versions WHERE id = $1 AND scene_id = $2`, [req.params.vid, p.scene_id]);
    if (!v) throw notFound('Version');
    // Snapshot the current draft first so a restore never discards work.
    await snapshotSceneVersion(db, req.ws!.id, p.scene_id, deserializeScene(p.doc), `Auto-saved before restoring v${v.version}`, req.user!.id);
    const out = await db.one(`UPDATE motion_scenes SET doc = $2, revision = revision + 1, updated_by = $3, updated_at = now() WHERE id = $1 RETURNING revision`, [p.scene_id, JSON.stringify(v.doc), req.user!.id]);
    await audit(db, req, 'version.restore', 'project', p.id, { restoredVersion: v.version });
    res.json({ revision: out!.revision, doc: deserializeScene(v.doc) });
  });

  r.post('/projects/:id/versions/:vid/branch', requirePerm('scene.create'), async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(120) }), req.body);
    const p = await load(req);
    const v = await req.ctx.db.one(`SELECT doc, version FROM scene_versions WHERE id = $1 AND scene_id = $2`, [req.params.vid, p.scene_id]);
    if (!v) throw notFound('Version');
    const out = await createProject(req.ctx.db, req.ws!.id, req.user!.id, body.name, { ...v.doc, id: uid('scn') }, p.brand_id, `Branched from ${p.name} v${v.version}`);
    res.status(201).json({ id: out.projectId });
  });

  return r;
}
