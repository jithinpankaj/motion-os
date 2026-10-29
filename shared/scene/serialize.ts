import { SceneSchema, SCHEMA_VERSION, type SceneDocument } from './schema';
import { createScene } from './defaults';

export class SceneValidationError extends Error {
  constructor(public issues: { path: string; message: string }[]) {
    super(`Invalid scene: ${issues.slice(0, 3).map((i) => `${i.path || '(root)'} ${i.message}`).join('; ')}`);
    this.name = 'SceneValidationError';
  }
}

type Migration = { from: number; to: number; up: (doc: any) => any };

/**
 * Ordered migrations. Every stored or imported document is upgraded on read.
 * v1 (pre-release format) used `version`, `canvas.bg`, `layers[].hidden`, and lacked
 * responsive/fallback/export/interactions/tokens sections.
 */
export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    to: 2,
    up: (d) => {
      const base = createScene();
      const { version, ...rest } = d;
      const canvas = { ...base.canvas, ...(d.canvas ?? {}) };
      if (canvas.bg) { canvas.background = canvas.bg; delete canvas.bg; }
      return {
        ...base,
        ...rest,
        schemaVersion: 2,
        canvas,
        layers: (d.layers ?? []).map(({ hidden, ...l }: any) => ({
          parentId: null, locked: false, opacity: 1, blend: 'normal',
          transform: { x: 0.5, y: 0.5, rotation: 0, scale: 1 },
          ...l,
          visible: l.visible ?? !hidden,
        })),
        tracks: d.tracks ?? [],
        tokens: d.tokens ?? base.tokens,
        exposed: d.exposed ?? [],
        responsive: d.responsive ?? base.responsive,
        interactions: d.interactions ?? [],
        fallback: d.fallback ?? base.fallback,
        export: d.export ?? base.export,
      };
    },
  },
];

export function detectVersion(doc: any): number {
  if (typeof doc?.schemaVersion === 'number') return doc.schemaVersion;
  if (typeof doc?.version === 'number') return doc.version;
  return 1;
}

export function migrateScene(input: unknown): unknown {
  if (!input || typeof input !== 'object') throw new SceneValidationError([{ path: '', message: 'document must be an object' }]);
  let doc: any = input;
  let v = detectVersion(doc);
  if (v > SCHEMA_VERSION) throw new SceneValidationError([{ path: 'schemaVersion', message: `version ${v} is newer than supported (${SCHEMA_VERSION})` }]);
  while (v < SCHEMA_VERSION) {
    const m = MIGRATIONS.find((x) => x.from === v);
    if (!m) throw new SceneValidationError([{ path: 'schemaVersion', message: `no migration from v${v}` }]);
    doc = m.up(doc);
    v = m.to;
  }
  return doc;
}

export function validateScene(input: unknown): { ok: true; scene: SceneDocument } | { ok: false; issues: { path: string; message: string }[] } {
  const r = SceneSchema.safeParse(input);
  if (!r.success) return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  const scene = r.data as SceneDocument;
  const issues: { path: string; message: string }[] = [];
  const ids = new Set<string>();
  scene.layers.forEach((l, i) => {
    if (ids.has(l.id)) issues.push({ path: `layers.${i}.id`, message: 'duplicate layer id' });
    ids.add(l.id);
  });
  scene.layers.forEach((l, i) => {
    if (l.parentId && !scene.layers.some((p) => p.id === l.parentId && p.type === 'group')) issues.push({ path: `layers.${i}.parentId`, message: 'parent must be an existing group' });
  });
  // reject parent cycles
  for (const l of scene.layers) {
    let cur = l.parentId, hops = 0;
    while (cur && hops++ < 64) cur = scene.layers.find((p) => p.id === cur)?.parentId ?? null;
    if (hops >= 64) issues.push({ path: `layers`, message: `group cycle at ${l.id}` });
  }
  scene.tracks.forEach((t, i) => {
    if (!ids.has(t.layerId)) issues.push({ path: `tracks.${i}.layerId`, message: 'track targets unknown layer' });
  });
  const keys = new Set<string>();
  scene.exposed.forEach((p, i) => {
    if (keys.has(p.key)) issues.push({ path: `exposed.${i}.key`, message: 'duplicate parameter key' });
    keys.add(p.key);
    p.targets.forEach((t, j) => { if (!ids.has(t.layerId)) issues.push({ path: `exposed.${i}.targets.${j}`, message: 'parameter targets unknown layer' }); });
  });
  if (issues.length) return { ok: false, issues };
  return { ok: true, scene };
}

/** Parse untrusted JSON (string or object): migrate, then validate. Throws SceneValidationError. */
export function deserializeScene(input: string | unknown): SceneDocument {
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (input.length > 5_000_000) throw new SceneValidationError([{ path: '', message: 'document exceeds 5 MB' }]);
    try { raw = JSON.parse(input); } catch { throw new SceneValidationError([{ path: '', message: 'not valid JSON' }]); }
  }
  const migrated = migrateScene(raw);
  const r = validateScene(migrated);
  if (!r.ok) throw new SceneValidationError(r.issues);
  return r.scene;
}

/** Canonical serialisation (stable key order for diffing/versioning). */
export function serializeScene(scene: SceneDocument, pretty = false): string {
  const r = validateScene(scene);
  if (!r.ok) throw new SceneValidationError(r.issues);
  return JSON.stringify(sortKeys(r.scene), null, pretty ? 2 : 0);
}

function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
