import { create } from 'zustand';
import type { Action, Animation, Binding, Easing, Input, Keyframe, Layer, LayerType, Rule, SceneDocument, Track } from '../../../shared/scene/schema';
import { createLayer, defaultShape } from '../../../shared/scene/defaults';
import { validateScene } from '../../../shared/scene/serialize';
import { evaluateTrack } from '../../../shared/timeline';
import { buildMove, mergeIntoAnimation, type MoveKey } from '../../../shared/motion/moves';
import { getIn, setIn } from '../../../shared/util/paths';
import { uid } from '../../../shared/util/random';
import { api, ApiError, errorMessage } from '../../lib/api';
import { toast } from '../../ui/controls';

/**
 * Editor state. Every document change goes through commit(): validated before saving, undoable
 * (rapid edits like one drag collapse into one step), kept on this device right away and saved to
 * the server after a short pause, with conflict detection.
 *
 * Modes: Design edits how things look; Animate records changes as keyframes into the selected
 * move at the playhead; Interact edits controls and rules; Try it plays everything live.
 */
export type Mode = 'design' | 'animate' | 'interact' | 'try';
export type SaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'error';
type Conflict = { doc: SceneDocument; revision: number; updatedBy: string | null };

type State = {
  projectId: string | null;
  doc: SceneDocument | null;
  revision: number;
  saveState: SaveState;
  saveError: string | null;
  conflict: Conflict | null;
  past: SceneDocument[];
  future: SceneDocument[];
  mode: Mode;
  selection: string | null;
  activeAnim: string | null;
  playhead: number;
  playing: boolean;
  selectedKey: { trackId: string; keyId: string } | null;
};

const HISTORY = 150;
let lastCoalesce: { key: string; at: number } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const draftKey = (id: string) => `mos.edit.draft.${id}`;

export const useEditor = create<State>(() => ({
  projectId: null, doc: null, revision: 0, saveState: 'saved', saveError: null, conflict: null, past: [], future: [],
  mode: 'design', selection: null, activeAnim: null, playhead: 0, playing: false, selectedKey: null,
}));
const get = useEditor.getState;
const set = useEditor.setState;

export function initEditor(projectId: string, doc: SceneDocument, revision: number) {
  set({ projectId, doc, revision, saveState: 'saved', saveError: null, conflict: null, past: [], future: [], selection: null, activeAnim: doc.machine.animations[0]?.id ?? null, playhead: 0, playing: false, selectedKey: null, mode: 'design' });
}
export function readDraft(id: string): { doc: SceneDocument; baseRevision: number; at: number } | null {
  try { const raw = localStorage.getItem(draftKey(id)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function clearDraft(id: string) { try { localStorage.removeItem(draftKey(id)); } catch { /* storage unavailable */ } }

export function commit(fn: (d: SceneDocument) => SceneDocument, coalesce?: string) {
  const { doc, past } = get();
  if (!doc) return;
  const next = fn(doc);
  if (next === doc) return;
  const now = performance.now();
  const merge = coalesce && lastCoalesce?.key === coalesce && now - lastCoalesce.at < 900;
  lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
  set({ doc: next, past: merge ? past : [...past.slice(-HISTORY), doc], future: [], saveState: get().saveState === 'conflict' ? 'conflict' : 'dirty' });
  scheduleSave();
}
export const endCoalesce = () => { lastCoalesce = null; };

export function undo() {
  const { past, doc, future } = get();
  if (!past.length || !doc) return;
  set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], saveState: 'dirty' });
  scheduleSave();
}
export function redo() {
  const { past, doc, future } = get();
  if (!future.length || !doc) return;
  set({ doc: future[0], past: [...past, doc], future: future.slice(1), saveState: 'dirty' });
  scheduleSave();
}

function scheduleSave() {
  const { projectId, doc, revision } = get();
  if (!projectId || !doc) return;
  try { localStorage.setItem(draftKey(projectId), JSON.stringify({ doc, baseRevision: revision, at: Date.now() })); } catch { /* storage unavailable */ }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(), 1200);
}

export async function save(force = false) {
  const s = get();
  if (!s.projectId || !s.doc || (s.saveState === 'conflict' && !force) || (s.saveState === 'saved' && !force)) return;
  const v = validateScene(s.doc);
  if (!v.ok) { set({ saveState: 'error', saveError: `${v.issues[0].path} ${v.issues[0].message}` }); return; }
  const doc = s.doc;
  set({ saveState: 'saving' });
  try {
    const r = await api<{ revision: number }>(`/projects/${s.projectId}/scene`, { method: 'PUT', body: { doc, baseRevision: s.revision, force } });
    const changed = get().doc !== doc;
    set({ revision: r.revision, saveState: changed ? 'dirty' : 'saved', saveError: null, conflict: null });
    if (changed) scheduleSave(); else clearDraft(s.projectId);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.details?.doc) set({ saveState: 'conflict', conflict: { doc: e.details.doc, revision: e.details.revision, updatedBy: e.details.updatedBy } });
    else if (e instanceof ApiError && e.code === 'offline') set({ saveState: 'offline' });
    else {
      set({ saveState: 'error', saveError: errorMessage(e) });
      if (e instanceof ApiError && e.status === 403) toast('danger', 'Saving is no longer allowed', 'Your role changed. Your edits are kept on this device.');
    }
  }
}

export function resolveConflict(choice: 'mine' | 'theirs') {
  const { conflict, doc, projectId } = get();
  if (!conflict || !doc) return;
  if (choice === 'theirs') { set({ doc: conflict.doc, revision: conflict.revision, past: [...get().past, doc], future: [], conflict: null, saveState: 'saved' }); if (projectId) clearDraft(projectId); }
  else { set({ revision: conflict.revision, conflict: null, saveState: 'dirty' }); save(true); }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (get().saveState === 'offline') save(true); });
  window.addEventListener('beforeunload', (e) => { if (get().saveState !== 'saved' && get().projectId) { e.preventDefault(); e.returnValue = ''; } });
}

// ---------- modes, selection, playhead ----------

export const setMode = (mode: Mode) => set({ mode, playing: false, selectedKey: null });
export const select = (id: string | null) => set({ selection: id, selectedKey: null });
export const setPlayhead = (t: number) => { const a = activeAnimation(); set({ playhead: Math.max(0, Math.min(a?.duration ?? 0, t)) }); };
export const setPlaying = (playing: boolean) => set({ playing });
export function activeAnimation(): Animation | null {
  const { doc, activeAnim } = get();
  return doc?.machine.animations.find((a) => a.id === activeAnim) ?? null;
}
export const selectedLayer = () => { const { doc, selection } = get(); return doc?.layers.find((l) => l.id === selection) ?? null; };

/** Layers as they look at the playhead of a move (Animate mode preview). */
export function layersAt(doc: SceneDocument, anim: Animation | null, t: number): Layer[] {
  if (!anim) return doc.layers;
  let out = doc.layers;
  for (const tr of anim.tracks) {
    const v = evaluateTrack(tr, t);
    if (v === undefined) continue;
    const i = out.findIndex((l) => l.id === tr.layerId);
    if (i < 0) continue;
    const cur = getIn(out[i], tr.path);
    if (cur === undefined || typeof cur !== typeof v) continue;
    if (out === doc.layers) out = out.slice();
    out[i] = setIn(out[i], tr.path, v);
  }
  return out;
}

// ---------- layer edits ----------

const snap = (t: number) => Math.round(t * 100) / 100;

/**
 * Change one property. In Design mode it changes the layer itself. In Animate mode it records a
 * keyframe into the selected move at the playhead (adding a starting keyframe at 0 the first time).
 */
export function setProp(layerId: string, path: string, value: unknown, coalesce?: string) {
  const { mode } = get();
  const anim = activeAnimation();
  if (mode === 'animate' && anim && (typeof value === 'number' || typeof value === 'string') && path !== 'name' && !path.startsWith('props.text') && path !== 'visible' && path !== 'locked') {
    const t = snap(get().playhead);
    commit((d) => {
      const base = d.layers.find((l) => l.id === layerId);
      if (!base) return d;
      return mapAnim(d, anim.id, (a) => {
        const tracks = [...a.tracks];
        let i = tracks.findIndex((x) => x.layerId === layerId && x.path === path);
        if (i < 0) {
          const start = getIn(base, path);
          const keys: Keyframe[] = t > 0 && (typeof start === 'number' || typeof start === 'string') ? [{ id: uid('kf'), t: 0, value: start, easing: 'easeInOut' }] : [];
          tracks.push({ id: uid('tr'), layerId, path, keyframes: keys });
          i = tracks.length - 1;
        }
        const tr = tracks[i];
        const at = tr.keyframes.findIndex((k) => Math.abs(k.t - t) < 0.005);
        const keys = at >= 0 ? tr.keyframes.map((k, j) => (j === at ? { ...k, value: value as any } : k)) : [...tr.keyframes, { id: uid('kf'), t, value: value as any, easing: 'easeInOut' as Easing }].sort((a, b) => a.t - b.t);
        tracks[i] = { ...tr, keyframes: keys };
        return { ...a, tracks, duration: Math.max(a.duration, t) };
      });
    }, coalesce ? `${coalesce}@${t}` : undefined);
    return;
  }
  commit((d) => ({ ...d, layers: d.layers.map((l) => (l.id === layerId ? setIn(l, path, value) : l)) }), coalesce);
}

export function addLayer(type: LayerType, patch: Partial<Layer> = {}, kind?: 'rect' | 'ellipse' | 'polygon' | 'star') {
  const doc = get().doc;
  if (!doc) return;
  const l = createLayer(type, patch);
  if (l.type === 'shape') {
    const k = kind ?? 'rect';
    l.props = { ...defaultShape(k), sides: k === 'polygon' ? 6 : 5, innerRadius: 0.45 };
    l.name = { rect: 'Rectangle', ellipse: 'Circle', polygon: 'Polygon', star: 'Star' }[k];
  }
  if (l.type === 'text') l.props = { ...l.props, text: 'Your text', size: 72 / Math.min(doc.canvas.width, doc.canvas.height), animation: { ...l.props.animation, preset: 'none' } };
  commit((d) => ({ ...d, layers: [...d.layers, l] }));
  select(l.id);
  return l.id;
}

/** Remove things that point at deleted layers, controls or moves, so nothing silently breaks. */
export function prune(d: SceneDocument): SceneDocument {
  const L = new Set(d.layers.map((l) => l.id)), I = new Set(d.machine.inputs.map((i) => i.id)), A = new Set(d.machine.animations.map((a) => a.id));
  const ok = (o: any) => (!o.layerId || L.has(o.layerId)) && (!o.inputId || I.has(o.inputId)) && (!o.animationId || A.has(o.animationId));
  return {
    ...d,
    layers: d.layers.map((l) => (l.parentId && !L.has(l.parentId) ? { ...l, parentId: null } : l)),
    tracks: d.tracks.filter((t) => L.has(t.layerId)),
    exposed: d.exposed.map((p) => ({ ...p, targets: p.targets.filter((t) => L.has(t.layerId)) })).filter((p) => p.targets.length),
    machine: {
      ...d.machine,
      inputs: d.machine.inputs.map((i) => (i.dragLayer && !L.has(i.dragLayer) ? { ...i, dragLayer: undefined } : i)),
      animations: d.machine.animations.map((a) => ({ ...a, tracks: a.tracks.filter((t) => L.has(t.layerId)) })),
      rules: d.machine.rules.filter((r) => ok(r.when)).map((r) => ({ ...r, only: r.only.filter(ok), do: r.do.filter(ok) })).filter((r) => r.do.length),
      bindings: d.machine.bindings.filter(ok),
    },
  };
}

export function deleteLayer(id: string) {
  commit((d) => prune({ ...d, layers: d.layers.filter((l) => l.id !== id && l.parentId !== id) }));
  if (get().selection === id) select(null);
}
export function duplicateLayer(id: string) {
  const d = get().doc;
  const l = d?.layers.find((x) => x.id === id);
  if (!d || !l) return;
  const copy = { ...structuredClone(l), id: uid('ly'), name: `${l.name} copy`, transform: { ...l.transform, x: l.transform.x + 24 / d.canvas.width, y: l.transform.y + 24 / d.canvas.height } };
  commit((doc) => { const i = doc.layers.findIndex((x) => x.id === id); const layers = doc.layers.slice(); layers.splice(i + 1, 0, copy); return { ...doc, layers }; });
  select(copy.id);
}
export function moveLayer(id: string, dir: -1 | 1) {
  commit((d) => {
    const i = d.layers.findIndex((l) => l.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= d.layers.length) return d;
    const layers = d.layers.slice();
    [layers[i], layers[j]] = [layers[j], layers[i]];
    return { ...d, layers };
  });
}

// ---------- moves (animations) ----------

function mapAnim(d: SceneDocument, id: string, fn: (a: Animation) => Animation): SceneDocument {
  return { ...d, machine: { ...d.machine, animations: d.machine.animations.map((a) => (a.id === id ? fn(a) : a)) } };
}
const uniqueName = (base: string, taken: string[]) => { let n = base, i = 2; while (taken.includes(n)) n = `${base} ${i++}`; return n; };

export function addAnimation(name = 'New move', loop: Animation['loop'] = 'once', duration = 1) {
  const d = get().doc;
  if (!d) return null;
  const a: Animation = { id: uid('an'), name: uniqueName(name, d.machine.animations.map((x) => x.name)), duration, loop, tracks: [] };
  commit((doc) => ({ ...doc, machine: { ...doc.machine, animations: [...doc.machine.animations, a] } }));
  set({ activeAnim: a.id, playhead: 0 });
  return a.id;
}
export const updateAnimation = (id: string, patch: Partial<Animation>, coalesce?: string) => commit((d) => mapAnim(d, id, (a) => ({ ...a, ...patch })), coalesce);
export function deleteAnimation(id: string) {
  commit((d) => prune({ ...d, machine: { ...d.machine, animations: d.machine.animations.filter((a) => a.id !== id) } }));
  if (get().activeAnim === id) set({ activeAnim: get().doc?.machine.animations[0]?.id ?? null, playhead: 0 });
}

/** Apply a one-click move to a layer inside the selected move (creating one if needed). */
export function applyMove(key: MoveKey, layerId: string, opts: { color?: string; into?: 'new' | 'current'; name?: string } = {}) {
  const d = get().doc;
  const layer = d?.layers.find((l) => l.id === layerId);
  if (!d || !layer) return;
  const built = buildMove(key, layer, d, opts);
  let id = get().activeAnim;
  if (opts.into !== 'current' || !id || !d.machine.animations.some((a) => a.id === id)) id = addAnimation(`${layer.name} · ${opts.name ?? 'move'}`, built.loop, built.duration);
  const doc = get().doc!;
  const anim = doc.machine.animations.find((a) => a.id === id)!;
  const at = anim.tracks.length ? snap(get().playhead) : 0;
  commit((x) => mapAnim(x, id!, (a) => ({ ...mergeIntoAnimation(a, built, at), loop: a.tracks.length ? a.loop : built.loop })));
}

export function moveKeyframe(trackId: string, keyId: string, t: number, coalesce?: string) {
  const anim = activeAnimation();
  if (!anim) return;
  commit((d) => mapAnim(d, anim.id, (a) => ({ ...a, tracks: a.tracks.map((tr) => (tr.id === trackId ? { ...tr, keyframes: tr.keyframes.map((k) => (k.id === keyId ? { ...k, t: snap(Math.max(0, Math.min(a.duration, t))) } : k)).sort((x, y) => x.t - y.t) } : tr)) })), coalesce);
}
export function setKeyEasing(trackId: string, keyId: string, easing: Easing) {
  const anim = activeAnimation();
  if (anim) commit((d) => mapAnim(d, anim.id, (a) => ({ ...a, tracks: a.tracks.map((tr) => (tr.id === trackId ? { ...tr, keyframes: tr.keyframes.map((k) => (k.id === keyId ? { ...k, easing } : k)) } : tr)) })));
}
export function deleteKeyframe(trackId: string, keyId: string) {
  const anim = activeAnimation();
  if (!anim) return;
  commit((d) => mapAnim(d, anim.id, (a) => ({ ...a, tracks: a.tracks.map((tr) => (tr.id === trackId ? { ...tr, keyframes: tr.keyframes.filter((k) => k.id !== keyId) } : tr)).filter((tr) => tr.keyframes.length) })));
  set({ selectedKey: null });
}
export function deleteTrack(trackId: string) {
  const anim = activeAnimation();
  if (anim) commit((d) => mapAnim(d, anim.id, (a) => ({ ...a, tracks: a.tracks.filter((t) => t.id !== trackId) })));
}
export const trackFor = (anim: Animation | null, layerId: string, path: string): Track | undefined => anim?.tracks.find((t) => t.layerId === layerId && t.path === path);

// ---------- controls, rules, slider links ----------

export function addInput(type: Input['type']) {
  const d = get().doc;
  if (!d) return;
  const base = type === 'boolean' ? 'Toggle' : type === 'trigger' ? 'Button' : 'Slider';
  const i: Input = { id: uid('in'), name: uniqueName(base, d.machine.inputs.map((x) => x.name)), type, default: type === 'number' ? 0 : false, ...(type === 'number' ? { min: 0, max: 100 } : {}) };
  commit((doc) => ({ ...doc, machine: { ...doc.machine, inputs: [...doc.machine.inputs, i] } }));
  return i.id;
}
export const updateInput = (id: string, patch: Partial<Input>, coalesce?: string) => commit((d) => ({ ...d, machine: { ...d.machine, inputs: d.machine.inputs.map((i) => (i.id === id ? { ...i, ...patch } as Input : i)) } }), coalesce);
export const deleteInput = (id: string) => commit((d) => prune({ ...d, machine: { ...d.machine, inputs: d.machine.inputs.filter((i) => i.id !== id) } }));

export function addRule(rule: Omit<Rule, 'id'>) {
  commit((d) => ({ ...d, machine: { ...d.machine, rules: [...d.machine.rules, { ...rule, id: uid('ru') }] } }));
}
export const updateRule = (id: string, patch: Partial<Rule>) => commit((d) => ({ ...d, machine: { ...d.machine, rules: d.machine.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) } }));
export const deleteRule = (id: string) => commit((d) => ({ ...d, machine: { ...d.machine, rules: d.machine.rules.filter((r) => r.id !== id) } }));
export const setRuleActions = (id: string, actions: Action[]) => updateRule(id, { do: actions });

export function addBinding(b: Omit<Binding, 'id'>) { commit((d) => ({ ...d, machine: { ...d.machine, bindings: [...d.machine.bindings, { ...b, id: uid('bd') }] } })); }
export const updateBinding = (id: string, patch: Partial<Binding>, coalesce?: string) => commit((d) => ({ ...d, machine: { ...d.machine, bindings: d.machine.bindings.map((b) => (b.id === id ? { ...b, ...patch } : b)) } }), coalesce);
export const deleteBinding = (id: string) => commit((d) => ({ ...d, machine: { ...d.machine, bindings: d.machine.bindings.filter((b) => b.id !== id) } }));
