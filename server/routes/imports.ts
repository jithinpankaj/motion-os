import { Router } from 'express';
import { z } from 'zod';
import { requirePerm } from '../auth';
import { HttpError, badRequest, parse, rateLimit } from '../http';
import { audit } from '../audit';
import { importFromWebsite } from '../services/webImport';
import { safeFetch } from '../services/safeFetch';
import { importFigmaFrame, verifyFigmaToken } from '../services/figma';
import { mask, seal, unseal } from '../services/secrets';
import { storeAssetVersion } from './assets';
import { sniff } from '../services/sniff';
import { uid } from '../../shared/util/random';
import type { Request } from 'express';

const importLimit = rateLimit({ name: 'import', windowMs: 60_000, max: 12, key: (r) => r.user?.id ?? r.ip ?? 'x' });

/** Store bytes as a new workspace asset (validated by the same sniffing as uploads). */
export async function createAsset(req: Request, body: Buffer, o: { name: string; kind: 'image' | 'logo' | 'svg'; category: string; tags: string[] }) {
  const { db } = req.ctx;
  const id = uid('ast');
  const v = await db.tx(async (tx) => {
    await tx.query(`INSERT INTO media_assets (id, workspace_id, kind, name, category, tags, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, req.ws!.id, o.kind, o.name.slice(0, 160), o.category, o.tags, req.user!.id]);
    const v = await storeAssetVersion(tx, req, id, body, o.kind);
    await tx.query(`UPDATE media_assets SET current_version_id = $2 WHERE id = $1`, [id, v.versionId]);
    return v;
  });
  return { id, width: v.sniffed.width, height: v.sniffed.height, mime: v.sniffed.mime };
}

export function importRoutes() {
  const r = Router();

  // ----- brand import -----
  r.post('/brand-import/website', requirePerm('brand.edit'), importLimit, async (req, res) => {
    const body = parse(z.object({ url: z.string().trim().min(3).max(500) }), req.body);
    const findings = await importFromWebsite(body.url);
    await audit(req.ctx.db, req, 'brand.import.website', 'brand', req.ws!.id, { url: body.url, colors: findings.colors.length, fonts: findings.fonts.length });
    res.json({ findings });
  });

  /** Pull a remote logo/image (from a website import) into the asset library. */
  r.post('/brand-import/remote-asset', requirePerm('asset.upload'), importLimit, async (req, res) => {
    const body = parse(z.object({ url: z.string().url().max(1000), name: z.string().trim().min(1).max(160), kind: z.enum(['logo', 'image']).default('logo') }), req.body);
    const f = await safeFetch(body.url, { accept: 'image/*', maxBytes: 8e6 });
    if (!f.ok) throw new HttpError(502, 'fetch_failed', `The image answered with HTTP ${f.status}`);
    const s = sniff(f.body);
    if (!s || (s.family !== 'image' && s.family !== 'svg')) throw badRequest('That link is not a PNG, JPEG, WebP, GIF or SVG image');
    const out = await createAsset(req, f.body, { name: body.name, kind: s.family === 'svg' ? (body.kind === 'logo' ? 'logo' : 'svg') : body.kind, category: body.kind === 'logo' ? 'logo' : 'brand', tags: ['brand-import'] });
    res.status(201).json(out);
  });

  // ----- Figma -----
  r.get('/connections/figma', requirePerm('asset.view'), async (req, res) => {
    const c = await req.ctx.db.one(`SELECT id, status, config, checked_at, last_error FROM integration_connections WHERE workspace_id = $1 AND provider = 'figma' AND status <> 'disconnected' ORDER BY created_at DESC LIMIT 1`, [req.ws!.id]);
    res.json({ connection: c ? { id: c.id, status: c.status, account: c.config.account, tokenHint: c.config.tokenHint, checkedAt: c.checked_at, error: c.last_error } : null });
  });

  r.put('/connections/figma', requirePerm('integration.manage'), importLimit, async (req, res) => {
    const body = parse(z.object({ token: z.string().trim().min(20).max(300) }), req.body);
    const me = await verifyFigmaToken(body.token); // throws with Figma's reason when the token is wrong
    const { db } = req.ctx;
    await db.query(`UPDATE integration_connections SET status = 'disconnected' WHERE workspace_id = $1 AND provider = 'figma'`, [req.ws!.id]);
    const id = uid('conn');
    await db.query(`INSERT INTO integration_connections (id, workspace_id, provider, status, scopes, config, secret_enc, created_by, checked_at) VALUES ($1, $2, 'figma', 'connected', $3, $4, $5, $6, now())`,
      [id, req.ws!.id, ['file_content:read'], JSON.stringify({ account: me.handle, tokenHint: mask(body.token) }), seal(req.ctx.secret, { token: body.token }), req.user!.id]);
    await audit(db, req, 'integration.connect', 'integration', id, { provider: 'figma' });
    res.status(201).json({ id, account: me.handle });
  });

  r.delete('/connections/figma', requirePerm('integration.manage'), async (req, res) => {
    await req.ctx.db.query(`UPDATE integration_connections SET status = 'disconnected', secret_enc = NULL WHERE workspace_id = $1 AND provider = 'figma'`, [req.ws!.id]);
    res.json({ ok: true });
  });

  r.post('/design-import/figma', requirePerm('asset.upload'), importLimit, async (req, res) => {
    const body = parse(z.object({ link: z.string().trim().min(10).max(1000) }), req.body);
    const c = await req.ctx.db.one(`SELECT id, secret_enc FROM integration_connections WHERE workspace_id = $1 AND provider = 'figma' AND status = 'connected' ORDER BY created_at DESC LIMIT 1`, [req.ws!.id]);
    if (!c?.secret_enc) throw new HttpError(422, 'figma_not_connected', 'Connect Figma first: add a personal access token in Settings → Connections.');
    const { token } = unseal<{ token: string }>(req.ctx.secret, c.secret_enc);
    let frame;
    try { frame = await importFigmaFrame(body.link, token); }
    catch (e) {
      if (e instanceof HttpError && e.code === 'figma_auth') await req.ctx.db.query(`UPDATE integration_connections SET status = 'error', last_error = $2, checked_at = now() WHERE id = $1`, [c.id, e.message]);
      throw e;
    }
    const layers = [];
    for (const l of frame.layers) {
      const a = await createAsset(req, l.png, { name: `${frame.name} · ${l.name}`, kind: 'image', category: 'design', tags: ['design-import', 'figma'] });
      layers.push({ assetId: a.id, name: l.name, box: l.box });
    }
    await audit(req.ctx.db, req, 'design.import.figma', 'asset', layers[0]?.assetId ?? '', { layers: layers.length });
    res.status(201).json({ name: frame.name, width: frame.width, height: frame.height, background: frame.background, layers, notes: frame.notes });
  });

  return r;
}

