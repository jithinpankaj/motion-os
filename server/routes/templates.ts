import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { has, requirePerm } from '../auth';
import { HttpError, badRequest, conflict, forbidden, notFound, parse } from '../http';
import { audit, usage } from '../audit';
import { approveTemplateVersion, loadTemplateVersion, publishTemplateVersion, submitTemplateVersion } from '../services/templates';
import { canTransition, type TemplateStatus } from '../../shared/permissions';
import { deserializeScene } from '../../shared/scene/serialize';
import { paramIssues, applyParameters } from '../../shared/params';
import { analyzeCompatibility, EXPORT_FORMATS } from '../../shared/compat';
import { uid } from '../../shared/util/random';

export function templateRoutes() {
  const r = Router();

  r.post('/projects/:id/submit', requirePerm('template.submit'), async (req, res) => {
    const body = parse(z.object({
      name: z.string().trim().min(1).max(120), description: z.string().max(1000).default(''), category: z.string().max(40).default('General'),
      channels: z.array(z.string()).max(20).default([]), visibleTeamIds: z.array(z.string()).max(50).default([]), changelog: z.string().max(500).default(''),
    }), req.body);
    const { db } = req.ctx;
    const p = await db.one(`SELECT p.id, s.doc FROM motion_projects p JOIN motion_scenes s ON s.project_id = p.id WHERE p.id = $1 AND p.workspace_id = $2 AND p.deleted_at IS NULL`, [req.params.id, req.ws!.id]);
    if (!p) throw notFound('Project');
    const doc = deserializeScene(p.doc);
    const issues = paramIssues(doc);
    if (!doc.exposed.length) issues.unshift('Define at least one editable parameter so other teams can customise this motion.');
    if (issues.length) throw badRequest('Template is not ready for review', issues);
    const out = await db.tx((tx) => submitTemplateVersion(tx, req.ws!.id, req.user!.id, p.id, body));
    await audit(db, req, 'template.submit', 'template_version', out.versionId, { templateId: out.templateId, version: out.version });
    res.status(201).json(out);
  });

  r.get('/approvals', requirePerm('workspace.view'), async (req, res) => {
    const status = String(req.query.status ?? 'pending');
    const rows = await req.ctx.db.query(
      `SELECT a.id, a.subject_type, a.subject_id, a.status, a.note, a.created_at, a.requested_by, u.name AS requested_by_name,
              coalesce(t.name, c.name) AS subject_name, tv.version, tv.template_id, t.project_id
         FROM approval_requests a LEFT JOIN users u ON u.id = a.requested_by
         LEFT JOIN template_versions tv ON a.subject_type = 'template_version' AND tv.id = a.subject_id
         LEFT JOIN motion_templates t ON t.id = tv.template_id
         LEFT JOIN campaigns c ON a.subject_type = 'campaign' AND c.id = a.subject_id
        WHERE a.workspace_id = $1 AND ($2 = 'all' OR a.status = $2) ORDER BY a.created_at DESC LIMIT 100`,
      [req.ws!.id, status],
    );
    res.json({ approvals: rows.map((a) => ({ ...a, canDecide: canDecide(req, a) })) });
  });

  r.post('/approvals/:id/decide', async (req, res) => {
    const body = parse(z.object({ decision: z.enum(['approved', 'rejected']), comment: z.string().max(1000).default('') }), req.body);
    const { db } = req.ctx;
    const a = await db.one(`SELECT * FROM approval_requests WHERE id = $1 AND workspace_id = $2`, [req.params.id, req.ws!.id]);
    if (!a) throw notFound('Approval request');
    if (a.status !== 'pending') throw conflict(`This request was already ${a.status}`);
    if (!canDecide(req, a)) throw forbidden(a.requested_by === req.user!.id ? 'You cannot approve your own submission. Ask another approver or an admin.' : 'You do not have permission to decide on this request');
    await db.tx(async (tx) => {
      await tx.query(`UPDATE approval_requests SET status = $2, decided_at = now() WHERE id = $1`, [a.id, body.decision]);
      await tx.query(`INSERT INTO approval_decisions (id, request_id, decided_by, decision, comment) VALUES ($1, $2, $3, $4, $5)`, [uid('dec'), a.id, req.user!.id, body.decision, body.comment]);
      if (a.subject_type === 'template_version') await approveTemplateVersion(tx, req.ws!.id, a.subject_id, body.decision === 'approved');
      else await tx.query(`UPDATE campaigns SET approval_status = $2, updated_at = now() WHERE id = $1 AND workspace_id = $3`, [a.subject_id, body.decision, req.ws!.id]);
    });
    await audit(db, req, 'approval.decision', a.subject_type, a.subject_id, { decision: body.decision, comment: body.comment, requestId: a.id });
    res.json({ ok: true });
  });

  r.post('/templates/:id/publish', requirePerm('template.publish'), async (req, res) => {
    const body = parse(z.object({ versionId: z.string() }), req.body);
    const { db } = req.ctx;
    const tv = await db.one(`SELECT tv.status, t.status AS tstatus FROM template_versions tv JOIN motion_templates t ON t.id = tv.template_id WHERE tv.id = $1 AND tv.template_id = $2 AND tv.workspace_id = $3`, [body.versionId, req.params.id, req.ws!.id]);
    if (!tv) throw notFound('Template version');
    if (tv.status !== 'approved') throw conflict(`Only approved versions can be published (this version is ${tv.status})`);
    const out = await db.tx((tx) => publishTemplateVersion(tx, req.ws!.id, String(req.params.id), body.versionId));
    await audit(db, req, 'asset.publish', 'template', String(req.params.id), { versionId: body.versionId, assetPins: out.pins });
    res.json({ ok: true });
  });

  r.post('/templates/:id/status', async (req, res) => {
    const body = parse(z.object({ status: z.enum(['deprecated', 'archived', 'published']) }), req.body);
    const { db } = req.ctx;
    const t = await db.one(`SELECT * FROM motion_templates WHERE id = $1 AND workspace_id = $2`, [req.params.id, req.ws!.id]);
    if (!t) throw notFound('Template');
    const check = canTransition(t.status as TemplateStatus, body.status, [...req.ws!.perms]);
    if (!check.ok) throw new HttpError(check.reason?.startsWith('Requires') ? 403 : 409, 'transition', check.reason!);
    await db.query(`UPDATE motion_templates SET status = $2, updated_at = now() WHERE id = $1`, [t.id, body.status]);
    await audit(db, req, `template.${body.status}`, 'template', t.id, { from: t.status });
    res.json({ ok: true });
  });

  r.delete('/templates/:id', requirePerm('template.deprecate'), async (req, res) => {
    const { db } = req.ctx;
    const t = await db.one(`SELECT * FROM motion_templates WHERE id = $1 AND workspace_id = $2`, [req.params.id, req.ws!.id]);
    if (!t) throw notFound('Template');
    const used = await db.one(`SELECT count(*)::int AS n FROM campaigns WHERE template_id = $1`, [t.id]);
    if (used!.n) throw conflict(`${used!.n} campaign(s) use this template. Deprecate or archive it instead; published outputs must stay reproducible.`);
    await db.query(`UPDATE motion_templates SET status = 'archived', updated_at = now() WHERE id = $1`, [t.id]);
    await audit(db, req, 'template.delete', 'template', t.id, { name: t.name });
    res.json({ ok: true });
  });

  r.get('/library', requirePerm('library.view'), async (req, res) => {
    const seeAll = has(req, 'scene.view') || has(req, 'workspace.manage');
    const rows = await req.ctx.db.query(
      `SELECT t.id, t.name, t.description, t.category, t.interaction, t.channels, t.status, t.visible_team_ids, t.brand_id, b.name AS brand_name,
              tv.id AS version_id, tv.version, tv.published_at, sv.doc, u.name AS author,
              (SELECT count(*)::int FROM usage_events e WHERE e.subject_id = t.id) AS uses
         FROM motion_templates t JOIN template_versions tv ON tv.id = t.published_version_id JOIN scene_versions sv ON sv.id = tv.scene_version_id
         LEFT JOIN brands b ON b.id = t.brand_id LEFT JOIN users u ON u.id = t.created_by
        WHERE t.workspace_id = $1 AND t.status IN ('published', 'deprecated')
          AND ($2 OR cardinality(t.visible_team_ids) = 0 OR t.visible_team_ids && $3::text[])
        ORDER BY t.status = 'deprecated', tv.published_at DESC`,
      [req.ws!.id, seeAll, req.ws!.teams],
    );
    const teams = await req.ctx.db.query(`SELECT id, name FROM teams WHERE workspace_id = $1`, [req.ws!.id]);
    res.json({
      teams,
      templates: rows.map((t) => {
        const doc = deserializeScene(t.doc);
        const compat = Object.fromEntries(EXPORT_FORMATS.filter((f) => f.implemented).map((f) => [f.id, analyzeCompatibility(doc, f.id).status]));
        const colors = [...new Set(doc.layers.flatMap((l: any) => (l.type === 'gradient' ? l.props.stops.map((s: any) => s.color) : l.type === 'particles' ? [l.props.colorA, l.props.colorB] : l.type === 'mesh' ? [l.props.material.color, l.props.material.color2] : [])))];
        return { ...t, doc, compat, colors, params: doc.exposed.map((p) => ({ key: p.key, label: p.label, type: p.type, locked: !!p.locked })) };
      }),
    });
  });

  r.get('/templates/:id', requirePerm('library.view'), async (req, res) => {
    const { db } = req.ctx;
    const t = await db.one(`SELECT * FROM motion_templates WHERE id = $1 AND workspace_id = $2`, [req.params.id, req.ws!.id]);
    if (!t) throw notFound('Template');
    const seeAll = has(req, 'scene.view') || has(req, 'workspace.manage');
    if (!seeAll && (!['published', 'deprecated'].includes(t.status) || (t.visible_team_ids.length && !t.visible_team_ids.some((x: string) => req.ws!.teams.includes(x))))) throw notFound('Template');
    const versionId = String(req.query.version ?? t.published_version_id ?? '');
    if (!versionId) throw notFound('Published version');
    const tv = await loadTemplateVersion(db, req.ws!.id, versionId);
    if (!tv || tv.template_id !== t.id) throw notFound('Template version');
    if (!seeAll && tv.status !== 'published') throw notFound('Template version');
    const versions = await db.query(`SELECT id, version, status, changelog, published_at, created_at FROM template_versions WHERE template_id = $1 ORDER BY version DESC`, [t.id]);
    await usage(db, req, 'template.open', t.id);
    res.json({ template: { id: t.id, name: t.name, description: t.description, category: t.category, status: t.status, channels: t.channels, publishedVersionId: t.published_version_id }, version: tv, versions: seeAll ? versions : versions.filter((v) => v.status === 'published') });
  });

  r.post('/templates/:id/resolve', requirePerm('template.use'), async (req, res) => {
    const body = parse(z.object({ versionId: z.string(), values: z.record(z.string(), z.unknown()) }), req.body);
    const tv = await loadTemplateVersion(req.ctx.db, req.ws!.id, body.versionId);
    if (!tv || tv.template_id !== req.params.id) throw notFound('Template version');
    const out = applyParameters(tv.doc, body.values, { roles: req.ws!.roles });
    res.json({ errors: out.errors, applied: out.applied });
  });

  r.get('/templates/:id/delivery', requirePerm('template.code'), async (req, res) => {
    const { db } = req.ctx;
    const t = await db.one(`SELECT * FROM motion_templates WHERE id = $1 AND workspace_id = $2 AND status IN ('published', 'deprecated')`, [req.params.id, req.ws!.id]);
    if (!t) throw notFound('Published template');
    const tv = await loadTemplateVersion(db, req.ws!.id, String(req.query.version ?? t.published_version_id));
    if (!tv || tv.status !== 'published') throw notFound('Published version');
    const doc = tv.doc;
    const sceneJson = JSON.stringify(doc);
    const config = {
      schema: 'motion-os/embed@1',
      template: { id: t.id, name: t.name, version: tv.version, versionId: tv.id },
      integrity: `sha256-${createHash('sha256').update(sceneJson).digest('base64')}`,
      params: Object.fromEntries(doc.exposed.filter((p) => !p.locked).map((p) => [p.key, p.default])),
      accessibility: { reducedMotion: doc.fallback.reducedMotion, staticFrame: doc.fallback.staticFrame, label: `${t.name}: ${t.description}`.slice(0, 200) },
      performance: { maxDpr: 2, pauseWhenHidden: true },
      scene: doc,
    };
    const compat = analyzeCompatibility(doc, 'embed');
    const stats = {
      layers: doc.layers.length,
      particles: doc.layers.reduce((n, l: any) => n + (l.type === 'particles' ? l.props.count : 0), 0),
      meshes: doc.layers.filter((l) => l.type === 'mesh').length,
      textLayers: doc.layers.filter((l) => l.type === 'text').length,
      assetPins: tv.asset_pins,
      configBytes: Buffer.byteLength(JSON.stringify(config)),
    };
    await usage(db, req, 'template.delivery', t.id, { version: tv.version });
    res.json({ config, compat, stats, deprecated: t.status === 'deprecated' });
  });

  return r;
}

function canDecide(req: any, a: { subject_type: string; requested_by: string | null; status: string }) {
  const perm = a.subject_type === 'campaign' ? 'campaign.approve' : 'template.approve';
  if (!req.ws.perms.has(perm) || a.status !== 'pending') return false;
  const elevated = req.ws.roles.includes('owner') || req.ws.roles.includes('admin');
  return a.requested_by !== req.user.id || elevated;
}
