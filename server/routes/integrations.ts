import { Router } from 'express';
import { z } from 'zod';
import { requirePerm } from '../auth';
import { HttpError, badRequest, notFound, parse } from '../http';
import { audit } from '../audit';
import { CONNECTORS } from '../integrations/connectors';
import { zip } from '../services/png';
import { uid } from '../../shared/util/random';

export function integrationRoutes() {
  const r = Router();

  r.get('/integrations', requirePerm('integration.view'), async (req, res) => {
    const conns = await req.ctx.db.query(`SELECT id, provider, status, scopes, config, expires_at, created_at FROM integration_connections WHERE workspace_id = $1 AND status <> 'disconnected' ORDER BY created_at DESC`, [req.ws!.id]);
    const pubs = await req.ctx.db.query(
      `SELECT p.id, p.status, p.destination_ref, p.error, p.created_at, c.provider, c.config->>'name' AS destination, j.format, j.source->>'name' AS name
         FROM publication_jobs p JOIN integration_connections c ON c.id = p.connection_id LEFT JOIN export_jobs j ON j.id = p.export_job_id
        WHERE p.workspace_id = $1 ORDER BY p.created_at DESC LIMIT 50`,
      [req.ws!.id],
    );
    res.json({
      connectors: CONNECTORS.map((c) => ({ id: c.id, name: c.name, category: c.category, description: c.description, capabilities: c.capabilities, scopes: c.scopes, ...c.availability(process.env), configurable: !!c.validateConfig })),
      connections: conns.map((c) => ({ ...c, status: c.expires_at && new Date(c.expires_at) < new Date() ? 'expired' : c.status })),
      publications: pubs,
    });
  });

  r.post('/integrations/:provider/connect', requirePerm('integration.manage'), async (req, res) => {
    const c = CONNECTORS.find((x) => x.id === req.params.provider);
    if (!c) throw notFound('Connector');
    const avail = c.availability(process.env);
    if (!avail.available || !c.validateConfig) throw new HttpError(422, 'connector_unavailable', avail.reason ?? `${c.name} does not need a connection`);
    let v;
    try { v = c.validateConfig(req.body?.config, req.ctx.isProd); } catch (e: any) { throw badRequest(e.message); }
    const id = uid('conn');
    const ttl = v.config.tokenTtlSeconds;
    await req.ctx.db.query(`INSERT INTO integration_connections (id, workspace_id, provider, status, scopes, config, secret_enc, expires_at, created_by) VALUES ($1, $2, $3, 'connected', $4, $5, $6, $7, $8)`,
      [id, req.ws!.id, c.id, c.scopes, JSON.stringify(v.config), v.secret ?? null, ttl ? new Date(Date.now() + ttl * 1000).toISOString() : null, req.user!.id]);
    await audit(req.ctx.db, req, 'integration.connect', 'integration', id, { provider: c.id, url: v.config.url });
    res.status(201).json({ id });
  });

  r.delete('/integrations/connections/:id', requirePerm('integration.manage'), async (req, res) => {
    const conn = await req.ctx.db.one(`SELECT * FROM integration_connections WHERE id = $1 AND workspace_id = $2`, [req.params.id, req.ws!.id]);
    if (!conn) throw notFound('Connection');
    await req.ctx.db.query(`UPDATE integration_connections SET status = 'disconnected', secret_enc = NULL WHERE id = $1`, [conn.id]);
    await audit(req.ctx.db, req, 'integration.disconnect', 'integration', conn.id, { provider: conn.provider });
    res.json({ ok: true });
  });

  r.post('/integrations/connections/:id/publish', requirePerm('integration.manage'), async (req, res) => {
    const body = parse(z.object({ exportJobId: z.string() }), req.body);
    const { db, storage } = req.ctx;
    const conn = await db.one(`SELECT * FROM integration_connections WHERE id = $1 AND workspace_id = $2 AND status <> 'disconnected'`, [req.params.id, req.ws!.id]);
    if (!conn) throw notFound('Connection');
    const c = CONNECTORS.find((x) => x.id === conn.provider)!;
    if (conn.expires_at && new Date(conn.expires_at) < new Date()) {
      await db.query(`UPDATE integration_connections SET status = 'expired' WHERE id = $1`, [conn.id]);
      throw new HttpError(401, 'integration_expired', `${c.name} credentials expired. Reconnect the integration, then retry — nothing was published.`);
    }
    const job = await db.one(`SELECT j.*, f.storage_key, f.filename, f.mime, f.bytes FROM export_jobs j JOIN exported_files f ON f.id = j.result_file_id WHERE j.id = $1 AND j.workspace_id = $2 AND j.status = 'completed'`, [body.exportJobId, req.ws!.id]);
    if (!job) throw badRequest('Choose a completed export');
    if (!c.capabilities.formats.includes(job.format)) throw badRequest(`${c.name} does not accept ${job.format.toUpperCase()} files`);
    if (!c.publish) throw new HttpError(422, 'no_direct_publish', `${c.name} does not support direct publication; download the export package instead.`);
    const pubId = uid('pub');
    await db.query(`INSERT INTO publication_jobs (id, workspace_id, connection_id, export_job_id, status, created_by) VALUES ($1, $2, $3, $4, 'pending', $5)`, [pubId, req.ws!.id, conn.id, job.id, req.user!.id]);
    const origin = `${req.protocol}://${req.get('host')}`;
    const result = await c.publish(conn, { filename: job.filename, mime: job.mime, bytes: Number(job.bytes), url: origin + storage.signedUrl(job.storage_key, 86400, job.filename) }, { name: job.source.name, format: job.format, settings: job.settings });
    await db.query(`UPDATE publication_jobs SET status = $2, destination_ref = $3, error = $4 WHERE id = $1`, [pubId, result.status, result.ref ?? null, result.error ?? null]);
    await audit(db, req, `publication.${result.status}`, 'publication', pubId, { provider: c.id, exportJobId: job.id, ...result });
    res.status(result.status === 'confirmed' ? 200 : 502).json({ id: pubId, ...result });
  });

  /** Fallback when direct publication is unavailable: zip of results + manifest. */
  r.post('/integrations/package', requirePerm('export.create'), async (req, res) => {
    const body = parse(z.object({ exportJobIds: z.array(z.string()).min(1).max(50), name: z.string().max(80).default('motion-package') }), req.body);
    const { db, storage } = req.ctx;
    const jobs = await db.query(`SELECT j.id, j.format, j.settings, j.source, j.scene_version_id, f.storage_key, f.filename, f.mime FROM export_jobs j JOIN exported_files f ON f.id = j.result_file_id WHERE j.workspace_id = $1 AND j.id = ANY($2::text[]) AND j.status = 'completed'`, [req.ws!.id, body.exportJobIds]);
    if (!jobs.length) throw badRequest('No completed exports selected');
    const files: { name: string; data: Buffer }[] = [];
    const seen = new Set<string>();
    for (const j of jobs) {
      let name = j.filename;
      for (let i = 2; seen.has(name); i++) name = j.filename.replace(/(\.\w+)$/, `-${i}$1`);
      seen.add(name);
      files.push({ name, data: await storage.get(j.storage_key) });
    }
    const manifest = { generatedAt: new Date().toISOString(), workspace: req.ws!.id, files: jobs.map((j, i) => ({ file: files[i].name, format: j.format, settings: j.settings, source: { ...j.source, pins: j.source.pins }, sceneVersionId: j.scene_version_id })) };
    files.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${body.name.replace(/[^A-Za-z0-9._-]/g, '_')}.zip"`);
    res.end(zip(files));
  });

  return r;
}

/** Local destination for exercising the webhook connector end-to-end in development. */
export function devReceiver() {
  const r = Router();
  const received: any[] = [];
  r.post('/dev/receiver/:mode', (req, res) => {
    if (req.ctx.isProd) { res.status(404).end(); return; }
    received.unshift({ at: new Date().toISOString(), mode: req.params.mode, body: req.body });
    received.length = Math.min(received.length, 20);
    if (req.params.mode === 'reject') { res.status(422).json({ error: 'Video aspect ratio not accepted by destination' }); return; }
    res.json({ id: `cms_${Date.now().toString(36)}` });
  });
  r.get('/dev/receiver', (req, res) => { if (req.ctx.isProd) { res.status(404).end(); return; } res.json({ received }); });
  return r;
}
