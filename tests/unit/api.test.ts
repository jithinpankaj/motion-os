import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { openDb, type Db } from '../../server/db';
import { localStorage } from '../../server/storage';
import { createApp } from '../../server/app';
import { ensureGlobals } from '../../server/services/workspace';
import { seedDemo, DEMO_PASSWORD } from '../../server/seed';
import { encodePng } from '../../server/services/png';

let db: Db, server: Server, base = '';
const sessions: Record<string, { cookie: string; ws: string }> = {};

async function login(email: string, password = DEMO_PASSWORD) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const s = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json();
  return { cookie, ws: s.workspaces[0]?.id };
}
async function call(who: string, method: string, url: string, body?: unknown, raw?: Buffer) {
  const s = sessions[who];
  const r = await fetch(`${base}/api${url}`, { method, headers: { cookie: s.cookie, 'x-workspace-id': s.ws, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(raw ? { 'content-type': 'application/octet-stream' } : {}) }, body: (raw ? new Uint8Array(raw) : body !== undefined ? JSON.stringify(body) : undefined) as any });
  return { status: r.status, body: await r.json().catch(() => null) };
}

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mos-test-'));
  db = await openDb('memory://');
  const storage = localStorage(path.join(dir, 'objects'), 'test-secret');
  await ensureGlobals(db);
  await seedDemo(db, storage);
  server = createApp({ db, storage, secret: 'test-secret', isProd: false }).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const [k, e] of Object.entries({ owner: 'alex@motion.os', designer: 'dana@motion.os', marketing: 'mia@motion.os', engineer: 'eli@motion.os', viewer: 'vic@motion.os' })) sessions[k] = await login(e);
}, 60_000);
afterAll(async () => { server?.close(); await db?.close(); });

describe('server-enforced permissions', () => {
  it('rejects bad credentials and unauthenticated access', async () => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'mia@motion.os', password: 'wrong-password' }) });
    expect(r.status).toBe(401);
    expect((await fetch(`${base}/api/library`)).status).toBe(401);
  });
  it('development sign-in only works for seeded demo accounts', async () => {
    const dev = (body: unknown) => fetch(`${base}/api/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r = await dev({});
    expect(r.status).toBe(200);
    const cookie = r.headers.get('set-cookie')!.split(';')[0];
    expect((await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()).user.email).toBe('alex@motion.os');
    expect((await dev({ email: 'mia@motion.os' })).status).toBe(200);
    expect((await dev({ email: 'outsider@example.com' })).status).toBe(400);
  });
  it('marketing can browse the library but not projects or scene edits', async () => {
    expect((await call('marketing', 'GET', '/library')).body.templates.length).toBe(6);
    expect((await call('marketing', 'GET', '/projects')).status).toBe(403);
    const projects = (await call('designer', 'GET', '/projects')).body.projects;
    expect((await call('marketing', 'PUT', `/projects/${projects[0].id}/scene`, { doc: projects[0].doc, baseRevision: 1 })).status).toBe(403);
  });
  it('enforces workspace isolation', async () => {
    const r = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'outsider@example.com', name: 'Out Sider', password: 'outsider-pass-123' }) });
    expect(r.status).toBe(201);
    sessions.outsider = await login('outsider@example.com', 'outsider-pass-123');
    const s = sessions.outsider;
    const res = await fetch(`${base}/api/library`, { headers: { cookie: s.cookie, 'x-workspace-id': sessions.marketing.ws } });
    expect(res.status).toBe(403);
    expect((await call('outsider', 'GET', '/library')).body.templates).toEqual([]);
  });
  it('viewers cannot export', async () => {
    const lib = (await call('viewer', 'GET', '/library')).body.templates;
    const r = await call('viewer', 'POST', '/exports', { source: { kind: 'template', templateId: lib[0].id, versionId: lib[0].version_id, values: {} }, format: 'png', settings: { width: 100, height: 100, time: 0 } });
    expect(r.status).toBe(403);
  });
});

describe('governed exports', () => {
  it('re-validates parameter values on the server and refuses locked changes', async () => {
    const aurora = (await call('marketing', 'GET', '/library')).body.templates.find((t: any) => t.name === 'Aurora Flow');
    const src = (values: object) => ({ source: { kind: 'template', templateId: aurora.id, versionId: aurora.version_id, values }, format: 'mp4', settings: { width: 1080, height: 1350, fps: 30, duration: 2, quality: 'draft' } });
    const locked = await call('marketing', 'POST', '/exports', src({ headlineColor: '#ff0000' }));
    expect(locked.status).toBe(400);
    expect(JSON.stringify(locked.body)).toMatch(/locked|Brand rule/);
    const ok = await call('marketing', 'POST', '/exports', { ...src({ headline: 'Spring' }), channel: 'instagram-story', settings: { width: 1080, height: 1920, fps: 30, duration: 2, quality: 'draft' } });
    expect(ok.status).toBe(201);
    const scene = (await call('marketing', 'GET', `/exports/${ok.body.job.id}/scene`)).body.scene;
    expect(scene.canvas.height).toBe(1920);
    expect(scene.layers.find((l: any) => l.id === 'ly_aurora_head').props.text).toBe('Spring');
  });
  it('refuses unimplemented formats and odd MP4 sizes', async () => {
    const t = (await call('marketing', 'GET', '/library')).body.templates[0];
    const s = { kind: 'template', templateId: t.id, versionId: t.version_id, values: {} };
    expect((await call('marketing', 'POST', '/exports', { source: s, format: 'lottie', settings: {} })).status).toBe(422);
    expect((await call('marketing', 'POST', '/exports', { source: s, format: 'mp4', settings: { width: 1081, height: 1080, fps: 30, duration: 1 } })).status).toBe(400);
  });
  it('produces native scene JSON on the server', async () => {
    const t = (await call('engineer', 'GET', '/library')).body.templates[0];
    const r = await call('engineer', 'POST', '/exports', { source: { kind: 'template', templateId: t.id, versionId: t.version_id, values: {} }, format: 'scene-json', settings: {} });
    expect(r.body.job.status).toBe('completed');
    const file = await fetch(base + r.body.job.result.url);
    expect((await file.json()).schemaVersion).toBe(2);
  });
  it('rejects uploaded results that do not match the job', async () => {
    const t = (await call('marketing', 'GET', '/library')).body.templates[0];
    const j = (await call('marketing', 'POST', '/exports', { source: { kind: 'template', templateId: t.id, versionId: t.version_id, values: {} }, format: 'png', settings: { width: 64, height: 64, time: 1 } })).body.job;
    await call('marketing', 'PATCH', `/exports/${j.id}`, { status: 'processing' });
    expect((await call('marketing', 'PUT', `/exports/${j.id}/result`, undefined, Buffer.from('not a png at all'))).status).toBe(400);
    const png = encodePng(64, 64, () => [10, 20, 30]);
    const done = await call('marketing', 'PUT', `/exports/${j.id}/result`, undefined, png);
    expect(done.body.job.status).toBe('completed');
  });
});

describe('template lifecycle', () => {
  it('submit → no self-approval → approve → publish creates an immutable new version', async () => {
    const p = (await call('designer', 'GET', '/projects')).body.projects.find((x: any) => x.name === 'Aurora Flow');
    const sub = await call('designer', 'POST', `/projects/${p.id}/submit`, { name: 'Aurora Flow', changelog: 'v2 tweaks' });
    expect(sub.status).toBe(201);
    expect(sub.body.version).toBe(2);
    expect((await call('designer', 'POST', `/approvals/${sub.body.approvalRequestId}/decide`, { decision: 'approved' })).status).toBe(403);
    expect((await call('owner', 'POST', `/approvals/${sub.body.approvalRequestId}/decide`, { decision: 'approved' })).status).toBe(200);
    expect((await call('designer', 'POST', `/templates/${sub.body.templateId}/publish`, { versionId: sub.body.versionId })).status).toBe(200);
    const lib = (await call('marketing', 'GET', '/library')).body.templates.find((t: any) => t.id === sub.body.templateId);
    expect(lib.version).toBe(2);
    const audit = (await call('owner', 'GET', '/audit')).body.events.map((e: any) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['template.submit', 'approval.decision', 'asset.publish']));
  });
  it('detects concurrent edits instead of silently overwriting', async () => {
    const p = (await call('designer', 'GET', '/projects')).body.projects[0];
    const full = (await call('designer', 'GET', `/projects/${p.id}`)).body;
    const first = await call('designer', 'PUT', `/projects/${p.id}/scene`, { doc: full.scene.doc, baseRevision: full.scene.revision });
    expect(first.status).toBe(200);
    const second = await call('owner', 'PUT', `/projects/${p.id}/scene`, { doc: full.scene.doc, baseRevision: full.scene.revision });
    expect(second.status).toBe(409);
    expect(second.body.error.details.revision).toBe(first.body.revision);
  });
  it('rejects invalid scene documents', async () => {
    const r = await call('designer', 'POST', '/projects', { name: 'Bad', scene: { schemaVersion: 2, layers: 'nope' } });
    expect(r.status).toBe(400);
  });
});

describe('campaign inheritance on the server', () => {
  it('master changes flow to variations except local overrides', async () => {
    const t = (await call('marketing', 'GET', '/library')).body.templates.find((x: any) => x.name === 'Kinetic Typography');
    const c = await call('marketing', 'POST', '/campaigns', { name: 'Launch', templateId: t.id, channels: ['instagram-feed', 'linkedin-feed', 'website-hero'] });
    expect(c.status).toBe(201);
    let d = (await call('marketing', 'GET', `/campaigns/${c.body.id}`)).body;
    const li = d.variations.find((v: any) => v.channel === 'linkedin-feed');
    expect((await call('marketing', 'PUT', `/campaigns/${c.body.id}/variations/${li.id}/overrides/headline`, { value: 'HIRE' })).status).toBe(200);
    expect((await call('marketing', 'PUT', `/campaigns/${c.body.id}/master`, { values: { headline: 'LAUNCH', accent: '#d4ff3a' } })).status).toBe(200);
    d = (await call('marketing', 'GET', `/campaigns/${c.body.id}`)).body;
    const by = (ch: string) => d.variations.find((v: any) => v.channel === ch);
    expect(by('linkedin-feed').values.headline).toBe('HIRE');
    expect(by('linkedin-feed').sources.headline).toBe('override');
    expect(by('instagram-feed').values.headline).toBe('LAUNCH');
    expect(by('linkedin-feed').values.accent).toBe('#d4ff3a');
    expect((await call('marketing', 'PUT', `/campaigns/${c.body.id}/master`, { values: { accent: '#123456' } })).status).toBe(400);
  });
});

describe('upload validation', () => {
  it('sniffs content and rejects active SVG', async () => {
    expect((await call('designer', 'POST', '/assets?name=fake&kind=image', undefined, Buffer.from('GIF? no, plain text pretending'))).status).toBe(400);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>');
    const bad = await call('designer', 'POST', '/assets?name=evil&kind=svg', undefined, svg);
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/script/);
    const ok = await call('designer', 'POST', '/assets?name=tile&kind=image', undefined, encodePng(32, 16, () => [1, 2, 3]));
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ width: 32, height: 16, mime: 'image/png' });
  });
  it('signed URLs expire and cannot be forged', async () => {
    const a = (await call('designer', 'GET', '/assets')).body.assets[0];
    expect((await fetch(base + a.url)).status).toBe(200);
    expect((await fetch(base + a.url.replace(/sig=[^&]+/, 'sig=forged'))).status).toBe(403);
  });
});

describe('file delivery', () => {
  it('supports byte ranges for seeking', async () => {
    const a = (await call('designer', 'GET', '/assets')).body.assets[0];
    const r = await fetch(base + a.url, { headers: { range: 'bytes=0-9' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toMatch(/^bytes 0-9\/\d+$/);
    expect((await r.arrayBuffer()).byteLength).toBe(10);
  });
});
