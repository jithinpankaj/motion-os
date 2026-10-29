import type { SceneDocument } from './scene/schema';
import { deepEqual } from './util/paths';

export type Change = { scope: string; kind: 'added' | 'removed' | 'changed'; path: string; from?: unknown; to?: unknown };

function walk(a: any, b: any, path: string, scope: string, out: Change[], depth = 0) {
  if (deepEqual(a, b)) return;
  if (depth < 4 && a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], path ? `${path}.${k}` : k, scope, out, depth + 1);
    return;
  }
  out.push({ scope, kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed', path, from: a, to: b });
}

/** Human-oriented diff between two scene versions (layer-aware). */
export function diffScenes(a: SceneDocument, b: SceneDocument): Change[] {
  const out: Change[] = [];
  walk(a.meta, b.meta, 'meta', 'Scene', out);
  walk(a.canvas, b.canvas, 'canvas', 'Scene', out);
  if (a.seed !== b.seed) out.push({ scope: 'Scene', kind: 'changed', path: 'seed', from: a.seed, to: b.seed });
  const la = new Map(a.layers.map((l) => [l.id, l])), lb = new Map(b.layers.map((l) => [l.id, l]));
  for (const [id, l] of lb) if (!la.has(id)) out.push({ scope: l.name, kind: 'added', path: `layer (${l.type})` });
  for (const [id, l] of la) if (!lb.has(id)) out.push({ scope: l.name, kind: 'removed', path: `layer (${l.type})` });
  for (const [id, l] of lb) { const p = la.get(id); if (p) walk(p, l, '', l.name, out); }
  const order = (d: SceneDocument) => d.layers.map((l) => l.id).filter((id) => la.has(id) && lb.has(id)).join();
  if (order(a) !== order(b)) out.push({ scope: 'Scene', kind: 'changed', path: 'layer order' });
  const ta = new Map(a.tracks.map((t) => [t.id, t])), tb = new Map(b.tracks.map((t) => [t.id, t]));
  const name = (d: SceneDocument, id: string) => d.layers.find((l) => l.id === id)?.name ?? id;
  for (const [id, t] of tb) if (!ta.has(id)) out.push({ scope: name(b, t.layerId), kind: 'added', path: `animation ${t.path}` });
  for (const [id, t] of ta) if (!tb.has(id)) out.push({ scope: name(a, t.layerId), kind: 'removed', path: `animation ${t.path}` });
  for (const [id, t] of tb) { const p = ta.get(id); if (p && !deepEqual(p.keyframes, t.keyframes)) out.push({ scope: name(b, t.layerId), kind: 'changed', path: `keyframes ${t.path} (${p.keyframes.length}→${t.keyframes.length})` }); }
  const pa = new Map(a.exposed.map((p) => [p.key, p])), pb = new Map(b.exposed.map((p) => [p.key, p]));
  for (const [k] of pb) if (!pa.has(k)) out.push({ scope: 'Parameters', kind: 'added', path: k });
  for (const [k] of pa) if (!pb.has(k)) out.push({ scope: 'Parameters', kind: 'removed', path: k });
  for (const [k, p] of pb) { const q = pa.get(k); if (q) walk(q, p, k, 'Parameters', out, 2); }
  return out;
}
