import { Router } from 'express';
import { z } from 'zod';
import { requirePerm } from '../auth';
import { HttpError, badRequest, conflict, notFound, parse } from '../http';
import { audit } from '../audit';
import { createProject } from './projects';
import { sceneAssetIds, syncAssetRefs } from '../services/assets';
import { zip } from '../services/png';
import { RecipeSchema } from '../../shared/motionStyles';
import { CHANNEL_FORMATS } from '../../shared/formats';
import { deserializeScene } from '../../shared/scene/serialize';
import { uid } from '../../shared/util/random';
import type { Request } from 'express';
import type { Db } from '../db';

/**
 * Simple campaigns: one design adapted to several channel sizes, saved together under a brand.
 * Every channel is a normal project with its own scene and recipe, so the advanced editor,
 * exports and analytics links all keep working per channel; the campaign groups them.
 */
const FORMAT_IDS = CHANNEL_FORMATS.map((f) => f.id);
const ItemSchema = z.object({ format: z.string(), doc: z.unknown(), projectId: z.string().max(64).optional(), baseRevision: z.number().int().optional() });
const BodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  brandId: z.string().max(64).optional(),
  recipe: RecipeSchema,
  items: z.array(ItemSchema).min(1).max(FORMAT_IDS.length),
});

/** Create, update, or retire the channel projects so they match `items`. All or nothing. */
async function syncChannels(db: Db, req: Request, campaignId: string, brandId: string | null, body: z.infer<typeof BodySchema>) {
  const formats = body.items.map((i) => i.format);
  if (new Set(formats).size !== formats.length) throw badRequest('Each channel can appear once');
  for (const f of formats) if (!FORMAT_IDS.includes(f)) throw badRequest(`Unknown channel ${f}`);
  const docs = body.items.map((it) => {
    const doc = deserializeScene(it.doc);
    const fmt = CHANNEL_FORMATS.find((c) => c.id === it.format)!;
    if (doc.canvas.width !== fmt.width || doc.canvas.height !== fmt.height) throw badRequest(`${fmt.name} must be ${fmt.width}×${fmt.height}`);
    return doc;
  });
  const existing = await db.query(
    `SELECT p.id, p.motion_campaign_id, s.id AS scene_id, s.revision FROM motion_projects p JOIN motion_scenes s ON s.project_id = p.id
      WHERE p.workspace_id = $1 AND p.deleted_at IS NULL AND (p.motion_campaign_id = $2 OR p.id = ANY($3::text[]))`,
    [req.ws!.id, campaignId, body.items.map((i) => i.projectId).filter(Boolean)],
  );
  const stale: string[] = [];
  for (const it of body.items) {
    if (!it.projectId) continue;
    const p = existing.find((e) => e.id === it.projectId);
    if (!p) throw notFound('Motion');
    if (p.motion_campaign_id && p.motion_campaign_id !== campaignId) throw badRequest('That motion already belongs to another campaign');
    if (it.baseRevision !== p.revision) stale.push(CHANNEL_FORMATS.find((c) => c.id === it.format)!.name);
  }
  if (stale.length) throw conflict(`Someone changed ${stale.join(', ')} since you opened this campaign. Reload to get their version.`, { channels: stale });

  const out: { format: string; projectId: string; revision: number }[] = [];
  await db.tx(async (tx) => {
    for (let i = 0; i < body.items.length; i++) {
      const it = body.items[i], doc = docs[i];
      const recipe = { ...body.recipe, format: it.format };
      const name = `${body.name} · ${CHANNEL_FORMATS.find((c) => c.id === it.format)!.name}`;
      if (it.projectId) {
        const p = existing.find((e) => e.id === it.projectId)!;
        const u = await tx.one(`UPDATE motion_scenes SET doc = $2, revision = revision + 1, updated_by = $3, updated_at = now() WHERE id = $1 AND revision = $4 RETURNING revision`, [p.scene_id, JSON.stringify({ ...doc, meta: { ...doc.meta, name } }), req.user!.id, p.revision]);
        if (!u) throw conflict('A channel changed while saving; reload and try again');
        await tx.query(`UPDATE motion_projects SET name = $2, recipe = $3, recipe_revision = $4, motion_campaign_id = $5, brand_id = coalesce($6, brand_id), updated_at = now() WHERE id = $1`, [p.id, name, JSON.stringify(recipe), u.revision, campaignId, brandId]);
        await syncAssetRefs(tx, req.ws!.id, 'scene', p.scene_id, sceneAssetIds(doc), false);
        out.push({ format: it.format, projectId: p.id, revision: u.revision });
      } else {
        const c = await createProjectTx(tx, req, name, doc, brandId);
        await tx.query(`UPDATE motion_projects SET recipe = $2, recipe_revision = 1, motion_campaign_id = $3 WHERE id = $1`, [c, JSON.stringify(recipe), campaignId]);
        out.push({ format: it.format, projectId: c, revision: 1 });
      }
    }
    // Channels dropped from the campaign are moved to the bin (soft delete), never hard-deleted.
    const keep = out.map((o) => o.projectId);
    await tx.query(`UPDATE motion_projects SET deleted_at = now() WHERE motion_campaign_id = $1 AND deleted_at IS NULL AND NOT (id = ANY($2::text[]))`, [campaignId, keep]);
    await tx.query(`UPDATE motion_campaigns SET name = $2, updated_at = now() WHERE id = $1`, [campaignId, body.name]);
  });
  return out;
}

async function createProjectTx(tx: Db, req: Request, name: string, doc: any, brandId: string | null) {
  const out = await createProject(tx, req.ws!.id, req.user!.id, name, doc, brandId);
  return out.projectId;
}

async function loadCampaign(req: Request) {
  const { db } = req.ctx;
  const c = await db.one(`SELECT c.*, b.name AS brand_name, u.name AS owner FROM motion_campaigns c LEFT JOIN brands b ON b.id = c.brand_id LEFT JOIN users u ON u.id = c.created_by WHERE c.id = $1 AND c.workspace_id = $2 AND c.deleted_at IS NULL`, [req.params.id, req.ws!.id]);
  if (!c) throw notFound('Campaign');
  const channels = await db.query(
    `SELECT p.id, p.name, p.recipe, p.recipe_revision, s.doc, s.revision, s.updated_at AS scene_updated_at,
            e.id AS export_id, e.format AS export_format, e.finished_at AS exported_at, f.storage_key, f.filename
       FROM motion_projects p JOIN motion_scenes s ON s.project_id = p.id
       LEFT JOIN LATERAL (
         SELECT j.* FROM export_jobs j WHERE j.workspace_id = p.workspace_id AND j.source->>'kind' = 'project' AND j.source->>'id' = p.id AND j.status = 'completed'
          ORDER BY j.finished_at DESC LIMIT 1
       ) e ON true
       LEFT JOIN exported_files f ON f.id = e.result_file_id
      WHERE p.motion_campaign_id = $1 AND p.deleted_at IS NULL`,
    [c.id],
  );
  const order = (f: string) => FORMAT_IDS.indexOf(f);
  channels.sort((a, b) => order(a.recipe?.format) - order(b.recipe?.format));
  return { c, channels };
}

export function motionCampaignRoutes() {
  const r = Router();

  r.get('/motion-campaigns', requirePerm('scene.view'), async (req, res) => {
    const rows = await req.ctx.db.query(
      `SELECT c.id, c.name, c.brand_id, b.name AS brand_name, c.updated_at, u.name AS owner,
              (SELECT json_agg(json_build_object('id', p.id, 'format', p.recipe->>'format', 'doc', s.doc) ORDER BY p.created_at)
                 FROM motion_projects p JOIN motion_scenes s ON s.project_id = p.id WHERE p.motion_campaign_id = c.id AND p.deleted_at IS NULL) AS channels
         FROM motion_campaigns c LEFT JOIN brands b ON b.id = c.brand_id LEFT JOIN users u ON u.id = c.created_by
        WHERE c.workspace_id = $1 AND c.deleted_at IS NULL ORDER BY c.updated_at DESC LIMIT 100`,
      [req.ws!.id],
    );
    res.json({ campaigns: rows.map((c) => ({ ...c, channels: c.channels ?? [] })) });
  });

  r.post('/motion-campaigns', requirePerm('scene.create'), async (req, res) => {
    const body = parse(BodySchema, req.body);
    const { db } = req.ctx;
    const brand = body.brandId ? await db.one(`SELECT id FROM brands WHERE id = $1 AND workspace_id = $2`, [body.brandId, req.ws!.id]) : await db.one(`SELECT id FROM brands WHERE workspace_id = $1 ORDER BY created_at LIMIT 1`, [req.ws!.id]);
    if (body.brandId && !brand) throw notFound('Brand');
    // Adopting an existing single motion needs edit rights on it.
    if (body.items.some((i) => i.projectId) && !req.ws!.perms.has('scene.edit')) throw new HttpError(403, 'forbidden', 'You need scene.edit to add an existing motion to a campaign');
    const id = uid('mcp');
    await db.query(`INSERT INTO motion_campaigns (id, workspace_id, brand_id, name, created_by) VALUES ($1, $2, $3, $4, $5)`, [id, req.ws!.id, brand?.id ?? null, body.name, req.user!.id]);
    try {
      const channels = await syncChannels(db, req, id, brand?.id ?? null, body);
      await audit(db, req, 'campaign.create', 'motion_campaign', id, { name: body.name, channels: channels.length });
      res.status(201).json({ id, channels });
    } catch (e) {
      await db.query(`DELETE FROM motion_campaigns WHERE id = $1`, [id]);
      throw e;
    }
  });

  r.get('/motion-campaigns/:id', requirePerm('scene.view'), async (req, res) => {
    const { c, channels } = await loadCampaign(req);
    res.json({
      campaign: { id: c.id, name: c.name, brandId: c.brand_id, brandName: c.brand_name, owner: c.owner, updatedAt: c.updated_at },
      channels: channels.map((p) => ({
        id: p.id, name: p.name, format: p.recipe?.format, recipe: p.recipe, revision: p.revision, recipeRevision: p.recipe_revision, doc: deserializeScene(p.doc),
        export: p.export_id ? { id: p.export_id, format: p.export_format, at: p.exported_at, upToDate: new Date(p.exported_at) >= new Date(p.scene_updated_at), url: p.storage_key ? req.ctx.storage.signedUrl(p.storage_key, 3600, p.filename) : null } : null,
      })),
    });
  });

  r.put('/motion-campaigns/:id', requirePerm('scene.edit'), async (req, res) => {
    const body = parse(BodySchema, req.body);
    const { c } = await loadCampaign(req);
    const channels = await syncChannels(req.ctx.db, req, c.id, c.brand_id, body);
    await audit(req.ctx.db, req, 'campaign.update', 'motion_campaign', c.id, { channels: channels.length });
    res.json({ id: c.id, channels });
  });

  /** Zip of every channel's latest export that is still up to date, plus a manifest. */
  r.get('/motion-campaigns/:id/package', requirePerm('export.create'), async (req, res) => {
    const { c, channels } = await loadCampaign(req);
    const ready = channels.filter((p) => p.storage_key && new Date(p.exported_at) >= new Date(p.scene_updated_at));
    if (!ready.length) throw new HttpError(409, 'nothing_exported', 'Export the channels first — nothing up to date to package yet');
    const files = [];
    for (const p of ready) files.push({ name: `${p.recipe?.format ?? p.id}/${p.filename}`, data: await req.ctx.storage.get(p.storage_key) });
    const missing = channels.filter((p) => !ready.includes(p)).map((p) => p.recipe?.format);
    files.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify({ campaign: c.name, brand: c.brand_name, generatedAt: new Date().toISOString(), files: ready.map((p) => ({ channel: p.recipe?.format, file: `${p.recipe?.format}/${p.filename}`, exportedAt: p.exported_at })), notIncluded: missing }, null, 2)) });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${c.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'campaign'}.zip"`);
    res.end(zip(files));
  });

  r.delete('/motion-campaigns/:id', requirePerm('scene.delete'), async (req, res) => {
    const { c } = await loadCampaign(req);
    await req.ctx.db.tx(async (tx) => {
      await tx.query(`UPDATE motion_campaigns SET deleted_at = now() WHERE id = $1`, [c.id]);
      await tx.query(`UPDATE motion_projects SET deleted_at = now() WHERE motion_campaign_id = $1 AND deleted_at IS NULL`, [c.id]);
    });
    await audit(req.ctx.db, req, 'campaign.delete', 'motion_campaign', c.id, {});
    res.json({ ok: true });
  });

  return r;
}
