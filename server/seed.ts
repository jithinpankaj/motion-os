import type { Db } from './db';
import type { Storage } from './storage';
import { createHash } from 'node:crypto';
import { hashPassword } from './auth';
import { addMember, provisionWorkspace } from './services/workspace';
import { ensurePresetPosts } from './routes/community';
import { createProject } from './routes/projects';
import { encodePng } from './services/png';
import { MOTION_PRESETS } from '../shared/motion/presets';
import { createLayer, createScene } from '../shared/scene/defaults';
import { uid } from '../shared/util/random';

/** Local development credentials (documented in README). Never seeded in production. */
export const DEMO_PASSWORD = 'motion-os-demo';
export const DEMO_USERS = [
  { email: 'alex@motion.os', name: 'Alex Rivera', roles: ['owner'], team: 'Design' },
  { email: 'dana@motion.os', name: 'Dana Okafor', roles: ['designer'], team: 'Design' },
  { email: 'mia@motion.os', name: 'Mia Chen', roles: ['marketing'], team: 'Marketing' },
  { email: 'eli@motion.os', name: 'Eli Novak', roles: ['engineer'], team: 'Engineering' },
  { email: 'omar@motion.os', name: 'Omar Haddad', roles: ['operations'], team: 'Operations' },
  { email: 'vic@motion.os', name: 'Vic Lund', roles: ['viewer'], team: 'Marketing' },
];

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
const IMAGES: { name: string; tags: string[]; px: (x: number, y: number) => number[] }[] = [
  { name: 'Product — Orb', tags: ['product', 'hero'], px: (x, y) => {
    const dx = x - 0.5, dy = y - 0.47, r = Math.hypot(dx, dy) / 0.3;
    const bg = mix([18, 28, 44], [6, 8, 14], y);
    if (r > 1) { const sh = Math.max(0, 1 - Math.hypot(dx, (y - 0.85) * 4) / 0.4) * 0.5; return bg.map((c) => c * (1 - sh)); }
    const nz = Math.sqrt(1 - r * r), l = Math.max(0, -dx * 1.4 - dy * 1.6 + nz * 0.9) / 1.3;
    const spec = Math.pow(Math.max(0, l), 24) * 255;
    return mix([40, 70, 220], [255, 110, 210], (dx / 0.3 + 1) / 2).map((c) => c * (0.25 + 0.85 * l) + spec);
  } },
  { name: 'Lifestyle — Dusk field', tags: ['lifestyle', 'landscape'], px: (x, y) => {
    const sky = mix([255, 170, 120], [60, 30, 90], Math.pow(y / 0.62, 0.9));
    const sun = Math.max(0, 1 - Math.hypot(x - 0.62, y - 0.5) / 0.12);
    const hill = 0.62 + 0.05 * Math.sin(x * 7) + 0.03 * Math.sin(x * 17 + 1);
    if (y > hill) return mix([40, 20, 50], [12, 6, 18], (y - hill) / (1 - hill));
    return sky.map((c, i) => c + sun * [255, 230, 190][i] * 0.9);
  } },
];

/** A demo community post with an image, so publishing/remixing exercise asset copying. */
function launchCard(imageId: string) {
  const c = createScene({ meta: { name: 'Orb launch card', description: 'Hover the product, click “Shop now”.', tags: ['card', 'hover', 'button'], category: 'interactive' } });
  c.canvas = { ...c.canvas, width: 1080, height: 1350, background: '#0b0d14', duration: 4 };
  const img = createLayer('image', { name: 'Product', transform: { x: 0.5, y: 0.4, rotation: 0, scale: 1 } });
  img.props = { ...img.props, assetId: imageId, width: 0.8, height: 0.8, mask: 'rounded', radius: 0.06, reveal: { preset: 'none', start: 0, duration: 1, easing: 'easeOut' } };
  const btn = createLayer('shape', { name: 'Shop button', transform: { x: 0.5, y: 0.86, rotation: 0, scale: 1 } });
  btn.props = { ...btn.props, kind: 'rect', width: 420, height: 120, radius: 60, fill: { type: 'linear', color: '#6b8cff', color2: '#ff6ad5', angle: 0 } };
  const label = createLayer('text', { name: 'Button label', transform: { x: 0.5, y: 0.86, rotation: 0, scale: 1 } });
  label.props = { ...label.props, text: 'Shop now', size: 46 / 1080, weight: 650, color: '#ffffff', animation: { ...label.props.animation, preset: 'none' } };
  c.layers = [img, btn, label];
  const k = (t: number, value: number, easing: any = 'easeInOut') => ({ id: uid('kf'), t, value, easing });
  const zoom = { id: uid('an'), name: 'Zoom product', duration: 0.4, loop: 'once' as const, tracks: [{ id: uid('tr'), layerId: img.id, path: 'transform.scale', keyframes: [k(0, 1, 'expoOut'), k(0.4, 1.05)] }] };
  const pulse = { id: uid('an'), name: 'Button pulse', duration: 0.5, loop: 'once' as const, tracks: [{ id: uid('tr'), layerId: btn.id, path: 'transform.scale', keyframes: [k(0, 1), k(0.15, 1.1, 'backOut'), k(0.5, 1)] }, { id: uid('tr'), layerId: label.id, path: 'transform.scale', keyframes: [k(0, 1), k(0.15, 1.1, 'backOut'), k(0.5, 1)] }] };
  const buy = { id: uid('in'), name: 'Buy', type: 'trigger' as const, default: false };
  c.machine = {
    inputs: [buy], animations: [zoom, pulse], bindings: [],
    rules: [
      { id: uid('ru'), when: { type: 'pointer', event: 'enter', layerId: img.id }, only: [], do: [{ type: 'play', animationId: zoom.id, direction: 'forward', from: 'current' }] },
      { id: uid('ru'), when: { type: 'pointer', event: 'leave', layerId: img.id }, only: [], do: [{ type: 'play', animationId: zoom.id, direction: 'reverse', from: 'current' }] },
      { id: uid('ru'), when: { type: 'pointer', event: 'click', layerId: btn.id }, only: [], do: [{ type: 'fire', inputId: buy.id }] },
      { id: uid('ru'), when: { type: 'trigger', inputId: buy.id }, only: [], do: [{ type: 'play', animationId: pulse.id, direction: 'forward', from: 'start' }] },
    ],
  };
  return c;
}

export async function seedDemo(db: Db, storage: Storage) {
  await ensurePresetPosts(db);
  const existing = await db.one(`SELECT count(*)::int AS n FROM users`);
  if (existing!.n > 0) return false;
  console.log('[seed] creating demo workspace…');
  const hash = await hashPassword(DEMO_PASSWORD);
  const ids: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    ids[u.email] = uid('usr');
    await db.query(`INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)`, [ids[u.email], u.email, u.name, hash]);
  }
  const owner = ids['alex@motion.os'], designer = ids['dana@motion.os'];
  const { workspaceId: ws, teamIds } = await provisionWorkspace(db, owner, 'Lumen Studio');
  for (const u of DEMO_USERS.slice(1)) await addMember(db, ws, ids[u.email], u.roles, [teamIds[u.team]]);

  const images: { id: string; key: string; png: Buffer }[] = [];
  for (const im of IMAGES) {
    const png = encodePng(1200, 1200, (x, y) => im.px(x, y).map(clamp) as [number, number, number]);
    const assetId = uid('ast'), versionId = uid('av');
    const key = `${ws}/assets/${assetId}/${versionId}.png`;
    await storage.put(key, png, 'image/png');
    await db.query(`INSERT INTO media_assets (id, workspace_id, kind, name, category, tags, created_by) VALUES ($1, $2, 'image', $3, $4, $5, $6)`, [assetId, ws, im.name, im.tags[0], im.tags, designer]);
    await db.query(`INSERT INTO asset_versions (id, asset_id, workspace_id, version, storage_key, mime, bytes, width, height, sha256, created_by) VALUES ($1, $2, $3, 1, $4, 'image/png', $5, 1200, 1200, $6, $7)`, [versionId, assetId, ws, key, png.length, createHash('sha256').update(png).digest('hex'), designer]);
    await db.query(`UPDATE media_assets SET current_version_id = $2 WHERE id = $1`, [assetId, versionId]);
    images.push({ id: assetId, key, png });
  }

  // A few starter files in the workspace.
  for (const key of ['toggle-switch', 'day-night', 'progress']) {
    const p = MOTION_PRESETS.find((x) => x.key === key)!;
    await createProject(db, ws, designer, p.name, p.build(), null, p.description);
  }
  // One community post by Dana, with its image copied into community storage like a real publish.
  const card = launchCard(images[0].id);
  const { projectId } = await createProject(db, ws, designer, card.meta.name, card, null, card.meta.description);
  const postId = uid('cp'), cid = uid('ca'), ckey = `community/${postId}/${cid}.png`;
  await storage.put(ckey, images[0].png, 'image/png');
  const published = { ...card, layers: card.layers.map((l) => (l.type === 'image' ? { ...l, props: { ...l.props, assetId: cid } } : l)) };
  await db.query(`INSERT INTO community_posts (id, project_id, workspace_id, author_id, author_name, title, description, tags, doc) VALUES ($1, $2, $3, $4, 'Dana Okafor', $5, $6, $7, $8)`,
    [postId, projectId, ws, designer, card.meta.name, card.meta.description, card.meta.tags, JSON.stringify(published)]);
  await db.query(`INSERT INTO community_assets (id, post_id, storage_key, mime, width, height, bytes) VALUES ($1, $2, $3, 'image/png', 1200, 1200, $4)`, [cid, postId, ckey, images[0].png.length]);
  console.log('[seed] done — sign in as alex@motion.os / dana@motion.os / mia@motion.os / eli@motion.os / omar@motion.os with the demo password');
  return true;
}
