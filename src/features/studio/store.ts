import { create } from 'zustand';
import type { ExposedParam, Keyframe, Layer, LayerType, SceneDocument, Track } from '../../../shared/scene/schema';
import { createLayer } from '../../../shared/scene/defaults';
import { validateScene } from '../../../shared/scene/serialize';
import { evaluateTrack } from '../../../shared/timeline';
import { getIn, setIn, clone } from '../../../shared/util/paths';
import { uid } from '../../../shared/util/random';
import { Clock } from '../../engine/clock';
import type { MotionMode } from '../../engine/layers/base';
import { api, ApiError, errorMessage } from '../../lib/api';
import { toast } from '../../ui/controls';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'error';
export type Conflict = { doc: SceneDocument; revision: number; updatedBy: string | null; updatedAt: string };
type Draft = { doc: SceneDocument; baseRevision: number; at: number };

type State = {
  projectId: string | null;
  doc: SceneDocument | null;
  revision: number;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: number | null;
  conflict: Conflict | null;
  selection: string[];
  selectedKey: { trackId: string; keyId: string } | null;
  past: SceneDocument[];
  future: SceneDocument[];
  clock: Clock;
  previewFormat: string | null;
  overlays: { safe: boolean; grid: boolean; guides: boolean; perf: boolean };
  motion: MotionMode;
  focus: boolean;
  rightTab: 'inspect' | 'params' | 'history';
  issues: { layerId: string; message: string }[];
};

const HISTORY_LIMIT = 150;
let lastCoalesce: { key: string; at: number } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let draftTimer: ReturnType<typeof setTimeout> | null = null;
const draftKey = (id: string) => `mos.draft.${id}`;

export const useStudio = create<State>(() => ({
  projectId: null, doc: null, revision: 0, saveState: 'saved', saveError: null, lastSavedAt: null, conflict: null,
  selection: [], selectedKey: null, past: [], future: [], clock: new Clock(), previewFormat: null,
  overlays: { safe: false, grid: false, guides: true, perf: false }, motion: 'full', focus: false, rightTab: 'inspect', issues: [],
}));
const get = useStudio.getState;
const set = useStudio.setState;

export function initStudio(projectId: string, doc: SceneDocument, revision: number) {
  const clock = new Clock();
  clock.configure({ duration: doc.canvas.duration, loop: doc.canvas.loop, fps: doc.canvas.fps });
  set({ projectId, doc, revision, saveState: 'saved', saveError: null, conflict: null, selection: [], selectedKey: null, past: [], future: [], clock, issues: [], lastSavedAt: Date.now() });
}

export function readDraft(projectId: string): Draft | null {
  try { const raw = localStorage.getItem(draftKey(projectId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function clearDraft(projectId: string) { try { localStorage.removeItem(draftKey(projectId)); } catch {} }

/**
 * Apply a document change. All edits flow through here: validated, recorded for undo (rapid
 * edits with the same coalesce key — e.g. one slider drag — collapse into one step), persisted
 * locally immediately and saved to the server after a short pause.
 */
export function commit(fn: (d: SceneDocument) => SceneDocument, coalesce?: string) {
  const { doc, past } = get();
  if (!doc) return;
  const next = fn(doc);
  if (next === doc) return;
  const now = performance.now();
  const merge = coalesce && lastCoalesce?.key === coalesce && now - lastCoalesce.at < 900;
  lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
  set({ doc: next, past: merge ? past : [...past.slice(-HISTORY_LIMIT), doc], future: [], saveState: get().saveState === 'conflict' ? 'conflict' : 'dirty' });
  if (next.canvas !== doc.canvas) get().clock.configure({ duration: next.canvas.duration, loop: next.canvas.loop, fps: next.canvas.fps });
  scheduleSave();
}
export const endCoalesce = () => { lastCoalesce = null; };

export function undo() {
  const { past, doc, future } = get();
  if (!past.length || !doc) return;
  const prev = past[past.length - 1];
  set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], saveState: 'dirty' });
  get().clock.configure({ duration: prev.canvas.duration, loop: prev.canvas.loop, fps: prev.canvas.fps });
  scheduleSave();
}
export function redo() {
  const { past, doc, future } = get();
  if (!future.length || !doc) return;
  const next = future[0];
  set({ doc: next, past: [...past, doc], future: future.slice(1), saveState: 'dirty' });
  scheduleSave();
}

function scheduleSave() {
  const { projectId } = get();
  if (!projectId) return;
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const s = get();
    if (!s.doc) return;
    try { localStorage.setItem(draftKey(projectId), JSON.stringify({ doc: s.doc, baseRevision: s.revision, at: Date.now() } satisfies Draft)); } catch {}
  }, 250);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(), 1400);
}

export async function save(force = false) {
  const s = get();
  if (!s.projectId || !s.doc || (s.saveState === 'conflict' && !force)) return;
  if (s.saveState === 'saved' && !force) return;
  const v = validateScene(s.doc);
  if (!v.ok) { set({ saveState: 'error', saveError: `Invalid scene: ${v.issues[0].path} ${v.issues[0].message}` }); return; }
  const doc = s.doc;
  set({ saveState: 'saving' });
  try {
    const r = await api<{ revision: number }>(`/projects/${s.projectId}/scene`, { method: 'PUT', body: { doc, baseRevision: s.revision, force } });
    const changedSince = get().doc !== doc;
    set({ revision: r.revision, saveState: changedSince ? 'dirty' : 'saved', saveError: null, lastSavedAt: Date.now(), conflict: null });
    if (changedSince) scheduleSave(); else clearDraft(s.projectId);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.details?.doc) {
      set({ saveState: 'conflict', conflict: { doc: e.details.doc, revision: e.details.revision, updatedBy: e.details.updatedBy, updatedAt: e.details.updatedAt } });
    } else if (e instanceof ApiError && e.code === 'offline') {
      set({ saveState: 'offline', saveError: null });
    } else {
      set({ saveState: 'error', saveError: errorMessage(e) });
      if (e instanceof ApiError && e.status === 403) toast('danger', 'Saving is no longer permitted', 'Your permissions changed. Your edits are kept on this device — export the scene JSON or ask an admin.');
    }
  }
}

export function resolveConflict(choice: 'mine' | 'theirs') {
  const { conflict, doc } = get();
  if (!conflict || !doc) return;
  if (choice === 'theirs') {
    set({ doc: conflict.doc, revision: conflict.revision, past: [...get().past, doc], future: [], conflict: null, saveState: 'saved' });
    clearDraft(get().projectId!);
  } else {
    set({ revision: conflict.revision, conflict: null, saveState: 'dirty' });
    save(true);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (get().saveState === 'offline') save(true); });
  window.addEventListener('beforeunload', (e) => {
    const st = get().saveState;
    if (st !== 'saved') { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ─── Selection & layer commands ─────────────────────────────────────────── */
export const select = (ids: string[]) => set({ selection: ids, selectedKey: null, rightTab: get().rightTab === 'history' ? 'inspect' : get().rightTab });
export const selected = () => { const { doc, selection } = get(); return doc?.layers.find((l) => l.id === selection[0]) ?? null; };

export function updateLayer(id: string, fn: (l: Layer) => Layer, coalesce?: string) {
  commit((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? fn(l) : l)) }), coalesce);
}

const frameSnap = (d: SceneDocument, t: number) => Math.round(t * d.canvas.fps) / d.canvas.fps;

/** Set a property. When the property is animated, writes a keyframe at the playhead instead. */
export function setProp(layerId: string, path: string, value: unknown, coalesce?: string) {
  const d = get().doc!;
  const track = d.tracks.find((t) => t.layerId === layerId && t.path === path && t.keyframes.length);
  if (track && (typeof value === 'number' || typeof value === 'string')) {
    const t = frameSnap(d, get().clock.time);
    const eps = 0.5 / d.canvas.fps;
    commit((doc) => ({
      ...doc,
      tracks: doc.tracks.map((tr) => {
        if (tr.id !== track.id) return tr;
        const hit = tr.keyframes.find((k) => Math.abs(k.t - t) < eps);
        return { ...tr, keyframes: hit ? tr.keyframes.map((k) => (k === hit ? { ...k, value: value as any } : k)) : [...tr.keyframes, { id: uid('kf'), t, value: value as any, easing: 'easeInOut' as const }].sort((a, b) => a.t - b.t) };
      }),
    }), coalesce ?? `${layerId}:${path}`);
    return;
  }
  updateLayer(layerId, (l) => setIn(l, path, value), coalesce ?? `${layerId}:${path}`);
}

/** Current value of a property at the playhead (animated value when keyframed). */
export function valueAt(layer: Layer, path: string, doc: SceneDocument, t: number) {
  const tr = doc.tracks.find((x) => x.layerId === layer.id && x.path === path && x.keyframes.length);
  return tr ? evaluateTrack(tr, t) : getIn(layer, path);
}

export function toggleKeyframe(layerId: string, path: string) {
  const d = get().doc!;
  const t = frameSnap(d, get().clock.time);
  const eps = 0.5 / d.canvas.fps;
  const layer = d.layers.find((l) => l.id === layerId)!;
  const track = d.tracks.find((x) => x.layerId === layerId && x.path === path);
  const current = valueAt(layer, path, d, get().clock.time);
  if (typeof current !== 'number' && typeof current !== 'string') return;
  if (!track) {
    commit((doc) => ({ ...doc, tracks: [...doc.tracks, { id: uid('tr'), layerId, path, keyframes: [{ id: uid('kf'), t, value: current as any, easing: 'easeInOut' }] }] }));
    return;
  }
  const hit = track.keyframes.find((k) => Math.abs(k.t - t) < eps);
  commit((doc) => ({
    ...doc,
    tracks: doc.tracks
      .map((tr) => (tr.id !== track.id ? tr : { ...tr, keyframes: hit ? tr.keyframes.filter((k) => k !== hit) : [...tr.keyframes, { id: uid('kf'), t, value: current as any, easing: 'easeInOut' as const }].sort((a, b) => a.t - b.t) }))
      // Removing the last keyframe bakes its value back into the base property.
      .filter((tr) => tr.keyframes.length > 0),
    layers: hit && track.keyframes.length === 1 ? doc.layers.map((l) => (l.id === layerId ? setIn(l, path, hit.value) : l)) : doc.layers,
  }));
}

export function updateKeyframe(trackId: string, keyId: string, patch: Partial<Keyframe>, coalesce?: string) {
  commit((d) => ({ ...d, tracks: d.tracks.map((t) => (t.id !== trackId ? t : { ...t, keyframes: t.keyframes.map((k) => (k.id === keyId ? { ...k, ...patch } : k)).sort((a, b) => a.t - b.t) })) }), coalesce);
}
export function deleteKeyframe(trackId: string, keyId: string) {
  commit((d) => ({ ...d, tracks: d.tracks.map((t) => (t.id !== trackId ? t : { ...t, keyframes: t.keyframes.filter((k) => k.id !== keyId) })).filter((t) => t.keyframes.length) }));
  set({ selectedKey: null });
}
export const deleteTrack = (trackId: string) => commit((d) => ({ ...d, tracks: d.tracks.filter((t) => t.id !== trackId) }));

export function addLayer(type: LayerType, patch: Partial<Layer> = {}) {
  const d = get().doc!;
  const sel = selected();
  const layer = createLayer(type, { name: `${createLayer(type).name} ${d.layers.filter((l) => l.type === type).length + 1}`, parentId: sel?.type === 'group' ? sel.id : null, ...patch } as any);
  commit((doc) => ({ ...doc, layers: [...doc.layers, layer] }));
  select([layer.id]);
  return layer;
}

const descendants = (layers: Layer[], id: string): string[] => layers.filter((l) => l.parentId === id).flatMap((l) => [l.id, ...descendants(layers, l.id)]);

export function removeLayers(ids: string[]) {
  const d = get().doc!;
  const all = new Set(ids.flatMap((id) => [id, ...descendants(d.layers, id)]));
  const lockedHit = d.layers.filter((l) => all.has(l.id) && l.locked);
  if (lockedHit.length) { toast('warn', 'Locked layers were not removed', lockedHit.map((l) => l.name).join(', ')); lockedHit.forEach((l) => all.delete(l.id)); }
  commit((doc) => ({
    ...doc,
    layers: doc.layers.filter((l) => !all.has(l.id)),
    tracks: doc.tracks.filter((t) => !all.has(t.layerId)),
    exposed: doc.exposed.map((p) => ({ ...p, targets: p.targets.filter((t) => !all.has(t.layerId)) })).filter((p) => p.targets.length),
    responsive: { ...doc.responsive, rules: doc.responsive.rules.filter((r) => !all.has(r.layerId)) },
    interactions: doc.interactions.filter((i) => !all.has(i.layerId)),
    tokens: { bindings: doc.tokens.bindings.filter((b) => !all.has(b.layerId)) },
  }));
  select([]);
}

export function duplicateLayers(ids: string[]) {
  const d = get().doc!;
  const map = new Map<string, string>();
  const src = d.layers.filter((l) => ids.includes(l.id) || ids.some((id) => descendants(d.layers, id).includes(l.id)));
  src.forEach((l) => map.set(l.id, uid('ly')));
  const copies = src.map((l) => ({ ...clone(l), id: map.get(l.id)!, name: ids.includes(l.id) ? `${l.name} copy` : l.name, parentId: l.parentId && map.has(l.parentId) ? map.get(l.parentId)! : l.parentId, transform: ids.includes(l.id) && l.type !== 'gradient' ? { ...l.transform, x: l.transform.x + 0.02, y: l.transform.y + 0.02 } : l.transform }));
  const tracks: Track[] = d.tracks.filter((t) => map.has(t.layerId)).map((t) => ({ ...clone(t), id: uid('tr'), layerId: map.get(t.layerId)!, keyframes: t.keyframes.map((k) => ({ ...k, id: uid('kf') })) }));
  const lastIdx = Math.max(...src.map((l) => d.layers.indexOf(l)));
  commit((doc) => ({ ...doc, layers: [...doc.layers.slice(0, lastIdx + 1), ...copies, ...doc.layers.slice(lastIdx + 1)], tracks: [...doc.tracks, ...tracks] }));
  select(ids.map((id) => map.get(id)!));
}

export function groupLayers(ids: string[]) {
  const d = get().doc!;
  if (!ids.length) return;
  const g = createLayer('group', { name: `Group ${d.layers.filter((l) => l.type === 'group').length + 1}`, parentId: d.layers.find((l) => l.id === ids[0])?.parentId ?? null });
  const first = Math.min(...ids.map((id) => d.layers.findIndex((l) => l.id === id)));
  commit((doc) => {
    const layers = doc.layers.map((l) => (ids.includes(l.id) ? { ...l, parentId: g.id } : l));
    layers.splice(first, 0, g);
    return { ...doc, layers };
  });
  select([g.id]);
}

export function ungroup(id: string) {
  const d = get().doc!;
  const g = d.layers.find((l) => l.id === id);
  if (!g || g.type !== 'group') return;
  commit((doc) => ({ ...doc, layers: doc.layers.filter((l) => l.id !== id).map((l) => (l.parentId === id ? { ...l, parentId: g.parentId } : l)) }));
}

/** Move a layer to a new index in the flat draw order (later = drawn on top). */
export function reorderLayer(id: string, toIndex: number) {
  commit((doc) => {
    const layers = doc.layers.slice();
    const from = layers.findIndex((l) => l.id === id);
    const [l] = layers.splice(from, 1);
    layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, l);
    return { ...doc, layers };
  });
}

/* ─── Exposed parameters ─────────────────────────────────────────────────── */
const camel = (s: string) => s.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[^a-zA-Z]+/, '').replace(/^./, (c) => c.toLowerCase()) || 'param';

export function exposeParam(layerId: string, path: string, label: string, meta: { min?: number; max?: number; step?: number } = {}) {
  const d = get().doc!;
  const layer = d.layers.find((l) => l.id === layerId)!;
  const value = getIn(layer, path);
  const existing = d.exposed.find((p) => p.targets.some((t) => t.layerId === layerId && t.path === path));
  if (existing) { set({ rightTab: 'params' }); return existing; }
  let key = camel(`${layer.type === 'text' ? layer.name : ''} ${label}`);
  for (let i = 2; d.exposed.some((p) => p.key === key); i++) key = `${camel(label)}${i}`;
  const type: ExposedParam['type'] =
    path.endsWith('props.stops') ? 'gradientPreset' : path.endsWith('assetId') ? 'image' : typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? 'color' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : path.endsWith('kind') || path.endsWith('preset') || path.endsWith('mode') ? 'select' : 'text';
  const p: ExposedParam = {
    key, label: layer.type === 'text' && path === 'props.text' ? layer.name : `${label}`, description: '', type, targets: [{ layerId, path }], default: clone(value), group: type === 'text' || type === 'image' ? 'Content' : 'Style',
    ...(type === 'number' ? { min: meta.min ?? 0, max: meta.max ?? 1, step: meta.step ?? 0.01 } : {}),
    ...(type === 'text' ? { maxLength: Math.max(12, Math.ceil(String(value).length * 1.5)) } : {}),
    ...(type === 'gradientPreset' ? { options: [{ label: 'Current', value: clone(value) }] } : {}),
    ...(type === 'image' && value ? { options: [{ label: 'Current image', value }] } : {}),
  };
  commit((doc) => ({ ...doc, exposed: [...doc.exposed, p] }));
  set({ rightTab: 'params' });
  toast('ok', `“${p.label}” is now editable by other teams`, 'Configure its range, options and locks in Parameters.');
  return p;
}
export const updateParam = (key: string, patch: Partial<ExposedParam>, coalesce?: string) => commit((d) => ({ ...d, exposed: d.exposed.map((p) => (p.key === key ? { ...p, ...patch } : p)) }), coalesce);
export const removeParam = (key: string) => commit((d) => ({ ...d, exposed: d.exposed.filter((p) => p.key !== key) }));
