import { Router, raw } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { has, requirePerm } from '../auth';
import { HttpError, badRequest, conflict, forbidden, notFound, parse, rateLimit } from '../http';
import { audit, usage } from '../audit';
import { loadTemplateVersion } from '../services/templates';
import { sniff } from '../services/sniff';
import { sceneAssetIds } from '../services/assets';
import { deserializeScene, serializeScene } from '../../shared/scene/serialize';
import { applyParameters } from '../../shared/params';
import { resolveVariation } from '../../shared/inheritance';
import { adaptScene } from '../../shared/adapt';
import { formatById } from '../../shared/formats';
import { EXPORT_FORMATS, analyzeCompatibility } from '../../shared/compat';
import { uid } from '../../shared/util/random';
import type { SceneDocument } from '../../shared/scene/schema';
import type { Request } from 'express';

const MAX_ACTIVE = 4, MAX_PER_DAY = 200;
const dims = { width: z.number().int().min(16).max(3840), height: z.number().int().min(16).max(3840) };
export const SettingsSchemas = {
  png: z.object({ ...dims, time: z.number().min(0).max(600), background: z.enum(['scene', 'transparent']).default('scene') }),
  webp: z.object({ ...dims, time: z.number().min(0).max(600), quality: z.number().min(0.1).max(1).default(0.92), background: z.enum(['scene', 'transparent']).default('scene') }),
  mp4: z.object({
    ...dims, fps: z.number().int().min(12).max(60), duration: z.number().min(0.5).max(120), startTime: z.number().min(0).max(600).default(0),
    quality: z.enum(['draft', 'standard', 'high', 'max']).default('high'), background: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null), loops: z.number().int().min(1).max(10).default(1),
  }).refine((s) => s.width % 2 === 0 && s.height % 2 === 0, 'MP4 dimensions must be even').refine((s) => s.fps * s.duration * s.loops <= 7200, 'Too many frames (max 7200)'),
  'scene-json': z.object({}).passthrough(),
  embed: z.object({}).passthrough(),
} as const;

const SourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project'), id: z.string() }),
  z.object({ kind: z.literal('template'), templateId: z.string(), versionId: z.string(), values: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ kind: z.literal('variation'), campaignId: z.string(), variationId: z.string(), published: z.boolean().default(false) }),
]);

/** Resolve the exact scene to render. Consumers never supply scene JSON; values are re-applied here. */
async function resolveSource(req: Request, source: z.infer<typeof SourceSchema>): Promise<{ scene: SceneDocument; pins: Record<string, string>; sceneVersionId: string | null; channel?: string }> {
  const { db } = req.ctx, ws = req.ws!.id;
  if (source.kind === 'project') {
    if (!has(req, 'scene.view')) throw forbidden('Exporting projects requires scene.view');
    const s = await db.one(`SELECT s.id, s.doc FROM motion_scenes s JOIN motion_projects p ON p.id = s.project_id WHERE p.id = $1 AND p.workspace_id = $2 AND p.deleted_at IS NULL`, [source.id, ws]);
    if (!s) throw notFound('Project');
    const scene = deserializeScene(s.doc);
    const refs = await db.query(`SELECT a.id, coalesce(r.asset_version_id, a.current_version_id) AS v FROM media_assets a LEFT JOIN asset_references r ON r.asset_id = a.id AND r.ref_type = 'scene' AND r.ref_id = $3 AND r.pinned WHERE a.workspace_id = $1 AND a.id = ANY($2::text[])`, [ws, sceneAssetIds(scene), s.id]);
    return { scene, pins: Object.fromEntries(refs.map((r) => [r.id, r.v])), sceneVersionId: null };
  }
  if (source.kind === 'template') {
    if (!has(req, 'template.use') && !has(req, 'scene.view')) throw forbidden('Requires template.use');
    const tv = await loadTemplateVersion(db, ws, source.versionId);
    if (!tv || tv.template_id !== source.templateId) throw notFound('Template version');
    if (tv.status !== 'published' && !has(req, 'scene.view')) throw forbidden('Only published versions can be exported');
    const out = applyParameters(tv.doc, source.values, { roles: req.ws!.roles });
    if (out.errors.length) throw badRequest(out.errors.map((e) => e.message).join('; '), out.errors);
    const sv = await db.one(`SELECT scene_version_id FROM template_versions WHERE id = $1`, [tv.id]);
    return { scene: out.scene, pins: tv.asset_pins, sceneVersionId: sv!.scene_version_id };
  }
  if (!has(req, 'campaign.view')) throw forbidden('Requires campaign.view');
  const c = await db.one(`SELECT * FROM campaigns WHERE id = $1 AND workspace_id = $2`, [source.campaignId, ws]);
  const v = c && (await db.one(`SELECT * FROM campaign_variations WHERE id = $1 AND campaign_id = $2`, [source.variationId, c.id]));
  if (!c || !v) throw notFound('Campaign variation');
  let versionId = c.template_version_id, values: Record<string, unknown>;
  if (source.published) {
    if (!v.published_snapshot) throw conflict('This variation has not been published yet');
    versionId = v.published_snapshot.templateVersionId;
    values = v.published_snapshot.values;
  } else {
    const ov = await db.query(`SELECT param_key, value FROM content_overrides WHERE variation_id = $1`, [v.id]);
    const tvTmp = await loadTemplateVersion(db, ws, versionId);
    values = resolveVariation(tvTmp!.doc.exposed, c.master_values, Object.fromEntries(ov.map((o) => [o.param_key, o.value]))).values;
  }
  const tv = await loadTemplateVersion(db, ws, versionId);
  const out = applyParameters(tv!.doc, values, { roles: req.ws!.roles, ignoreLocks: false });
  if (out.errors.length) throw badRequest(out.errors.map((e) => e.message).join('; '), out.errors);
  const sv = await db.one(`SELECT scene_version_id FROM template_versions WHERE id = $1`, [tv!.id]);
  return { scene: out.scene, pins: tv!.asset_pins, sceneVersionId: sv!.scene_version_id, channel: v.channel_preset_id };
}

const jobRow = (req: Request, j: any) => ({
  id: j.id, format: j.format, settings: j.settings, status: j.status, progress: j.progress, error: j.error, source: { ...j.source, pins: undefined },
  createdAt: j.created_at, startedAt: j.started_at, finishedAt: j.finished_at,
  result: j.storage_key ? { url: req.ctx.storage.signedUrl(j.storage_key, 3600, j.filename), filename: j.filename, bytes: Number(j.bytes), mime: j.mime } : null,
});

export function exportRoutes() {
  const r = Router();
  const createLimit = rateLimit({ name: 'export', windowMs: 60_000, max: 30, key: (q) => q.user?.id ?? 'x' });

  r.get('/exports', requirePerm('export.create'), async (req, res) => {
    const rows = await req.ctx.db.query(`SELECT j.*, f.storage_key, f.filename, f.bytes, f.mime FROM export_jobs j LEFT JOIN exported_files f ON f.id = j.result_file_id WHERE j.workspace_id = $1 AND j.user_id = $2 ORDER BY j.created_at DESC LIMIT 50`, [req.ws!.id, req.user!.id]);
    res.json({ jobs: rows.map((j) => jobRow(req, j)) });
  });

  r.post('/exports', requirePerm('export.create'), createLimit, async (req, res) => {
    const body = parse(z.object({ source: SourceSchema, format: z.string(), settings: z.record(z.string(), z.unknown()).default({}), channel: z.string().optional(), name: z.string().max(120).optional() }), req.body);
    const meta = EXPORT_FORMATS.find((f) => f.id === body.format);
    if (!meta) throw badRequest('Unknown export format');
    if (!meta.implemented) throw new HttpError(422, 'format_unavailable', `${meta.label} export is not available yet. ${meta.note}.`);
    const settings = parse((SettingsSchemas as any)[body.format], body.settings);
    const { db } = req.ctx;
    const active = await db.one(`SELECT count(*)::int AS n FROM export_jobs WHERE workspace_id = $1 AND user_id = $2 AND status IN ('queued', 'processing')`, [req.ws!.id, req.user!.id]);
    if (active!.n >= MAX_ACTIVE) throw new HttpError(429, 'quota', `You have ${active!.n} exports in progress. Wait for one to finish (limit ${MAX_ACTIVE}).`);
    const today = await db.one(`SELECT count(*)::int AS n FROM export_jobs WHERE workspace_id = $1 AND user_id = $2 AND created_at > now() - interval '1 day'`, [req.ws!.id, req.user!.id]);
    if (today!.n >= MAX_PER_DAY) throw new HttpError(429, 'quota', `Daily export quota reached (${MAX_PER_DAY}).`);

    const resolved = await resolveSource(req, body.source);
    const channel = body.channel ?? resolved.channel;
    const f = channel ? formatById(channel) : undefined;
    let scene = resolved.scene;
    const w = (settings as any).width ?? f?.width ?? scene.canvas.width, h = (settings as any).height ?? f?.height ?? scene.canvas.height;
    scene = adaptScene(scene, f ? { ...f, width: w, height: h } : { width: w, height: h });
    const id = uid('exp');
    const source = { ...body.source, channel: channel ?? null, name: body.name ?? scene.meta.name, pins: resolved.pins };
    await db.query(`INSERT INTO export_jobs (id, workspace_id, user_id, source, scene_version_id, scene_snapshot, format, settings) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, req.ws!.id, req.user!.id, JSON.stringify(source), resolved.sceneVersionId, JSON.stringify(scene), body.format, JSON.stringify(settings)]);

    // Data formats are produced on the server immediately.
    if (body.format === 'scene-json' || body.format === 'embed') {
      const data = body.format === 'scene-json'
        ? Buffer.from(serializeScene(scene, true))
        : Buffer.from(JSON.stringify({ schema: 'motion-os/embed@1', source: { ...source, pins: undefined }, accessibility: scene.fallback, scene }, null, 2));
      await completeJob(req, id, data, 'application/json', `${slug(source.name)}${body.format === 'embed' ? '.embed' : ''}.json`);
    }
    await usage(db, req, 'export.create', 'templateId' in body.source ? body.source.templateId : null, { format: body.format });
    const j = await db.one(`SELECT j.*, f.storage_key, f.filename, f.bytes, f.mime FROM export_jobs j LEFT JOIN exported_files f ON f.id = j.result_file_id WHERE j.id = $1`, [id]);
    res.status(201).json({ job: jobRow(req, j), compatibility: analyzeCompatibility(scene, body.format as any) });
  });

  const ownJob = async (req: Request) => {
    const j = await req.ctx.db.one(`SELECT * FROM export_jobs WHERE id = $1 AND workspace_id = $2`, [req.params.id, req.ws!.id]);
    if (!j) throw notFound('Export job');
    if (j.user_id !== req.user!.id) throw forbidden('Only the job owner can do that');
    return j;
  };

  r.get('/exports/:id/scene', requirePerm('export.create'), async (req, res) => {
    const j = await ownJob(req);
    res.json({ scene: j.scene_snapshot, settings: j.settings, format: j.format });
  });

  r.patch('/exports/:id', requirePerm('export.create'), async (req, res) => {
    const body = parse(z.object({ status: z.enum(['processing', 'failed']).optional(), progress: z.number().min(0).max(1).optional(), error: z.object({ message: z.string().max(1000), code: z.string().max(60).optional() }).optional() }), req.body);
    const j = await ownJob(req);
    if (['completed', 'failed', 'cancelled'].includes(j.status)) { res.json({ status: j.status }); return; }
    if (body.status === 'processing' && j.status !== 'queued' && j.status !== 'processing') throw conflict('Invalid transition');
    await req.ctx.db.query(
      `UPDATE export_jobs SET status = coalesce($2, status), progress = coalesce($3, progress), error = coalesce($4, error),
              started_at = CASE WHEN $2 = 'processing' AND started_at IS NULL THEN now() ELSE started_at END,
              finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE finished_at END WHERE id = $1`,
      [j.id, body.status ?? null, body.progress ?? null, body.error ? JSON.stringify(body.error) : null],
    );
    const after = await req.ctx.db.one(`SELECT status FROM export_jobs WHERE id = $1`, [j.id]);
    res.json({ status: after!.status });
  });

  r.post('/exports/:id/cancel', requirePerm('export.create'), async (req, res) => {
    const j = await ownJob(req);
    if (!['queued', 'processing'].includes(j.status)) throw conflict(`Job is already ${j.status}`);
    await req.ctx.db.query(`UPDATE export_jobs SET status = 'cancelled', finished_at = now() WHERE id = $1`, [j.id]);
    res.json({ ok: true });
  });

  r.post('/exports/:id/retry', requirePerm('export.create'), async (req, res) => {
    const j = await ownJob(req);
    if (!['failed', 'cancelled'].includes(j.status)) throw conflict('Only failed or cancelled jobs can be retried');
    const id = uid('exp');
    await req.ctx.db.query(`INSERT INTO export_jobs (id, workspace_id, user_id, source, scene_version_id, scene_snapshot, format, settings) SELECT $1, workspace_id, user_id, source, scene_version_id, scene_snapshot, format, settings FROM export_jobs WHERE id = $2`, [id, j.id]);
    res.status(201).json({ id });
  });

  r.put('/exports/:id/result', requirePerm('export.create'), raw({ type: () => true, limit: '600mb' }), async (req, res) => {
    const j = await ownJob(req);
    if (j.status !== 'processing') throw conflict(`Job is ${j.status}; result rejected`);
    const body = req.body as Buffer;
    const s = Buffer.isBuffer(body) ? sniff(body) : null;
    const expected: Record<string, string> = { png: 'image/png', webp: 'image/webp', mp4: 'video/mp4' };
    if (!s || s.mime !== expected[j.format]) throw badRequest(`Result is not a valid ${j.format.toUpperCase()} file`);
    if (s.width && (s.width !== j.settings.width || s.height !== j.settings.height)) throw badRequest(`Result is ${s.width}×${s.height}, expected ${j.settings.width}×${j.settings.height}`);
    const name = `${slug(j.source.name ?? 'motion')}-${j.settings.width}x${j.settings.height}${j.format === 'mp4' ? `-${j.settings.fps}fps` : ''}.${s.ext}`;
    await completeJob(req, j.id, body, s.mime, name);
    const out = await req.ctx.db.one(`SELECT j.*, f.storage_key, f.filename, f.bytes, f.mime FROM export_jobs j LEFT JOIN exported_files f ON f.id = j.result_file_id WHERE j.id = $1`, [j.id]);
    res.json({ job: jobRow(req, out) });
  });

  return r;
}

async function completeJob(req: Request, jobId: string, data: Buffer, mime: string, filename: string) {
  const { db, storage } = req.ctx, ws = req.ws!.id;
  const fileId = uid('xf');
  const key = `${ws}/exports/${jobId}/${filename}`;
  await storage.put(key, data, mime);
  await db.tx(async (tx) => {
    await tx.query(`INSERT INTO exported_files (id, job_id, workspace_id, storage_key, mime, bytes, filename) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [fileId, jobId, ws, key, mime, data.length, filename]);
    await tx.query(`UPDATE export_jobs SET status = 'completed', progress = 1, result_file_id = $2, finished_at = now(), started_at = coalesce(started_at, now()) WHERE id = $1`, [jobId, fileId]);
    // Exported animations are first-class library assets (same object, no duplicate bytes).
    const assetId = uid('ast'), versionId = uid('av');
    await tx.query(`INSERT INTO media_assets (id, workspace_id, kind, name, category, tags, created_by) VALUES ($1, $2, 'export', $3, 'export', $4, $5)`, [assetId, ws, filename, [mime.split('/')[1]], req.user!.id]);
    await tx.query(`INSERT INTO asset_versions (id, asset_id, workspace_id, version, storage_key, mime, bytes, sha256, created_by) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)`, [versionId, assetId, ws, key, mime, data.length, createHash('sha256').update(data).digest('hex'), req.user!.id]);
    await tx.query(`UPDATE media_assets SET current_version_id = $2 WHERE id = $1`, [assetId, versionId]);
  });
  await audit(db, req, 'export.complete', 'export_job', jobId, { filename, bytes: data.length });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'motion';
