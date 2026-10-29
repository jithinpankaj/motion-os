import { Router } from 'express';
import { z } from 'zod';
import { has, requirePerm } from '../auth';
import { parse } from '../http';
import { loadTemplateVersion } from '../services/templates';
import { answer } from '../../shared/assistant';
import { deserializeScene } from '../../shared/scene/serialize';

export function homeRoutes() {
  const r = Router();

  r.get('/home', requirePerm('workspace.view'), async (req, res) => {
    const { db } = req.ctx, ws = req.ws!.id;
    const seeAll = has(req, 'scene.view');
    const projects = seeAll ? await db.query(`SELECT p.id, p.name, p.updated_at, s.doc, u.name AS updated_by FROM motion_projects p JOIN motion_scenes s ON s.project_id = p.id LEFT JOIN users u ON u.id = s.updated_by WHERE p.workspace_id = $1 AND p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 8`, [ws]) : [];
    const templates = has(req, 'library.view') ? await db.query(
      `SELECT t.id, t.name, t.category, t.description, t.status, tv.published_at, tv.version, sv.doc,
              (SELECT count(*)::int FROM usage_events e WHERE e.subject_id = t.id) AS uses
         FROM motion_templates t JOIN template_versions tv ON tv.id = t.published_version_id JOIN scene_versions sv ON sv.id = tv.scene_version_id
        WHERE t.workspace_id = $1 AND t.status = 'published' AND ($2 OR cardinality(t.visible_team_ids) = 0 OR t.visible_team_ids && $3::text[])
        ORDER BY tv.published_at DESC LIMIT 12`,
      [ws, seeAll, req.ws!.teams],
    ) : [];
    const campaigns = has(req, 'campaign.view') ? await db.query(`SELECT c.id, c.name, c.approval_status, c.publishing_status, c.updated_at, sv.doc, (SELECT array_agg(channel_preset_id) FROM campaign_variations v WHERE v.campaign_id = c.id) AS channels FROM campaigns c JOIN template_versions tv ON tv.id = c.template_version_id JOIN scene_versions sv ON sv.id = tv.scene_version_id WHERE c.workspace_id = $1 ORDER BY c.updated_at DESC LIMIT 6`, [ws]) : [];
    const approvals = await db.query(
      `SELECT a.id, a.subject_type, a.status, a.created_at, a.requested_by, u.name AS requested_by_name, coalesce(t.name, c.name) AS subject_name, tv.version, t.project_id, t.id AS template_id
         FROM approval_requests a LEFT JOIN users u ON u.id = a.requested_by
         LEFT JOIN template_versions tv ON a.subject_type = 'template_version' AND tv.id = a.subject_id LEFT JOIN motion_templates t ON t.id = tv.template_id
         LEFT JOIN campaigns c ON a.subject_type = 'campaign' AND c.id = a.subject_id
        WHERE a.workspace_id = $1 AND a.status = 'pending' ORDER BY a.created_at DESC LIMIT 10`,
      [ws],
    );
    const activity = await db.query(
      `SELECT a.action, a.subject_type, a.data, a.created_at, u.name AS actor FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.workspace_id = $1 AND a.action NOT LIKE 'permission.%' ORDER BY a.id DESC LIMIT 14`,
      [ws],
    );
    const recentlyPublished = [...templates].sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at)).slice(0, 4);
    const recommended = [...templates].sort((a, b) => a.uses - b.uses || a.name.localeCompare(b.name)).slice(0, 4);
    res.json({ projects, templates, campaigns, approvals, activity, recentlyPublished: recentlyPublished.map((t) => t.id), recommended: recommended.map((t) => t.id) });
  });

  r.post('/assistant', requirePerm('library.view'), async (req, res) => {
    const body = parse(z.object({ query: z.string().trim().min(1).max(300), versionId: z.string().optional(), values: z.record(z.string(), z.unknown()).default({}), format: z.string().optional(), scene: z.unknown().optional() }), req.body);
    const { db } = req.ctx, ws = req.ws!.id;
    const seeAll = has(req, 'scene.view');
    const rows = await db.query(`SELECT t.id, t.name, t.description, t.category, t.interaction, t.channels, sv.doc FROM motion_templates t JOIN template_versions tv ON tv.id = t.published_version_id JOIN scene_versions sv ON sv.id = tv.scene_version_id WHERE t.workspace_id = $1 AND t.status = 'published' AND ($2 OR cardinality(t.visible_team_ids) = 0 OR t.visible_team_ids && $3::text[])`, [ws, seeAll, req.ws!.teams]);
    const templates = rows.map((t) => {
      const doc = deserializeScene(t.doc);
      return { id: t.id, name: t.name, description: t.description, category: t.category, interaction: t.interaction, channels: t.channels, tags: doc.meta.tags, colors: doc.layers.flatMap((l: any) => (l.type === 'gradient' ? l.props.stops.map((s: any) => s.color) : l.type === 'particles' ? [l.props.colorA] : l.type === 'mesh' ? [l.props.material.color] : [])) };
    });
    let scene;
    if (body.versionId) scene = (await loadTemplateVersion(db, ws, body.versionId))?.doc;
    else if (body.scene && seeAll) scene = deserializeScene(body.scene);
    const brand = await db.query(`SELECT key, value FROM brand_tokens WHERE workspace_id = $1 AND category = 'color'`, [ws]);
    res.json(answer(body.query, { templates, scene, values: body.values, brandColors: Object.fromEntries(brand.map((b) => [b.key, b.value])), format: body.format }));
  });

  return r;
}
