import type { Db } from './db';
import type { Storage } from './storage';
import { createHash } from 'node:crypto';
import { hashPassword } from './auth';
import { addMember, provisionWorkspace } from './services/workspace';
import { approveTemplateVersion, publishTemplateVersion, submitTemplateVersion } from './services/templates';
import { createProject } from './routes/projects';
import { encodePng } from './services/png';
import { LAUNCH_PRESETS, GRADIENT_PRESETS } from '../shared/scene/presets';
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
  { name: 'Pattern — Signal grid', tags: ['pattern', 'abstract'], px: (x, y) => {
    const g = (Math.abs(((x * 12) % 1) - 0.5) < 0.03 || Math.abs(((y * 12) % 1) - 0.5) < 0.03) ? 1 : 0;
    const glow = Math.max(0, 1 - Math.hypot(x - 0.5, y - 0.5) / 0.6);
    return mix([8, 10, 12], [210, 255, 60], g * (0.25 + glow * 0.75)).map((c) => c + glow * 18);
  } },
  { name: 'Product — Prism', tags: ['product', 'abstract'], px: (x, y) => {
    const t = (x + y * 0.6) * 3;
    const band = [[255, 90, 54], [255, 201, 79], [79, 227, 255], [124, 77, 255]][Math.floor(t) % 4];
    const vign = 1 - Math.hypot(x - 0.5, y - 0.5) * 0.9;
    return band.map((c) => c * (0.55 + 0.45 * ((t % 1) ** 2)) * vign);
  } },
];

function productSpotlight(id: string, imageIds: string[]) {
  const bg = createLayer('gradient', { id: 'ly_spot_bg', name: 'Mesh gradient' });
  bg.props = { ...bg.props, mode: 'mesh', stops: GRADIENT_PRESETS[2].stops, noiseFreq: 1.2, noiseAmp: 0.5, distortion: 0.3, grain: 0.05 };
  const img = createLayer('image', { id: 'ly_spot_img', name: 'Product image', transform: { x: 0.5, y: 0.42, rotation: 0, scale: 1 } });
  img.props = { ...img.props, assetId: imageIds[0], width: 0.66, height: 0.53, mask: 'rounded', radius: 0.05, reveal: { preset: 'iris', start: 0.2, duration: 1.2, easing: 'expoOut' } };
  const head = createLayer('text', { id: 'ly_spot_head', name: 'Headline', transform: { x: 0.5, y: 0.8, rotation: 0, scale: 1 } });
  head.props = { ...head.props, text: 'Meet the Orb', fontFamily: 'Geist', weight: 700, size: 0.075, tracking: -0.04, maxChars: 26, animation: { preset: 'slide', start: 0.6, duration: 1, stagger: 0.4, easing: 'expoOut', exit: true } };
  const cta = createLayer('text', { id: 'ly_spot_cta', name: 'Call to action', transform: { x: 0.5, y: 0.885, rotation: 0, scale: 1 } });
  cta.props = { ...cta.props, text: 'AVAILABLE NOW', fontFamily: 'Geist Mono', weight: 500, size: 0.022, tracking: 0.3, color: '#d8fff6', animation: { preset: 'fade', start: 1.1, duration: 0.8, stagger: 0, easing: 'easeOut', exit: true } };
  return createScene({
    id, meta: { name: 'Product Spotlight', description: 'Image-led product reveal over a flowing mesh gradient. Swap the product, headline and palette.', tags: ['product', 'image'], category: 'Product' },
    layers: [bg, img, head, cta],
    exposed: [
      { key: 'headline', label: 'Headline', description: 'Product headline.', type: 'text', targets: [{ layerId: head.id, path: 'props.text' }], default: 'Meet the Orb', maxLength: 26, required: true, group: 'Content' },
      { key: 'image', label: 'Product image', description: 'Choose from approved product imagery.', type: 'image', targets: [{ layerId: img.id, path: 'props.assetId' }], default: imageIds[0], options: imageIds.map((v, i) => ({ label: IMAGES[i].name, value: v })), required: true, group: 'Content' },
      { key: 'cta', label: 'Call to action', description: 'Short label under the headline.', type: 'text', targets: [{ layerId: cta.id, path: 'props.text' }], default: 'AVAILABLE NOW', maxLength: 22, group: 'Content' },
      { key: 'palette', label: 'Colour theme', description: 'Brand-approved gradient palettes.', type: 'gradientPreset', targets: [{ layerId: bg.id, path: 'props.stops' }], default: GRADIENT_PRESETS[2].stops, options: ['ocean', 'dusk', 'ember', 'aurora', 'mono'].map((k) => { const g = GRADIENT_PRESETS.find((x) => x.key === k)!; return { label: g.name, value: g.stops }; }), group: 'Style' },
    ],
    responsive: { focalPoint: { x: 0.5, y: 0.42 }, rules: [{ layerId: head.id, safeArea: true, scaleWith: 'min' }, { layerId: cta.id, safeArea: true, scaleWith: 'min' }], overrides: { 'website-banner': { [img.id]: { x: 0.2, y: 0.5, scale: 0.9 }, [head.id]: { x: 0.62, y: 0.42, size: 0.2 }, [cta.id]: { x: 0.62, y: 0.68, size: 0.07 } }, 'website-hero': { [img.id]: { x: 0.3, y: 0.5 }, [head.id]: { x: 0.7, y: 0.45 }, [cta.id]: { x: 0.7, y: 0.56 } } } },
  });
}

export async function seedDemo(db: Db, storage: Storage) {
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
  const { workspaceId: ws, brandId, teamIds } = await provisionWorkspace(db, owner, 'Lumen Studio');
  for (const u of DEMO_USERS.slice(1)) await addMember(db, ws, ids[u.email], u.roles, [teamIds[u.team]]);

  const imageIds: string[] = [];
  for (const im of IMAGES) {
    const png = encodePng(1200, 1200, (x, y) => im.px(x, y).map(clamp) as [number, number, number]);
    const assetId = uid('ast'), versionId = uid('av');
    const key = `${ws}/assets/${assetId}/${versionId}.png`;
    await storage.put(key, png, 'image/png');
    await db.query(`INSERT INTO media_assets (id, workspace_id, brand_id, kind, name, category, tags, created_by) VALUES ($1, $2, $3, 'image', $4, $5, $6, $7)`, [assetId, ws, brandId, im.name, im.tags[0], im.tags, designer]);
    await db.query(`INSERT INTO asset_versions (id, asset_id, workspace_id, version, storage_key, mime, bytes, width, height, sha256, created_by) VALUES ($1, $2, $3, 1, $4, 'image/png', $5, 1200, 1200, $6, $7)`, [versionId, assetId, ws, key, png.length, createHash('sha256').update(png).digest('hex'), designer]);
    await db.query(`UPDATE media_assets SET current_version_id = $2 WHERE id = $1`, [assetId, versionId]);
    imageIds.push(assetId);
  }

  const fakeReq = (userId: string) => ({ ws: { id: ws }, user: { id: userId } }) as any;
  const scenes = [...LAUNCH_PRESETS.map((p) => p.build(uid('scn'))), productSpotlight(uid('scn'), imageIds)];
  const templateIds: string[] = [];
  for (const scene of scenes) {
    const { projectId } = await createProject(db, ws, designer, scene.meta.name, scene, brandId, scene.meta.description);
    const sub = await submitTemplateVersion(db, ws, designer, projectId, {
      name: scene.meta.name, description: scene.meta.description, category: scene.meta.category ?? 'General',
      channels: [], visibleTeamIds: [], changelog: 'Launch preset',
    });
    await db.query(`UPDATE approval_requests SET status = 'approved', decided_at = now() WHERE id = $1`, [sub.approvalRequestId]);
    await db.query(`INSERT INTO approval_decisions (id, request_id, decided_by, decision, comment) VALUES ($1, $2, $3, 'approved', 'Launch set')`, [uid('dec'), sub.approvalRequestId, owner]);
    await approveTemplateVersion(db, ws, sub.versionId, true);
    await publishTemplateVersion(db, ws, sub.templateId, sub.versionId);
    await db.query(`INSERT INTO audit_events (workspace_id, actor_id, action, subject_type, subject_id, data) VALUES ($1, $2, 'asset.publish', 'template', $3, $4)`, [ws, owner, sub.templateId, JSON.stringify({ name: scene.meta.name })]);
    templateIds.push(sub.templateId);
  }
  await createProject(db, ws, designer, 'Exploration — dusk mesh', LAUNCH_PRESETS[1].build(uid('scn')), brandId);
  void fakeReq;
  console.log('[seed] done — sign in as alex@motion.os / dana@motion.os / mia@motion.os / eli@motion.os / omar@motion.os with the demo password');
  return true;
}
