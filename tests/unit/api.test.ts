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
import { ensurePresetPosts } from '../../server/routes/community';
import { assistantConfigured, setAssistantAskerForTests } from '../../server/routes/assistant';
import { MOTION_PRESETS } from '../../shared/motion/presets';

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
  it('engineers can open and export files but not edit them', async () => {
    const projects = (await call('engineer', 'GET', '/projects')).body.projects;
    expect(projects.length).toBeGreaterThan(0);
    expect((await call('engineer', 'PUT', `/projects/${projects[0].id}/scene`, { doc: projects[0].doc, baseRevision: 1 })).status).toBe(403);
    expect((await call('engineer', 'POST', '/projects', { name: 'Nope' })).status).toBe(403);
    expect((await call('marketing', 'POST', '/projects', { name: 'Yes', width: 800, height: 600 })).status).toBe(201);
  });
  it('enforces workspace isolation', async () => {
    const r = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'outsider@example.com', name: 'Out Sider', password: 'outsider-pass-123' }) });
    expect(r.status).toBe(201);
    sessions.outsider = await login('outsider@example.com', 'outsider-pass-123');
    const s = sessions.outsider;
    const res = await fetch(`${base}/api/projects`, { headers: { cookie: s.cookie, 'x-workspace-id': sessions.marketing.ws } });
    expect(res.status).toBe(403);
    expect((await call('outsider', 'GET', '/projects')).body.projects).toEqual([]);
  });
  it('viewers cannot export', async () => {
    const p = (await call('viewer', 'GET', '/projects')).body.projects[0];
    expect((await call('viewer', 'POST', '/exports', { source: { kind: 'project', id: p.id }, format: 'png', settings: { width: 100, height: 100, time: 0 } })).status).toBe(403);
  });
});

const fileNamed = async (name: string) => (await call('designer', 'GET', '/projects')).body.projects.find((x: any) => x.name === name);

describe('exports', () => {
  it('exports one move of an interactive file as a timeline', async () => {
    const p = await fileNamed('Living button');
    const anim = p.doc.machine.animations[0];
    const ok = await call('marketing', 'POST', '/exports', { source: { kind: 'project', id: p.id, animationId: anim.id }, format: 'mp4', settings: { width: 1080, height: 1080, fps: 30, duration: 1, quality: 'draft' } });
    expect(ok.status).toBe(201);
    const scene = (await call('marketing', 'GET', `/exports/${ok.body.job.id}/scene`)).body.scene;
    expect(scene.canvas.duration).toBe(anim.duration);
    expect(scene.tracks.length).toBe(anim.tracks.length);
    expect((await call('marketing', 'POST', '/exports', { source: { kind: 'project', id: p.id, animationId: 'an_missing' }, format: 'png', settings: { width: 64, height: 64, time: 0 } })).status).toBe(404);
  });
  it('refuses unimplemented formats and odd MP4 sizes', async () => {
    const s = { kind: 'project', id: (await fileNamed('Living button')).id };
    expect((await call('marketing', 'POST', '/exports', { source: s, format: 'lottie', settings: {} })).status).toBe(422);
    expect((await call('marketing', 'POST', '/exports', { source: s, format: 'mp4', settings: { width: 1081, height: 1080, fps: 30, duration: 1 } })).status).toBe(400);
  });
  it('produces the full motion file (with its interactions) on the server', async () => {
    const p = await fileNamed('Living button');
    const r = await call('engineer', 'POST', '/exports', { source: { kind: 'project', id: p.id }, format: 'scene-json', settings: {} });
    expect(r.body.job.status).toBe('completed');
    const file = await (await fetch(base + r.body.job.result.url)).json();
    expect(file.schemaVersion).toBe(3);
    expect(file.machine.rules.length).toBeGreaterThan(0);
  });
  it('rejects uploaded results that do not match the job', async () => {
    const p = await fileNamed('Living button');
    const j = (await call('marketing', 'POST', '/exports', { source: { kind: 'project', id: p.id }, format: 'png', settings: { width: 64, height: 64, time: 1 } })).body.job;
    await call('marketing', 'PATCH', `/exports/${j.id}`, { status: 'processing' });
    expect((await call('marketing', 'PUT', `/exports/${j.id}/result`, undefined, Buffer.from('not a png at all'))).status).toBe(400);
    const png = encodePng(64, 64, () => [10, 20, 30]);
    const done = await call('marketing', 'PUT', `/exports/${j.id}/result`, undefined, png);
    expect(done.body.job.status).toBe('completed');
  });
});

describe('files', () => {
  it('creates files from scratch or a preset', async () => {
    const blank = await call('designer', 'POST', '/projects', { name: 'Blank story', width: 1080, height: 1920, background: '#112233' });
    const b = (await call('designer', 'GET', `/projects/${blank.body.id}`)).body;
    expect(b.scene.doc.canvas).toMatchObject({ width: 1080, height: 1920, background: '#112233' });
    const preset = await call('designer', 'POST', '/projects', { name: 'Button', preset: 'living-button' });
    const d = (await call('designer', 'GET', `/projects/${preset.body.id}`)).body.scene.doc;
    expect(d.machine.animations.map((a: any) => a.name)).toEqual(['Idle', 'Hover', 'Unhover', 'Press', 'Release']);
    expect(d.exposed.length).toBeGreaterThan(0);
    expect((await call('designer', 'POST', '/projects', { name: 'X', preset: 'nope' })).status).toBe(400);
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
    expect((await call('designer', 'POST', '/projects', { name: 'Bad', scene: { schemaVersion: 2, layers: 'nope' } })).status).toBe(400);
  });
});

describe('community', () => {
  const noWs = async (who: string, method: string, url: string) => {
    const r = await fetch(`${base}/api${url}`, { method, headers: { cookie: sessions[who].cookie } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  it('lists the presets for every signed-in user, in order, and requires sign-in', async () => {
    expect((await fetch(`${base}/api/community`)).status).toBe(401);
    // A preset that has left the library disappears from the gallery on the next start.
    await db.query(`INSERT INTO community_posts (id, author_name, title, description, tags, doc, is_preset, preset_key) VALUES ('cp_retired', 'Motion OS', 'Retired', '', '{}', '{}', true, 'retired')`);
    await ensurePresetPosts(db);
    const r = await noWs('outsider', 'GET', '/community?sort=presets');
    expect(r.status).toBe(200);
    expect(r.body.posts.map((p: any) => p.title)).toEqual(MOTION_PRESETS.map((p) => p.name)); // retired presets are gone
    expect(r.body.posts.every((p: any) => p.isPreset)).toBe(true);
  });
  it('publishes with images copied, lets another workspace remix, and keeps posts independent', async () => {
    const p = await fileNamed('Orb launch card');
    const pub = await call('designer', 'POST', '/community', { projectId: p.id, title: 'Orb card', description: 'Hover the orb', tags: ['card'] });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200); // the seed already shared this file, so this updates that post
    expect(pub.body.updated).toBe(true);
    const post = (await noWs('outsider', 'GET', `/community/${pub.body.id}`)).body;
    expect(post.post.title).toBe('Orb card');
    const imgId = post.post.doc.layers.find((l: any) => l.type === 'image').props.assetId;
    expect(imgId).toMatch(/^ca_/); // a community copy, not the workspace asset
    expect((await fetch(base + post.assets[imgId].url)).status).toBe(200);
    expect((await call('viewer', 'POST', '/community', { projectId: p.id, title: 'No' })).status).toBe(403);
    // Another workspace remixes it; the image is copied into their workspace.
    const remix = await call('outsider', 'POST', `/community/${pub.body.id}/remix`);
    expect(remix.status, JSON.stringify(remix.body)).toBe(201);
    const mine = (await call('outsider', 'GET', `/projects/${remix.body.id}`)).body;
    expect(mine.project.remixOf).toBe(pub.body.id);
    const newImg = mine.scene.doc.layers.find((l: any) => l.type === 'image').props.assetId;
    expect((await call('outsider', 'GET', `/assets/${newImg}`)).status).toBe(200);
    expect((await call('designer', 'GET', `/assets/${newImg}`)).status).toBe(404);
    // Likes toggle; only the author can unpublish; remixes survive unpublishing.
    expect((await noWs('outsider', 'POST', `/community/${pub.body.id}/like`)).body).toMatchObject({ liked: true, likeCount: 1 });
    expect((await noWs('outsider', 'POST', `/community/${pub.body.id}/like`)).body).toMatchObject({ liked: false, likeCount: 0 });
    expect((await call('outsider', 'DELETE', `/community/${pub.body.id}`)).status).toBe(403);
    expect((await call('designer', 'DELETE', `/community/${pub.body.id}`)).status).toBe(200);
    expect((await noWs('outsider', 'GET', `/community/${pub.body.id}`)).status).toBe(404);
    expect((await call('outsider', 'GET', `/projects/${remix.body.id}`)).status).toBe(200);
  });
  it('uploads a sound, publishes it with the file under a category, and remixes copy it along', async () => {
    // A tiny valid WAV file (44-byte header + silence).
    const wav = Buffer.alloc(44 + 800);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + 800, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(800, 40);
    expect((await call('designer', 'POST', '/assets?name=Not%20audio&kind=audio', undefined, Buffer.from('hello'))).status).toBe(400);
    const up = await call('designer', 'POST', '/assets?name=Ding&kind=audio&category=sound', undefined, wav);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.mime).toBe('audio/wav');
    const created = await call('designer', 'POST', '/projects', { name: 'Sound test', preset: 'living-button' });
    const full = (await call('designer', 'GET', `/projects/${created.body.id}`)).body;
    const doc = full.scene.doc;
    doc.machine.rules[0].do.push({ type: 'sound', sound: null, assetId: up.body.id, volume: 0.5 });
    expect((await call('designer', 'PUT', `/projects/${created.body.id}/scene`, { doc, baseRevision: full.scene.revision })).status).toBe(200);
    const pub = await call('designer', 'POST', '/community', { projectId: created.body.id, title: 'Ding button', category: 'Interactive UI', tags: ['sound'] });
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    const post = (await noWs('outsider', 'GET', `/community/${pub.body.id}`)).body;
    expect(post.post.tags).toEqual(['interactive-ui', 'sound']);
    expect(post.post.doc.meta.category).toBe('Interactive UI');
    const sid = post.post.doc.machine.rules[0].do.find((a: any) => a.type === 'sound').assetId;
    expect(sid).toMatch(/^ca_/); // the community copy
    const audio = await fetch(base + post.assets[sid].url);
    expect(audio.headers.get('content-type')).toBe('audio/wav');
    expect((await noWs('outsider', 'GET', '/community?tag=interactive-ui')).body.posts.some((p: any) => p.id === pub.body.id)).toBe(true);
    const remix = await call('outsider', 'POST', `/community/${pub.body.id}/remix`);
    const mine = (await call('outsider', 'GET', `/projects/${remix.body.id}`)).body.scene.doc;
    const rid = mine.machine.rules[0].do.find((a: any) => a.type === 'sound').assetId;
    expect((await call('outsider', 'GET', `/assets/${rid}`)).body.asset.kind).toBe('audio');
  });
  it('republishing updates the same post, and presets cannot be unpublished', async () => {
    const p = await fileNamed('Living button');
    const a = await call('designer', 'POST', '/community', { projectId: p.id, title: 'Switch' });
    const b = await call('designer', 'POST', '/community', { projectId: p.id, title: 'Switch v2' });
    expect(b.body).toMatchObject({ id: a.body.id, updated: true });
    const preset = (await noWs('owner', 'GET', '/community?sort=presets')).body.posts[0];
    expect((await call('owner', 'DELETE', `/community/${preset.id}`)).status).toBe(403);
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

describe('Ask Claude', () => {
  it('sends Claude the current file and the request, returns its operations, and needs edit permission', async () => {
    const p = (await call('designer', 'GET', '/projects')).body.projects[0];
    const doc = (await call('designer', 'GET', `/projects/${p.id}`)).body.scene.doc;
    const seen: { system: string; messages: any[] }[] = [];
    setAssistantAskerForTests(async (system, messages) => {
      seen.push({ system, messages });
      return { refused: false, reply: { reply: 'Added a bounce on click.', operations: [{ kind: 'add_state', name: 'Hover', interaction: null, when: null, on: null, amount: null, only_if: null, steps: null, switch_to_state: null, layer: null, move: null, property: null, value: null, variable_type: null, options: null }] } };
    });
    try {
      const r = await call('designer', 'POST', '/assistant', { doc, messages: [{ role: 'user', text: 'Make it bounce when clicked' }] });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.reply).toBe('Added a bounce on click.');
      expect(r.body.operations).toHaveLength(1);
      expect(seen[0].system).toContain('animation helper inside Motion OS');
      expect(seen[0].messages.at(-1).content).toContain('The file right now:');
      expect(seen[0].messages.at(-1).content).toContain('What I’d like: Make it bounce when clicked');
      expect((await call('viewer', 'POST', '/assistant', { doc, messages: [{ role: 'user', text: 'hi' }] })).status).toBe(403);
      expect((await call('designer', 'POST', '/assistant', { doc, messages: [{ role: 'assistant', text: 'hi' }] })).status).toBe(400);
      setAssistantAskerForTests(async () => ({ refused: true, reply: null }));
      expect((await call('designer', 'POST', '/assistant', { doc, messages: [{ role: 'user', text: 'x' }] })).body.operations).toEqual([]);
    } finally { setAssistantAskerForTests(null); }
    // Without a Claude credential the server says so plainly instead of pretending.
    const status = (await call('designer', 'GET', '/assistant/status')).body;
    expect(status.configured).toBe(assistantConfigured());
    if (!assistantConfigured()) {
      const r = await call('designer', 'POST', '/assistant', { doc, messages: [{ role: 'user', text: 'hi' }] });
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('assistant_not_configured');
    }
  });
});
