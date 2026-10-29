import { Router } from 'express';
import { z } from 'zod';
import { requirePerm } from '../auth';
import { HttpError, badRequest, notFound, parse, rateLimit } from '../http';
import { audit } from '../audit';
import { mask, seal, unseal } from '../services/secrets';
import {
  defaultLinkedInVersion, ga4Metrics, ga4Verify, linkedinMetrics, linkedinVerify, metaMetrics, metaVerify,
  parseLinkedInPost, parseServiceAccount, type MetricResult,
} from '../analytics/providers';
import { uid } from '../../shared/util/random';

const PROVIDERS = ['ga4', 'meta', 'linkedin'] as const;
type Provider = (typeof PROVIDERS)[number];
const KIND_PROVIDER: Record<string, Provider> = { ga4: 'ga4', instagram: 'meta', facebook: 'meta', linkedin: 'linkedin' };
const limit = rateLimit({ name: 'analytics', windowMs: 60_000, max: 30, key: (r) => r.user?.id ?? r.ip ?? 'x' });

/** Short, stable utm_content value for a motion so GA4 can attribute visits to it. */
export const utmContent = (projectId: string) => `motion-${projectId.replace(/^prj_/, '').toLowerCase()}`;

export function analyticsRoutes() {
  const r = Router();

  const connections = async (req: any) => (await req.ctx.db.query(
    `SELECT id, provider, status, config, checked_at, last_error, created_at FROM integration_connections WHERE workspace_id = $1 AND provider = ANY($2::text[]) AND status <> 'disconnected' ORDER BY created_at`,
    [req.ws.id, PROVIDERS],
  )).map((c: any) => ({ id: c.id, provider: c.provider, status: c.status, label: c.config.label, hint: c.config.hint, checkedAt: c.checked_at, error: c.last_error }));

  r.get('/analytics/connections', requirePerm('analytics.view'), async (req, res) => res.json({ connections: await connections(req) }));

  r.post('/analytics/connections/:provider', requirePerm('analytics.manage'), limit, async (req, res) => {
    const provider = z.enum(PROVIDERS).parse(req.params.provider);
    let config: Record<string, string>, secret: Record<string, string>, label: string;
    if (provider === 'ga4') {
      const b = parse(z.object({ serviceAccountJson: z.string().min(50).max(20000), propertyId: z.string().trim().max(20) }), req.body);
      const sa = parseServiceAccount(b.serviceAccountJson);
      label = (await ga4Verify(sa, b.propertyId)).label;
      config = { propertyId: b.propertyId, hint: sa.client_email };
      secret = sa as any;
    } else if (provider === 'meta') {
      const b = parse(z.object({ accessToken: z.string().trim().min(20).max(1000) }), req.body);
      label = (await metaVerify(b.accessToken)).label;
      config = { hint: mask(b.accessToken) };
      secret = { token: b.accessToken };
    } else {
      const b = parse(z.object({ accessToken: z.string().trim().min(20).max(2000), organizationId: z.string().trim().max(20), version: z.string().regex(/^\d{6}$/).optional() }), req.body);
      const version = b.version ?? defaultLinkedInVersion();
      label = (await linkedinVerify(b.accessToken, b.organizationId, version)).label;
      config = { organizationId: b.organizationId, version, hint: mask(b.accessToken) };
      secret = { token: b.accessToken };
    }
    const { db } = req.ctx;
    await db.query(`UPDATE integration_connections SET status = 'disconnected', secret_enc = NULL WHERE workspace_id = $1 AND provider = $2 AND status <> 'disconnected'`, [req.ws!.id, provider]);
    const id = uid('conn');
    // Marked connected only after the provider accepted the credentials above.
    await db.query(`INSERT INTO integration_connections (id, workspace_id, provider, status, config, secret_enc, created_by, checked_at) VALUES ($1, $2, $3, 'connected', $4, $5, $6, now())`,
      [id, req.ws!.id, provider, JSON.stringify({ ...config, label }), seal(req.ctx.secret, secret), req.user!.id]);
    // Re-point existing links for this provider to the new connection.
    await db.query(`UPDATE analytics_links l SET connection_id = $1 FROM integration_connections c WHERE c.id = l.connection_id AND c.provider = $2 AND l.workspace_id = $3`, [id, provider, req.ws!.id]);
    await audit(db, req, 'integration.connect', 'integration', id, { provider });
    res.status(201).json({ id, label });
  });

  r.delete('/analytics/connections/:id', requirePerm('analytics.manage'), async (req, res) => {
    await req.ctx.db.query(`UPDATE integration_connections SET status = 'disconnected', secret_enc = NULL WHERE id = $1 AND workspace_id = $2 AND provider = ANY($3::text[])`, [req.params.id, req.ws!.id, PROVIDERS]);
    res.json({ ok: true });
  });

  r.post('/analytics/links', requirePerm('analytics.manage'), async (req, res) => {
    const b = parse(z.object({ projectId: z.string().max(64), kind: z.enum(['ga4', 'instagram', 'facebook', 'linkedin']), ref: z.string().trim().max(500).optional(), label: z.string().max(120).default('') }), req.body);
    const { db } = req.ctx;
    const p = await db.one(`SELECT id, name FROM motion_projects WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [b.projectId, req.ws!.id]);
    if (!p) throw notFound('Motion');
    const conn = await db.one(`SELECT id FROM integration_connections WHERE workspace_id = $1 AND provider = $2 AND status = 'connected' ORDER BY created_at DESC LIMIT 1`, [req.ws!.id, KIND_PROVIDER[b.kind]]);
    if (!conn) throw new HttpError(422, 'not_connected', 'Connect that account first');
    let ref: string;
    if (b.kind === 'ga4') ref = utmContent(p.id);
    else if (b.kind === 'linkedin') ref = parseLinkedInPost(b.ref ?? '');
    else {
      ref = (b.ref ?? '').trim();
      if (!/^\d+(_\d+)?$/.test(ref)) throw badRequest(b.kind === 'instagram' ? 'Instagram media IDs are long numbers (Meta Business Suite → post → “…” → Copy ID, or the Graph API Explorer)' : 'Facebook post IDs look like 123456789_987654321 (page ID _ post ID)');
    }
    const id = uid('anl');
    await db.query(`INSERT INTO analytics_links (id, workspace_id, project_id, connection_id, kind, ref, label, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, req.ws!.id, p.id, conn.id, b.kind, ref, b.label, req.user!.id]);
    res.status(201).json({ id, ref });
  });

  r.delete('/analytics/links/:id', requirePerm('analytics.manage'), async (req, res) => {
    await req.ctx.db.query(`DELETE FROM analytics_links WHERE id = $1 AND workspace_id = $2`, [req.params.id, req.ws!.id]);
    res.json({ ok: true });
  });

  /** Fetch fresh numbers from the provider. Failures are stored and shown — never replaced with guesses. */
  r.post('/analytics/links/:id/refresh', requirePerm('analytics.view'), limit, async (req, res) => {
    const { db } = req.ctx;
    const l = await db.one(`SELECT l.*, c.secret_enc, c.config, c.status AS conn_status FROM analytics_links l JOIN integration_connections c ON c.id = l.connection_id WHERE l.id = $1 AND l.workspace_id = $2`, [req.params.id, req.ws!.id]);
    if (!l) throw notFound('Linked post');
    let result: MetricResult | null = null, error: string | null = null;
    try {
      if (l.conn_status !== 'connected' || !l.secret_enc) throw new HttpError(422, 'not_connected', 'The account connection was removed. Reconnect it in Analytics → Connections.');
      const s = unseal(req.ctx.secret, l.secret_enc);
      if (l.kind === 'ga4') result = await ga4Metrics(s, l.config.propertyId, l.ref);
      else if (l.kind === 'instagram' || l.kind === 'facebook') result = await metaMetrics(s.token, l.kind, l.ref);
      else result = await linkedinMetrics(s.token, l.config.organizationId, l.config.version, l.ref);
    } catch (e: any) { error = e instanceof HttpError ? e.message : 'The provider could not be reached'; }
    await db.query(`INSERT INTO analytics_snapshots (id, link_id, ok, metrics, series, series_label, error) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uid('snap'), l.id, !error, JSON.stringify(result?.metrics ?? {}), JSON.stringify(result?.series ?? []), result?.seriesLabel ?? null, error]);
    if (error) await db.query(`UPDATE integration_connections SET last_error = $2, checked_at = now() WHERE id = $1`, [l.connection_id, error]);
    else await db.query(`UPDATE integration_connections SET last_error = NULL, checked_at = now() WHERE id = $1`, [l.connection_id]);
    res.json({ ok: !error, error, metrics: result?.metrics ?? null });
  });

  r.get('/analytics/dashboard', requirePerm('analytics.view'), async (req, res) => {
    const { db } = req.ctx;
    const links = await db.query(
      `SELECT l.id, l.kind, l.ref, l.label, l.project_id, l.created_at, p.name AS motion, c.status AS connection_status,
              p.motion_campaign_id AS campaign_id, mc.name AS campaign, p.recipe->>'format' AS channel,
              s.fetched_at, s.ok, s.metrics, s.series, s.series_label, s.error,
              (SELECT fetched_at FROM analytics_snapshots x WHERE x.link_id = l.id AND x.ok ORDER BY fetched_at DESC LIMIT 1) AS last_success
         FROM analytics_links l JOIN motion_projects p ON p.id = l.project_id JOIN integration_connections c ON c.id = l.connection_id
         LEFT JOIN motion_campaigns mc ON mc.id = p.motion_campaign_id AND mc.deleted_at IS NULL
         LEFT JOIN LATERAL (SELECT * FROM analytics_snapshots s WHERE s.link_id = l.id ORDER BY fetched_at DESC LIMIT 1) s ON true
        WHERE l.workspace_id = $1 AND p.deleted_at IS NULL ORDER BY l.created_at DESC`,
      [req.ws!.id],
    );
    // A failed refresh keeps showing the last successful numbers, clearly dated.
    for (const l of links) {
      if (l.ok === false && l.last_success) {
        const prev = await db.one(`SELECT metrics, series, series_label FROM analytics_snapshots WHERE link_id = $1 AND ok ORDER BY fetched_at DESC LIMIT 1`, [l.id]);
        Object.assign(l, { metrics: prev.metrics, series: prev.series, series_label: prev.series_label });
      }
    }
    res.json({ links, connections: await connections(req) });
  });

  r.get('/analytics/utm/:projectId', requirePerm('analytics.view'), async (req, res) => {
    const p = await req.ctx.db.one(`SELECT p.id, p.name, c.name AS campaign FROM motion_projects p LEFT JOIN motion_campaigns c ON c.id = p.motion_campaign_id AND c.deleted_at IS NULL WHERE p.id = $1 AND p.workspace_id = $2 AND p.deleted_at IS NULL`, [req.params.projectId, req.ws!.id]);
    if (!p) throw notFound('Motion');
    // utm_campaign groups every size of a campaign in GA4; utm_content still tells the sizes apart.
    const slug = (p.campaign ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    res.json({ utmContent: utmContent(p.id), utmCampaign: slug || null, name: p.name });
  });

  return r;
}
