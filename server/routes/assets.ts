import { Router, raw } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requirePerm } from '../auth';
import { HttpError, badRequest, conflict, notFound, parse, rateLimit } from '../http';
import { audit } from '../audit';
import { sniff, svgProblems } from '../services/sniff';
import { uid } from '../../shared/util/random';
import type { Db } from '../db';
import type { Request } from 'express';

const LIMITS: Record<string, number> = { image: 20e6, svg: 2e6, video: 100e6, font: 10e6 };
const KIND_FAMILIES: Record<string, string[]> = { image: ['image'], logo: ['image', 'svg'], svg: ['svg'], video: ['video'], font: ['font'] };
const uploadLimit = rateLimit({ name: 'upload', windowMs: 60_000, max: 30, key: (r) => r.user?.id ?? r.ip ?? 'x' });

export async function storeAssetVersion(db: Db, req: Request, assetId: string, body: Buffer, kindHint: string) {
  const s = sniff(body);
  if (!s) throw badRequest('Unsupported or unrecognised file type. Upload PNG, JPEG, WebP, GIF, SVG, MP4, WebM, WOFF/WOFF2, TTF or OTF.');
  const allowed = KIND_FAMILIES[kindHint] ?? [];
  if (!allowed.includes(s.family)) throw badRequest(`A ${kindHint} asset cannot be a ${s.mime} file`);
  if (body.length > (LIMITS[s.family] ?? 0)) throw new HttpError(413, 'too_large', `${s.family} files are limited to ${Math.round(LIMITS[s.family] / 1e6)} MB`);
  if (s.family === 'svg') {
    const problems = svgProblems(body.toString('utf8'));
    if (problems.length) throw badRequest(`SVG rejected: ${problems.join(', ')}`);
  }
  if (s.family === 'image' && (!s.width || !s.height || s.width > 12000 || s.height > 12000)) throw badRequest('Image dimensions are missing or exceed 12000 px');
  const v = await db.one(`SELECT coalesce(max(version), 0) + 1 AS v FROM asset_versions WHERE asset_id = $1`, [assetId]);
  const versionId = uid('av');
  const key = `${req.ws!.id}/assets/${assetId}/${versionId}.${s.ext}`;
  await req.ctx.storage.put(key, body, s.mime);
  await db.query(
    `INSERT INTO asset_versions (id, asset_id, workspace_id, version, storage_key, mime, bytes, width, height, sha256, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [versionId, assetId, req.ws!.id, v!.v, key, s.mime, body.length, s.width ?? null, s.height ?? null, createHash('sha256').update(body).digest('hex'), req.user!.id],
  );
  return { versionId, version: v!.v as number, sniffed: s };
}

const assetRow = (req: Request, a: any) => ({
  id: a.id, name: a.name, kind: a.kind, category: a.category, tags: a.tags, teamId: a.team_id, campaignId: a.campaign_id, license: a.license,
  createdAt: a.created_at, createdBy: a.created_by_name, version: a.version, versionId: a.current_version_id, mime: a.mime, bytes: Number(a.bytes), width: a.width, height: a.height,
  usage: Number(a.usage ?? 0),
  url: a.storage_key ? req.ctx.storage.signedUrl(a.storage_key) : null,
});

export function assetRoutes() {
  const r = Router();

  r.get('/assets', requirePerm('asset.view'), async (req, res) => {
    const q = parse(z.object({ kind: z.string().optional(), q: z.string().max(100).optional(), tag: z.string().max(40).optional(), team: z.string().optional(), campaign: z.string().optional() }), req.query);
    const rows = await req.ctx.db.query(
      `SELECT a.*, v.version, v.storage_key, v.mime, v.bytes, v.width, v.height, u.name AS created_by_name,
              (SELECT count(*) FROM asset_references r WHERE r.asset_id = a.id) AS usage
         FROM media_assets a JOIN asset_versions v ON v.id = a.current_version_id LEFT JOIN users u ON u.id = a.created_by
        WHERE a.workspace_id = $1 AND a.deleted_at IS NULL
          AND ($2::text IS NULL OR a.kind = $2) AND ($3::text IS NULL OR a.name ILIKE '%' || $3 || '%' OR $3 = ANY(a.tags))
          AND ($4::text IS NULL OR $4 = ANY(a.tags)) AND ($5::text IS NULL OR a.team_id = $5) AND ($6::text IS NULL OR a.campaign_id = $6)
        ORDER BY a.created_at DESC LIMIT 300`,
      [req.ws!.id, q.kind ?? null, q.q ?? null, q.tag ?? null, q.team ?? null, q.campaign ?? null],
    );
    res.json({ assets: rows.map((a) => assetRow(req, a)) });
  });

  r.post('/assets', requirePerm('asset.upload'), uploadLimit, raw({ type: () => true, limit: '100mb' }), async (req, res) => {
    const meta = parse(z.object({
      name: z.string().trim().min(1).max(160), kind: z.enum(['image', 'logo', 'svg', 'video', 'font']), category: z.string().max(40).default('general'),
      tags: z.string().max(400).default(''), team: z.string().optional(), campaign: z.string().optional(), license: z.string().max(2000).optional(),
    }), req.query);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('Empty upload');
    let license: any = null;
    if (meta.kind === 'font') {
      license = parse(z.object({ holder: z.string().min(1).max(120), web: z.boolean(), video: z.boolean(), app: z.boolean(), note: z.string().max(400).default('') }), JSON.parse(meta.license ?? '{}'));
    }
    const { db } = req.ctx;
    const assetId = uid('ast');
    const tags = meta.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20);
    const out = await db.tx(async (tx) => {
      await tx.query(`INSERT INTO media_assets (id, workspace_id, kind, name, category, tags, team_id, campaign_id, license, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [assetId, req.ws!.id, meta.kind, meta.name, meta.category, tags, meta.team ?? null, meta.campaign ?? null, license ? JSON.stringify(license) : null, req.user!.id]);
      const v = await storeAssetVersion(tx, req, assetId, req.body, meta.kind);
      await tx.query(`UPDATE media_assets SET current_version_id = $2 WHERE id = $1`, [assetId, v.versionId]);
      return v;
    });
    await audit(db, req, 'asset.upload', 'asset', assetId, { name: meta.name, mime: out.sniffed.mime });
    res.status(201).json({ id: assetId, versionId: out.versionId, mime: out.sniffed.mime, width: out.sniffed.width, height: out.sniffed.height });
  });

  r.get('/assets/:id', requirePerm('asset.view'), async (req, res) => {
    const { db } = req.ctx;
    const a = await db.one(`SELECT a.*, v.version, v.storage_key, v.mime, v.bytes, v.width, v.height, u.name AS created_by_name FROM media_assets a JOIN asset_versions v ON v.id = a.current_version_id LEFT JOIN users u ON u.id = a.created_by WHERE a.id = $1 AND a.workspace_id = $2 AND a.deleted_at IS NULL`, [req.params.id, req.ws!.id]);
    if (!a) throw notFound('Asset');
    const versions = await db.query(`SELECT id, version, mime, bytes, width, height, sha256, created_at, storage_key FROM asset_versions WHERE asset_id = $1 ORDER BY version DESC`, [a.id]);
    const usage = await db.query(
      `SELECT r.ref_type, r.ref_id, r.pinned, v.version AS pinned_version,
              p.name AS label, p.id AS project_id
         FROM asset_references r LEFT JOIN asset_versions v ON v.id = r.asset_version_id
         LEFT JOIN motion_scenes s ON r.ref_type = 'scene' AND s.id = r.ref_id LEFT JOIN motion_projects p ON p.id = s.project_id AND p.deleted_at IS NULL
        WHERE r.asset_id = $1`,
      [a.id],
    );
    res.json({ asset: assetRow(req, a), versions: versions.map(({ storage_key, ...v }) => ({ ...v, bytes: Number(v.bytes), url: req.ctx.storage.signedUrl(storage_key) })), usage });
  });

  r.patch('/assets/:id', requirePerm('asset.upload'), async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(160).optional(), tags: z.array(z.string().max(40)).max(20).optional(), category: z.string().max(40).optional() }), req.body);
    await req.ctx.db.query(`UPDATE media_assets SET name = coalesce($3, name), tags = coalesce($4, tags), category = coalesce($5, category) WHERE id = $1 AND workspace_id = $2`, [req.params.id, req.ws!.id, body.name ?? null, body.tags ?? null, body.category ?? null]);
    res.json({ ok: true });
  });

  /**
   * Replace an asset with a new version. `updateDrafts=false` pins every unpinned draft reference
   * to the previous version so they keep rendering the old file; published template versions are
   * always pinned and never change.
   */
  r.post('/assets/:id/replace', requirePerm('asset.upload'), uploadLimit, raw({ type: () => true, limit: '100mb' }), async (req, res) => {
    const q = parse(z.object({ updateDrafts: z.enum(['true', 'false']) }), req.query);
    const { db } = req.ctx;
    const a = await db.one(`SELECT * FROM media_assets WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [req.params.id, req.ws!.id]);
    if (!a) throw notFound('Asset');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('Empty upload');
    const out = await db.tx(async (tx) => {
      if (q.updateDrafts === 'false') await tx.query(`UPDATE asset_references SET pinned = true, asset_version_id = $2 WHERE asset_id = $1 AND pinned = false`, [a.id, a.current_version_id]);
      const v = await storeAssetVersion(tx, req, a.id, req.body, a.kind);
      await tx.query(`UPDATE media_assets SET current_version_id = $2 WHERE id = $1`, [a.id, v.versionId]);
      return v;
    });
    await audit(db, req, 'asset.replace', 'asset', a.id, { version: out.version, updateDrafts: q.updateDrafts === 'true' });
    res.json({ ok: true, version: out.version });
  });

  r.post('/assets/:id/references/:refId/follow', requirePerm('asset.upload'), async (req, res) => {
    await req.ctx.db.query(`UPDATE asset_references SET pinned = false, asset_version_id = NULL WHERE asset_id = $1 AND ref_id = $2 AND ref_type = 'scene' AND workspace_id = $3`, [req.params.id, req.params.refId, req.ws!.id]);
    res.json({ ok: true });
  });

  r.delete('/assets/:id', requirePerm('asset.manage'), async (req, res) => {
    const { db } = req.ctx;
    await db.query(`UPDATE media_assets SET deleted_at = now() WHERE id = $1 AND workspace_id = $2`, [req.params.id, req.ws!.id]);
    await audit(db, req, 'asset.delete', 'asset', String(req.params.id));
    res.json({ ok: true });
  });

  /** Resolve asset ids to signed URLs, honouring version pins of the requesting context. */
  r.post('/assets/resolve', requirePerm('asset.view'), async (req, res) => {
    const body = parse(z.object({ ids: z.array(z.string().max(64)).max(100), context: z.object({ type: z.enum(['scene', 'export']), id: z.string() }).optional() }), req.body);
    const { db } = req.ctx, ws = req.ws!.id;
    let pins: Record<string, string> = {};
    const ctx = body.context;
    if (ctx?.type === 'export') pins = (await db.one(`SELECT source->'pins' AS pins FROM export_jobs WHERE id = $1 AND workspace_id = $2`, [ctx.id, ws]))?.pins ?? {};
    if (ctx?.type === 'scene') {
      const rows = await db.query(`SELECT asset_id, asset_version_id FROM asset_references WHERE ref_type = 'scene' AND ref_id = $1 AND pinned AND workspace_id = $2`, [ctx.id, ws]);
      pins = Object.fromEntries(rows.map((r) => [r.asset_id, r.asset_version_id]));
    }
    const rows = body.ids.length
      ? await db.query(
          `SELECT a.id, a.name, a.kind, a.deleted_at, v.id AS version_id, v.version, v.storage_key, v.mime, v.width, v.height
             FROM media_assets a JOIN asset_versions v ON v.asset_id = a.id
            WHERE a.workspace_id = $1 AND a.id = ANY($2::text[]) AND v.id = coalesce(($3::jsonb ->> a.id), a.current_version_id)`,
          [ws, body.ids, JSON.stringify(pins)],
        )
      : [];
    const out: Record<string, any> = {};
    for (const id of body.ids) {
      const a = rows.find((x) => x.id === id);
      out[id] = a && (!a.deleted_at || pins[id])
        ? { url: req.ctx.storage.signedUrl(a.storage_key), name: a.name, kind: a.kind, mime: a.mime, width: a.width, height: a.height, version: a.version, pinned: !!pins[id] }
        : { missing: true };
    }
    res.json({ assets: out });
  });

  return r;
}

/** Signed file delivery. The signature binds key + expiry; keys are workspace-prefixed. */
export function fileRoutes() {
  const r = Router();
  r.get('/files/*key', async (req, res) => {
    const key = ([] as string[]).concat((req.params as any).key).join('/');
    if (!req.ctx.storage.verify(key, String(req.query.exp ?? ''), String(req.query.sig ?? ''))) {
      res.status(403).json({ error: { code: 'invalid_signature', message: 'This link has expired or is invalid' } });
      return;
    }
    const meta = (await req.ctx.db.one(`SELECT mime FROM asset_versions WHERE storage_key = $1`, [key]))
      ?? (await req.ctx.db.one(`SELECT mime FROM exported_files WHERE storage_key = $1`, [key]))
      ?? (await req.ctx.db.one(`SELECT mime FROM community_assets WHERE storage_key = $1`, [key]));
    if (!meta) { res.status(404).end(); return; }
    const data = await req.ctx.storage.get(key).catch(() => null);
    if (!data) { res.status(404).json({ error: { code: 'missing', message: 'File is missing from storage' } }); return; }
    res.setHeader('Content-Type', meta.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (meta.mime === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    if (req.query.dl) res.setHeader('Content-Disposition', `attachment; filename="${String(req.query.dl).replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    // Byte ranges let browsers seek in exported video.
    res.setHeader('Accept-Ranges', 'bytes');
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (m && (m[1] || m[2])) {
      const size = data.length;
      let start = m[1] ? Number(m[1]) : size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : size - 1;
      if (start < 0) start = 0;
      end = Math.min(end, size - 1);
      if (start > end || start >= size) { res.status(416).setHeader('Content-Range', `bytes */${size}`); res.end(); return; }
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      res.end(data.subarray(start, end + 1));
      return;
    }
    res.end(data);
  });
  return r;
}
