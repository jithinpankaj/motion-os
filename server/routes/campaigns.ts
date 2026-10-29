import { Router } from 'express';
import { z } from 'zod';
import { has, requirePerm } from '../auth';
import { badRequest, conflict, forbidden, notFound, parse } from '../http';
import { audit } from '../audit';
import { loadTemplateVersion } from '../services/templates';
import { applyParameters } from '../../shared/params';
import { changedKeys, resolveVariation, upgradeValues } from '../../shared/inheritance';
import { formatById } from '../../shared/formats';
import { uid } from '../../shared/util/random';
import type { Db } from '../db';
import type { Request } from 'express';

async function loadCampaign(db: Db, req: Request) {
  const c = await db.one(`SELECT c.*, u.name AS owner_name FROM campaigns c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = $1 AND c.workspace_id = $2`, [req.params.id, req.ws!.id]);
  if (!c) throw notFound('Campaign');
  const tv = await loadTemplateVersion(db, req.ws!.id, c.template_version_id);
  const tpl = await db.one(`SELECT t.id, t.name, t.status, t.published_version_id, tv.version AS latest_version FROM motion_templates t LEFT JOIN template_versions tv ON tv.id = t.published_version_id WHERE t.id = $1`, [c.template_id]);
  const variations = await db.query(`SELECT * FROM campaign_variations WHERE campaign_id = $1 ORDER BY created_at`, [c.id]);
  const overrides = await db.query(`SELECT variation_id, param_key, value FROM content_overrides WHERE variation_id = ANY($1::text[])`, [variations.map((v) => v.id)]);
  const params = tv!.doc.exposed;
  const vs = variations.map((v) => {
    const ov = Object.fromEntries(overrides.filter((o) => o.variation_id === v.id).map((o) => [o.param_key, o.value]));
    const { values, sources } = resolveVariation(params, c.master_values, ov);
    const snap = v.published_snapshot;
    const dirty = snap ? snap.templateVersionId !== c.template_version_id || changedKeys(snap.values, values).length > 0 : null;
    return { id: v.id, channel: v.channel_preset_id, name: v.name, overrides: ov, values, sources, publishedSnapshot: snap, publishedAt: v.published_at, dirty };
  });
  return { c, tv: tv!, tpl, variations: vs };
}

function validateValues(doc: any, values: Record<string, unknown>, roles: string[]) {
  const out = applyParameters(doc, values, { roles });
  if (out.errors.length) throw badRequest(out.errors.map((e) => e.message).join('; '), out.errors);
  return out.applied;
}

export function campaignRoutes() {
  const r = Router();

  r.get('/campaigns', requirePerm('campaign.view'), async (req, res) => {
    const rows = await req.ctx.db.query(
      `SELECT c.id, c.name, c.description, c.approval_status, c.publishing_status, c.updated_at, c.template_id, c.template_version_id, t.name AS template_name, u.name AS owner,
              sv.doc, (SELECT array_agg(channel_preset_id) FROM campaign_variations v WHERE v.campaign_id = c.id) AS channels,
              (t.published_version_id <> c.template_version_id) AS upgrade_available
         FROM campaigns c JOIN motion_templates t ON t.id = c.template_id JOIN template_versions tv ON tv.id = c.template_version_id JOIN scene_versions sv ON sv.id = tv.scene_version_id
         LEFT JOIN users u ON u.id = c.owner_id WHERE c.workspace_id = $1 ORDER BY c.updated_at DESC`,
      [req.ws!.id],
    );
    res.json({ campaigns: rows });
  });

  r.post('/campaigns', requirePerm('campaign.edit'), async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).default(''), templateId: z.string(), channels: z.array(z.string()).min(1).max(8), masterValues: z.record(z.string(), z.unknown()).default({}) }), req.body);
    const { db } = req.ctx;
    const t = await db.one(`SELECT * FROM motion_templates WHERE id = $1 AND workspace_id = $2 AND status = 'published'`, [body.templateId, req.ws!.id]);
    if (!t) throw badRequest('Choose a published template. Deprecated templates cannot start new campaigns.');
    if (!has(req, 'scene.view') && t.visible_team_ids.length && !t.visible_team_ids.some((x: string) => req.ws!.teams.includes(x))) throw forbidden('This template is not available to your team');
    const bad = body.channels.filter((c) => !formatById(c));
    if (bad.length) throw badRequest(`Unknown channels: ${bad.join(', ')}`);
    const tv = await loadTemplateVersion(db, req.ws!.id, t.published_version_id);
    const master = validateValues(tv!.doc, body.masterValues, req.ws!.roles);
    const id = uid('cmp');
    await db.tx(async (tx) => {
      await tx.query(`INSERT INTO campaigns (id, workspace_id, brand_id, owner_id, family_id, template_id, template_version_id, name, description, master_values) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [id, req.ws!.id, t.brand_id, req.user!.id, t.family_id, t.id, t.published_version_id, body.name, body.description, JSON.stringify(master)]);
      for (const ch of [...new Set(body.channels)]) await tx.query(`INSERT INTO campaign_variations (id, campaign_id, workspace_id, channel_preset_id, name) VALUES ($1, $2, $3, $4, $5)`, [uid('var'), id, req.ws!.id, ch, formatById(ch)!.name]);
    });
    await audit(db, req, 'campaign.create', 'campaign', id, { template: t.id, channels: body.channels });
    res.status(201).json({ id });
  });

  r.get('/campaigns/:id', requirePerm('campaign.view'), async (req, res) => {
    const { c, tv, tpl, variations } = await loadCampaign(req.ctx.db, req);
    res.json({
      campaign: { id: c.id, name: c.name, description: c.description, owner: c.owner_name, approvalStatus: c.approval_status, publishingStatus: c.publishing_status, updatedAt: c.updated_at, masterValues: c.master_values },
      template: { id: tpl!.id, name: tpl!.name, status: tpl!.status, latestVersionId: tpl!.published_version_id, latestVersion: tpl!.latest_version },
      version: { id: tv.id, version: tv.version, doc: tv.doc, assetPins: tv.asset_pins },
      variations,
      upgradeAvailable: !!tpl!.published_version_id && tpl!.published_version_id !== c.template_version_id,
    });
  });

  r.put('/campaigns/:id/master', requirePerm('campaign.edit'), async (req, res) => {
    const body = parse(z.object({ values: z.record(z.string(), z.unknown()) }), req.body);
    const { db } = req.ctx;
    const { c, tv, variations } = await loadCampaign(db, req);
    const valid = validateValues(tv.doc, body.values, req.ws!.roles);
    const master = { ...c.master_values, ...valid };
    await db.query(`UPDATE campaigns SET master_values = $2, updated_at = now() WHERE id = $1`, [c.id, JSON.stringify(master)]);
    // Local overrides are never touched by master edits; report which variations keep their own value.
    const shadowed = Object.fromEntries(Object.keys(valid).map((k) => [k, variations.filter((v) => k in v.overrides).map((v) => v.channel)]));
    res.json({ ok: true, shadowed });
  });

  r.put('/campaigns/:id/variations/:vid/overrides/:key', requirePerm('campaign.edit'), async (req, res) => {
    const body = parse(z.object({ value: z.unknown() }), req.body);
    const { db } = req.ctx;
    const { tv, variations } = await loadCampaign(db, req);
    if (!variations.some((v) => v.id === req.params.vid)) throw notFound('Variation');
    const key = String(req.params.key);
    const valid = validateValues(tv.doc, { [key]: body.value }, req.ws!.roles);
    await db.query(
      `INSERT INTO content_overrides (id, variation_id, workspace_id, param_key, value, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (variation_id, param_key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [uid('ovr'), req.params.vid, req.ws!.id, key, JSON.stringify(valid[key]), req.user!.id],
    );
    await db.query(`UPDATE campaigns SET updated_at = now() WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  });

  r.delete('/campaigns/:id/variations/:vid/overrides/:key', requirePerm('campaign.edit'), async (req, res) => {
    const { db } = req.ctx;
    await loadCampaign(db, req);
    await db.query(`DELETE FROM content_overrides WHERE variation_id = $1 AND param_key = $2 AND workspace_id = $3`, [req.params.vid, req.params.key, req.ws!.id]);
    res.json({ ok: true });
  });

  r.post('/campaigns/:id/variations', requirePerm('campaign.edit'), async (req, res) => {
    const body = parse(z.object({ channel: z.string() }), req.body);
    const f = formatById(body.channel);
    if (!f) throw badRequest('Unknown channel');
    await loadCampaign(req.ctx.db, req);
    await req.ctx.db.query(`INSERT INTO campaign_variations (id, campaign_id, workspace_id, channel_preset_id, name) VALUES ($1, $2, $3, $4, $5)`, [uid('var'), req.params.id, req.ws!.id, f.id, f.name]).catch(() => { throw conflict('That channel already exists in this campaign'); });
    res.status(201).json({ ok: true });
  });

  r.delete('/campaigns/:id/variations/:vid', requirePerm('campaign.edit'), async (req, res) => {
    const { variations } = await loadCampaign(req.ctx.db, req);
    const v = variations.find((x) => x.id === req.params.vid);
    if (!v) throw notFound('Variation');
    if (v.publishedSnapshot) throw conflict('Published variations cannot be deleted');
    await req.ctx.db.query(`DELETE FROM campaign_variations WHERE id = $1`, [v.id]);
    res.json({ ok: true });
  });

  r.post('/campaigns/:id/upgrade', requirePerm('campaign.edit'), async (req, res) => {
    const { db } = req.ctx;
    const { c, tpl, variations } = await loadCampaign(db, req);
    if (!tpl?.published_version_id || tpl.published_version_id === c.template_version_id) throw conflict('Already on the latest published version');
    const next = await loadTemplateVersion(db, req.ws!.id, tpl.published_version_id);
    const m = upgradeValues(next!.doc.exposed, c.master_values);
    const dropped = m.dropped.map((d) => ({ ...d, scope: 'master' }));
    await db.tx(async (tx) => {
      await tx.query(`UPDATE campaigns SET template_version_id = $2, master_values = $3, updated_at = now() WHERE id = $1`, [c.id, next!.id, JSON.stringify(m.values)]);
      for (const v of variations) {
        const u = upgradeValues(next!.doc.exposed, v.overrides);
        for (const d of u.dropped) {
          dropped.push({ ...d, scope: v.channel });
          await tx.query(`DELETE FROM content_overrides WHERE variation_id = $1 AND param_key = $2`, [v.id, d.key]);
        }
      }
    });
    await audit(db, req, 'campaign.upgrade', 'campaign', c.id, { from: c.template_version_id, to: next!.id, dropped });
    res.json({ ok: true, dropped });
  });

  r.post('/campaigns/:id/submit', requirePerm('campaign.edit'), async (req, res) => {
    const { db } = req.ctx;
    const { c } = await loadCampaign(db, req);
    if (c.approval_status === 'review') throw conflict('Already in review');
    const reqId = uid('apr');
    await db.tx(async (tx) => {
      await tx.query(`INSERT INTO approval_requests (id, workspace_id, subject_type, subject_id, requested_by, note) VALUES ($1, $2, 'campaign', $3, $4, $5)`, [reqId, req.ws!.id, c.id, req.user!.id, `Campaign ${c.name}`]);
      await tx.query(`INSERT INTO campaign_approvals (id, campaign_id, approval_request_id) VALUES ($1, $2, $3)`, [uid('ca'), c.id, reqId]);
      await tx.query(`UPDATE campaigns SET approval_status = 'review', updated_at = now() WHERE id = $1`, [c.id]);
    });
    await audit(db, req, 'campaign.submit', 'campaign', c.id);
    res.json({ ok: true, approvalRequestId: reqId });
  });

  r.post('/campaigns/:id/publish', requirePerm('campaign.approve'), async (req, res) => {
    const { db } = req.ctx;
    const { c, variations } = await loadCampaign(db, req);
    if (c.approval_status !== 'approved') throw conflict('Campaigns must be approved before publication');
    await db.tx(async (tx) => {
      for (const v of variations) {
        const snapshot = { templateVersionId: c.template_version_id, values: v.values, channel: v.channel, publishedBy: req.user!.id };
        await tx.query(`UPDATE campaign_variations SET published_snapshot = $2, published_at = now() WHERE id = $1`, [v.id, JSON.stringify(snapshot)]);
        await tx.query(`INSERT INTO published_assets (id, workspace_id, template_id, template_version_id, variation_id, kind, config, created_by) VALUES ($1, $2, $3, $4, $5, 'campaign_variation', $6, $7)`, [uid('pub'), req.ws!.id, c.template_id, c.template_version_id, v.id, JSON.stringify(snapshot), req.user!.id]);
      }
      await tx.query(`UPDATE campaigns SET publishing_status = 'published', updated_at = now() WHERE id = $1`, [c.id]);
    });
    await audit(db, req, 'asset.publish', 'campaign', c.id, { variations: variations.length });
    res.json({ ok: true });
  });

  return r;
}
