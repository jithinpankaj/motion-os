import { Router } from 'express';
import { z } from 'zod';
import { has, requirePerm, requireUser } from '../auth';
import { HttpError, forbidden, notFound, parse, rateLimit } from '../http';
import { audit } from '../audit';
import { createProject } from './projects';
import { createAsset } from './imports';
import { remapSceneAssets, sceneAssetIds } from '../services/assets';
import { deserializeScene } from '../../shared/scene/serialize';
import { LIBRARY_CATEGORIES, MOTION_PRESETS, categoryTag } from '../../shared/motion/presets';
import { uid } from '../../shared/util/random';
import type { Db } from '../db';
import type { Request } from 'express';

/**
 * Community: a gallery shared by everyone on this server. Publishing stores an immutable copy of a
 * motion with its images copied into community storage; remixing copies it (and its images) into
 * the remixer's workspace. Nothing in a post can reach back into the author's workspace.
 */
const publishLimit = rateLimit({ name: 'community-publish', windowMs: 60_000, max: 10, key: (r) => r.user?.id ?? r.ip ?? 'x' });
const remixLimit = rateLimit({ name: 'community-remix', windowMs: 60_000, max: 30, key: (r) => r.user?.id ?? r.ip ?? 'x' });

/** Keep the built-in presets in the gallery and up to date with the code that defines them. */
export async function ensurePresetPosts(db: Db) {
  for (const p of MOTION_PRESETS) {
    const doc = p.build();
    await db.query(
      `INSERT INTO community_posts (id, author_name, title, description, tags, doc, is_preset, preset_key) VALUES ($1, 'Motion OS', $2, $3, $4, $5, true, $6)
       ON CONFLICT (preset_key) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, tags = EXCLUDED.tags, doc = EXCLUDED.doc, unpublished_at = NULL`,
      [uid('cp'), p.name, `${p.description} ${p.tip}`, p.tags, JSON.stringify(doc), p.key],
    );
  }
  // Presets that are no longer in the library leave the gallery (remixes people made are kept).
  await db.query(`UPDATE community_posts SET unpublished_at = now() WHERE is_preset AND unpublished_at IS NULL AND NOT (preset_key = ANY($1::text[]))`, [MOTION_PRESETS.map((p) => p.key)]);
}

const row = (p: any, me?: string) => ({
  id: p.id, title: p.title, description: p.description, tags: p.tags, author: p.author_name, isPreset: p.is_preset, presetKey: p.preset_key,
  remixCount: p.remix_count, likeCount: p.like_count, liked: !!p.liked, publishedAt: p.published_at, updatedAt: p.updated_at,
  remixOf: p.remix_of ? { id: p.remix_of, title: p.remix_of_title } : null, mine: !!me && p.author_id === me, doc: p.doc,
});

async function assetMap(req: Request, postId: string) {
  const rows = await req.ctx.db.query(`SELECT id, storage_key, mime, width, height FROM community_assets WHERE post_id = $1`, [postId]);
  return Object.fromEntries(rows.map((a) => [a.id, { url: req.ctx.storage.signedUrl(a.storage_key, 3600), mime: a.mime, width: a.width, height: a.height }]));
}

/** Routes that only need a signed-in user (the gallery is server-wide, not per workspace). */
export function publicCommunityRoutes() {
  const r = Router();

  r.get('/community', requireUser, async (req, res) => {
    const q = parse(z.object({ q: z.string().max(80).optional(), tag: z.string().max(40).optional(), sort: z.enum(['recent', 'popular', 'presets']).default('recent') }), req.query);
    // Presets keep the order they're defined in (simplest first); posts show newest or most-used first.
    const order = q.sort === 'popular' ? 'p.like_count + p.remix_count * 2 DESC, p.published_at DESC' : q.sort === 'presets' ? 'p.published_at ASC, p.id' : 'p.is_preset ASC, p.published_at DESC';
    const rows = await req.ctx.db.query(
      `SELECT p.*, (SELECT 1 FROM community_likes l WHERE l.post_id = p.id AND l.user_id = $1) AS liked, o.title AS remix_of_title
         FROM community_posts p LEFT JOIN community_posts o ON o.id = p.remix_of
        WHERE p.unpublished_at IS NULL
          AND ($2::text IS NULL OR p.title ILIKE '%' || $2 || '%' OR p.description ILIKE '%' || $2 || '%' OR $2 = ANY(p.tags))
          AND ($3::text IS NULL OR $3 = ANY(p.tags))
          AND ($4::boolean IS NOT TRUE OR p.is_preset)
        ORDER BY ${order} LIMIT 80`,
      [req.user!.id, q.q?.toLowerCase() ?? null, q.tag ?? null, q.sort === 'presets'],
    );
    const tags = await req.ctx.db.query(`SELECT t AS tag, count(*)::int AS n FROM community_posts, unnest(tags) t WHERE unpublished_at IS NULL GROUP BY t ORDER BY n DESC, t LIMIT 16`);
    res.json({ posts: rows.map((p) => row(p, req.user!.id)), tags });
  });

  r.get('/community/:id', requireUser, async (req, res) => {
    const p = await req.ctx.db.one(
      `SELECT p.*, (SELECT 1 FROM community_likes l WHERE l.post_id = p.id AND l.user_id = $2) AS liked, o.title AS remix_of_title
         FROM community_posts p LEFT JOIN community_posts o ON o.id = p.remix_of WHERE p.id = $1 AND p.unpublished_at IS NULL`,
      [req.params.id, req.user!.id],
    );
    if (!p) throw notFound('Post');
    res.json({ post: { ...row(p, req.user!.id), doc: deserializeScene(p.doc) }, assets: await assetMap(req, p.id) });
  });

  r.post('/community/:id/like', requireUser, async (req, res) => {
    const { db } = req.ctx;
    const p = await db.one(`SELECT id FROM community_posts WHERE id = $1 AND unpublished_at IS NULL`, [req.params.id]);
    if (!p) throw notFound('Post');
    const had = await db.one(`DELETE FROM community_likes WHERE post_id = $1 AND user_id = $2 RETURNING 1 AS x`, [p.id, req.user!.id]);
    if (!had) await db.query(`INSERT INTO community_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [p.id, req.user!.id]);
    const n = await db.one(`UPDATE community_posts SET like_count = (SELECT count(*) FROM community_likes WHERE post_id = $1) WHERE id = $1 RETURNING like_count`, [p.id]);
    res.json({ liked: !had, likeCount: n!.like_count });
  });

  return r;
}

/** Routes that act on a workspace: publishing your file, remixing into your files. */
export function communityRoutes() {
  const r = Router();

  r.post('/community', requirePerm('community.publish'), publishLimit, async (req, res) => {
    const body = parse(z.object({ projectId: z.string().max(64), title: z.string().trim().min(2).max(80), description: z.string().trim().max(500).default(''), tags: z.array(z.string().trim().toLowerCase().min(1).max(24)).max(6).default([]), category: z.enum(LIBRARY_CATEGORIES).optional() }), req.body);
    // A library category is stored on the file and as its first tag, so the gallery can filter by it.
    if (body.category) body.tags = [categoryTag(body.category), ...body.tags.filter((t) => t !== categoryTag(body.category!))].slice(0, 7);
    const { db, storage } = req.ctx;
    const proj = await db.one(`SELECT p.id, p.remix_of, s.doc FROM motion_projects p JOIN motion_scenes s ON s.project_id = p.id WHERE p.id = $1 AND p.workspace_id = $2 AND p.deleted_at IS NULL`, [body.projectId, req.ws!.id]);
    if (!proj) throw notFound('File');
    const existing = await db.one(`SELECT id FROM community_posts WHERE project_id = $1 AND unpublished_at IS NULL`, [proj.id]);
    const postId = existing?.id ?? uid('cp');
    let doc = deserializeScene(proj.doc);
    // Copy every image and sound the file uses into community storage, and point the copy at those.
    const ids = sceneAssetIds(doc);
    const assets = ids.length ? await db.query(`SELECT a.id, v.storage_key, v.mime, v.width, v.height, v.bytes FROM media_assets a JOIN asset_versions v ON v.id = a.current_version_id WHERE a.workspace_id = $1 AND a.id = ANY($2::text[]) AND a.deleted_at IS NULL`, [req.ws!.id, ids]) : [];
    const map: Record<string, string | null> = Object.fromEntries(ids.map((i) => [i, null]));
    const copies: { id: string; key: string; mime: string; width: number | null; height: number | null; bytes: number }[] = [];
    for (const a of assets) {
      const cid = uid('ca');
      const key = `community/${postId}/${cid}.${a.mime.split('/')[1]?.replace('svg+xml', 'svg') ?? 'bin'}`;
      await storage.put(key, await storage.get(a.storage_key), a.mime);
      copies.push({ id: cid, key, mime: a.mime, width: a.width, height: a.height, bytes: Number(a.bytes) });
      map[a.id] = cid;
    }
    doc = remapSceneAssets(doc, map);
    if (body.category) doc = { ...doc, meta: { ...doc.meta, category: body.category } };
    const remixOf = proj.remix_of ? (await db.one(`SELECT id FROM community_posts WHERE id = $1`, [proj.remix_of]))?.id ?? null : null;
    await db.tx(async (tx) => {
      if (existing) {
        await tx.query(`DELETE FROM community_assets WHERE post_id = $1`, [postId]);
        await tx.query(`UPDATE community_posts SET title = $2, description = $3, tags = $4, doc = $5, updated_at = now() WHERE id = $1`, [postId, body.title, body.description, body.tags, JSON.stringify(doc)]);
      } else {
        await tx.query(`INSERT INTO community_posts (id, project_id, workspace_id, author_id, author_name, title, description, tags, doc, remix_of) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [postId, proj.id, req.ws!.id, req.user!.id, req.user!.name, body.title, body.description, body.tags, JSON.stringify(doc), remixOf]);
      }
      for (const c of copies) await tx.query(`INSERT INTO community_assets (id, post_id, storage_key, mime, width, height, bytes) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [c.id, postId, c.key, c.mime, c.width, c.height, c.bytes]);
    });
    await audit(db, req, existing ? 'community.update' : 'community.publish', 'community_post', postId, { projectId: proj.id, images: copies.length });
    res.status(existing ? 200 : 201).json({ id: postId, updated: !!existing });
  });

  r.delete('/community/:id', requirePerm('scene.view'), async (req, res) => {
    const { db } = req.ctx;
    const p = await db.one(`SELECT id, author_id, workspace_id, is_preset FROM community_posts WHERE id = $1 AND unpublished_at IS NULL`, [req.params.id]);
    if (!p) throw notFound('Post');
    if (p.is_preset) throw forbidden('Built-in presets can’t be unpublished');
    const workspaceAdmin = p.workspace_id === req.ws!.id && has(req, 'workspace.manage');
    if (p.author_id !== req.user!.id && !workspaceAdmin) throw forbidden('Only the author (or an admin of their workspace) can unpublish this');
    await db.query(`UPDATE community_posts SET unpublished_at = now() WHERE id = $1`, [p.id]);
    await audit(db, req, 'community.unpublish', 'community_post', p.id, {});
    res.json({ ok: true });
  });

  r.post('/community/:id/remix', requirePerm('scene.create'), remixLimit, async (req, res) => {
    const { db, storage } = req.ctx;
    const p = await db.one(`SELECT * FROM community_posts WHERE id = $1 AND unpublished_at IS NULL`, [req.params.id]);
    if (!p) throw notFound('Post');
    let doc = deserializeScene(p.doc);
    const files = await db.query(`SELECT * FROM community_assets WHERE post_id = $1`, [p.id]);
    if (files.length && !has(req, 'asset.upload')) throw new HttpError(403, 'forbidden', 'This remix includes images or sounds, which needs permission to upload files');
    const map: Record<string, string> = {};
    for (const f of files) {
      const audio = f.mime.startsWith('audio/');
      const a = await createAsset(req, await storage.get(f.storage_key), { name: `${p.title} ${audio ? 'sound' : 'image'}`, kind: audio ? 'audio' : f.mime === 'image/svg+xml' ? 'svg' : 'image', category: 'remix', tags: ['remix'] });
      map[f.id] = a.id;
    }
    doc = remapSceneAssets(doc, map);
    const name = `${p.title} remix`;
    const out = await createProject(db, req.ws!.id, req.user!.id, name, { ...doc, meta: { ...doc.meta, name } }, null, `Remixed from “${p.title}” by ${p.author_name}`);
    await db.query(`UPDATE motion_projects SET remix_of = $2 WHERE id = $1`, [out.projectId, p.id]);
    await db.query(`UPDATE community_posts SET remix_count = remix_count + 1 WHERE id = $1`, [p.id]);
    await audit(db, req, 'community.remix', 'community_post', p.id, { projectId: out.projectId });
    res.status(201).json({ id: out.projectId });
  });

  return r;
}
