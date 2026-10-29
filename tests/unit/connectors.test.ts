import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import type { Server } from 'node:http';
import { openDb, type Db } from '../../server/db';
import { localStorage } from '../../server/storage';
import { createApp } from '../../server/app';
import { ensureGlobals } from '../../server/services/workspace';
import { seedDemo, DEMO_PASSWORD } from '../../server/seed';
import { setFetchImpl } from '../../server/services/safeFetch';

/**
 * Brand import and analytics connectors against a fake network: verifies request shapes
 * (signed GA4 service-account JWT, Graph/LinkedIn headers), that credentials are validated
 * before a connection is saved, never returned, and that failed refreshes keep the last
 * good numbers instead of inventing new ones.
 */
let db: Db, server: Server, base = '';
const who: Record<string, { cookie: string; ws: string }> = {};
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
let gaFails = false;
const seen: { url: string; headers: Record<string, string>; body?: string }[] = [];

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
async function fakeNet(url: string, init?: RequestInit): Promise<Response> {
  const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  seen.push({ url, headers, body: init?.body as string | undefined });
  const u = new URL(url);
  if (u.hostname === 'brand.example' && u.pathname === '/') {
    return new Response(`<!doctype html><html><head><title>Northwind — calm, trusted banking</title><meta name="theme-color" content="#0B1F3A"><meta name="description" content="Simple, secure banking you can trust.">
      <link rel="stylesheet" href="/site.css"><link rel="apple-touch-icon" href="/touch.png"></head>
      <body><header><a class="logo" href="/"><svg viewBox="0 0 10 10"><rect width="10" height="10" fill="currentColor"/></svg></a></header><h1 style="color:#FF5A36">Hello</h1></body></html>`, { headers: { 'content-type': 'text/html' } });
  }
  if (u.hostname === 'brand.example' && u.pathname === '/site.css') return new Response(':root{--brand-primary:#16A3A0;--accent:#FF5A36}body{background:#F5F1EA;font-family:"Northwind Sans",Helvetica,sans-serif}', { headers: { 'content-type': 'text/css' } });
  if (u.hostname === 'oauth2.googleapis.com') {
    const assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
    const [h, p, sig] = assertion.split('.');
    const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, 'base64url'));
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    return ok && claims.scope.includes('analytics.readonly') ? json({ access_token: 'ya29.fake', expires_in: 3600 }) : json({ error: 'invalid_grant', error_description: 'bad signature' }, 400);
  }
  if (u.hostname === 'analyticsdata.googleapis.com') {
    if (headers.authorization !== 'Bearer ya29.fake') return json({ error: { message: 'unauthenticated' } }, 401);
    if (gaFails) return json({ error: { message: 'Quota exceeded' } }, 429);
    const body = JSON.parse(String(init?.body));
    if (!body.dimensionFilter) return json({ rows: [] });
    return json({ rows: [
      { dimensionValues: [{ value: '20261027' }], metricValues: [{ value: '10' }, { value: '8' }, { value: '6' }, { value: '1' }] },
      { dimensionValues: [{ value: '20261028' }], metricValues: [{ value: '30' }, { value: '25' }, { value: '20' }, { value: '2' }] },
    ] });
  }
  if (u.hostname === 'graph.facebook.com') {
    if (headers.authorization !== 'Bearer EAAGgoodtoken000000000000000000') return json({ error: { message: 'Invalid OAuth access token' } }, 400);
    if (u.pathname.endsWith('/me')) return json({ id: '1', name: 'Northwind' });
    if (u.pathname.endsWith('/insights')) return json({ data: [{ name: 'reach', values: [{ value: 1200 }] }, { name: 'views', values: [{ value: 3400 }] }, { name: 'likes', values: [{ value: 90 }] }, { name: 'total_interactions', values: [{ value: 130 }] }] });
  }
  if (u.hostname === 'api.linkedin.com') {
    if (headers['linkedin-version'] !== '202608' || headers['x-restli-protocol-version'] !== '2.0.0') return json({ message: 'bad headers' }, 400);
    if (u.pathname.endsWith('/organizations/555')) return json({ localizedName: 'Northwind' });
    if (u.pathname.endsWith('/organizationalEntityShareStatistics') && url.includes('shares=List(urn%3Ali%3Ashare%3A777)')) return json({ elements: [{ totalShareStatistics: { impressionCount: 5000, uniqueImpressionsCount: 4100, clickCount: 60, likeCount: 40, commentCount: 5, shareCount: 3 } }] });
  }
  return new Response('not found', { status: 404 });
}

async function login(email: string) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) });
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const s = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json();
  return { cookie, ws: s.workspaces[0].id };
}
async function call(as: string, method: string, url: string, body?: unknown) {
  const s = who[as];
  const r = await fetch(`${base}/api${url}`, { method, headers: { cookie: s.cookie, 'x-workspace-id': s.ws, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

beforeAll(async () => {
  db = await openDb('memory://');
  const storage = localStorage(path.join(mkdtempSync(path.join(tmpdir(), 'mos-conn-')), 'objects'), 'test-secret');
  await ensureGlobals(db);
  await seedDemo(db, storage);
  server = createApp({ db, storage, secret: 'test-secret', isProd: false }).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const [k, e] of Object.entries({ owner: 'alex@motion.os', marketing: 'mia@motion.os', viewer: 'vic@motion.os' })) who[k] = await login(e);
  setFetchImpl(fakeNet, { skipHostCheck: true });
}, 60_000);
afterAll(async () => { setFetchImpl((u, i) => fetch(u, i)); server?.close(); await db?.close(); });

describe('website brand import', () => {
  it('extracts colours, fonts, inline logo and tone', async () => {
    const r = await call('marketing', 'POST', '/brand-import/website', { url: 'brand.example' });
    expect(r.status).toBe(200);
    const f = r.body.findings;
    const hexes = f.colors.map((c: any) => c.hex);
    expect(hexes.slice(0, 3)).toContain('#0b1f3a');
    expect(hexes).toEqual(expect.arrayContaining(['#16a3a0', '#ff5a36', '#f5f1ea']));
    expect(f.fonts[0]).toBe('Northwind Sans');
    expect(f.logoSvgs).toHaveLength(1);
    expect(f.logoSvgs[0]).toContain('xmlns=');
    expect(f.logoCandidates[0]).toBe('https://brand.example/touch.png');
    expect(f.personality).toBe('calm');
  });
  it('requires brand.edit', async () => {
    expect((await call('viewer', 'POST', '/brand-import/website', { url: 'brand.example' })).status).toBe(403);
  });
});

describe('analytics connectors', () => {
  let projectId = '';
  it('rejects bad credentials without saving a connection', async () => {
    const r = await call('marketing', 'POST', '/analytics/connections/meta', { accessToken: 'EAAGbadtoken0000000000000000000' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Invalid OAuth/);
    expect((await call('marketing', 'GET', '/analytics/connections')).body.connections).toHaveLength(0);
    expect((await call('viewer', 'POST', '/analytics/connections/meta', { accessToken: 'EAAGgoodtoken000000000000000000' })).status).toBe(403);
  });
  it('connects GA4 with a signed service-account JWT and never returns the key', async () => {
    const sa = JSON.stringify({ type: 'service_account', client_email: 'motion@proj.iam.gserviceaccount.com', private_key: pem, token_uri: 'https://oauth2.googleapis.com/token' });
    const r = await call('marketing', 'POST', '/analytics/connections/ga4', { serviceAccountJson: sa, propertyId: '312345678' });
    expect(r.status).toBe(201);
    const list = await call('marketing', 'GET', '/analytics/connections');
    expect(JSON.stringify(list.body)).not.toContain('PRIVATE KEY');
    const row = await db.one(`SELECT secret_enc FROM integration_connections WHERE provider = 'ga4' AND status = 'connected'`);
    expect(row.secret_enc).toMatch(/^v1\./);
    expect(row.secret_enc).not.toContain('PRIVATE');
  });
  it('links a motion to GA4 by utm_content and sums sessions', async () => {
    projectId = (await call('marketing', 'GET', '/projects')).body.projects[0].id;
    const l = await call('marketing', 'POST', '/analytics/links', { projectId, kind: 'ga4' });
    expect(l.status).toBe(201);
    expect(l.body.ref).toMatch(/^motion-/);
    const ref = await call('marketing', 'POST', `/analytics/links/${l.body.id}/refresh`);
    expect(ref.body).toMatchObject({ ok: true, metrics: { sessions: 40, users: 33, engagedSessions: 26, conversions: 3 } });
    const report = JSON.parse(seen.filter((s) => s.url.includes(':runReport')).at(-1)!.body!);
    expect(report.dimensionFilter.filter).toMatchObject({ fieldName: 'sessionManualAdContent', stringFilter: { value: l.body.ref } });
    // A failing refresh is recorded, and the dashboard keeps the last good numbers.
    gaFails = true;
    const bad = await call('marketing', 'POST', `/analytics/links/${l.body.id}/refresh`);
    gaFails = false;
    expect(bad.body.ok).toBe(false);
    expect(bad.body.error).toMatch(/Quota/);
    const dash = (await call('viewer', 'GET', '/analytics/dashboard')).body.links.find((x: any) => x.id === l.body.id);
    expect(dash.ok).toBe(false);
    expect(dash.metrics.sessions).toBe(40);
    expect(dash.series).toHaveLength(2);
    expect(dash.last_success).toBeTruthy();
  });
  it('fetches Instagram insights and LinkedIn share statistics', async () => {
    expect((await call('marketing', 'POST', '/analytics/connections/meta', { accessToken: 'EAAGgoodtoken000000000000000000' })).status).toBe(201);
    expect((await call('marketing', 'POST', '/analytics/links', { projectId, kind: 'instagram', ref: 'not-an-id' })).status).toBe(400);
    const ig = await call('marketing', 'POST', '/analytics/links', { projectId, kind: 'instagram', ref: '17895695668004550' });
    expect((await call('marketing', 'POST', `/analytics/links/${ig.body.id}/refresh`)).body.metrics).toMatchObject({ reach: 1200, views: 3400, likes: 90, engagements: 130 });
    expect((await call('marketing', 'POST', '/analytics/connections/linkedin', { accessToken: 'AQVgoodtoken0000000000000000000', organizationId: '555', version: '202608' })).status).toBe(201);
    const li = await call('marketing', 'POST', '/analytics/links', { projectId, kind: 'linkedin', ref: 'https://www.linkedin.com/embed/feed/update/urn:li:share:777' });
    expect(li.body.ref).toBe('urn:li:share:777');
    expect((await call('marketing', 'POST', `/analytics/links/${li.body.id}/refresh`)).body.metrics).toMatchObject({ impressions: 5000, reach: 4100, clicks: 60, engagements: 108 });
  });
  it('disconnecting stops refreshes with a clear message', async () => {
    const conns = (await call('owner', 'GET', '/analytics/connections')).body.connections;
    const meta = conns.find((c: any) => c.provider === 'meta');
    await call('owner', 'DELETE', `/analytics/connections/${meta.id}`);
    const link = (await call('owner', 'GET', '/analytics/dashboard')).body.links.find((x: any) => x.kind === 'instagram');
    const r = await call('owner', 'POST', `/analytics/links/${link.id}/refresh`);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toMatch(/Reconnect/);
  });
});

describe('create recipes', () => {
  it('saves a recipe with the scene and detects later advanced edits', async () => {
    const recipe = { design: null, style: 'backdrop', personality: 'calm', headline: 'Hi', showLogo: false, keepBackground: null, duration: 8, format: 'instagram-feed' };
    const { buildMotion } = await import('../../shared/motionStyles');
    const { kitFromTokens } = await import('../../shared/brandImport');
    const { DEFAULT_BRAND_TOKENS } = await import('../../shared/brand');
    const doc = buildMotion({ design: null, brand: kitFromTokens(DEFAULT_BRAND_TOKENS), style: 'backdrop', headline: 'Hi', width: 1080, height: 1350 });
    const c = await call('marketing', 'POST', '/projects', { name: 'Recipe test', scene: doc, recipe });
    expect(c.status).toBe(201);
    let p = (await call('marketing', 'GET', `/projects/${c.body.id}`)).body;
    expect(p.project.recipe.style).toBe('backdrop');
    expect(p.project.recipeRevision).toBe(p.scene.revision);
    const up = await call('marketing', 'PUT', `/projects/${c.body.id}/recipe`, { recipe: { ...recipe, headline: 'Hello' }, doc, baseRevision: p.scene.revision });
    expect(up.status).toBe(200);
    // An advanced-editor save bumps the scene revision past the recipe's.
    await call('marketing', 'PUT', `/projects/${c.body.id}/scene`, { doc, baseRevision: up.body.revision });
    p = (await call('marketing', 'GET', `/projects/${c.body.id}`)).body;
    expect(p.scene.revision).toBeGreaterThan(p.project.recipeRevision);
    expect((await call('marketing', 'PUT', `/projects/${c.body.id}/recipe`, { recipe, doc, baseRevision: 1 })).status).toBe(409);
  });
});
