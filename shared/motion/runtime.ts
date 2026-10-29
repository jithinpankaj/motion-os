import type { Action, Animation, Condition, Layer, Rule, SceneDocument, Track, When } from '../scene/schema';
import { evaluateTrack } from '../timeline';
import { getIn, setIn } from '../util/paths';
import { isHex, mixHex } from '../util/color';
import { ease } from '../util/easing';

/**
 * Runs a scene's interactions: holds control values, plays moves, applies rules and slider links,
 * and produces the layers to draw each frame. Pure and deterministic given the same events and
 * time steps — the editor preview, the community playground and exports all use it.
 */
export type InputValue = boolean | number;
type Playing = { anim: Animation; time: number; dir: 1 | -1; seq: number; mixFrom: Map<string, number | string>; mixElapsed: number; done: boolean };
export type RuntimeEvent = { kind: 'input' | 'play' | 'stop' | 'finish' | 'rule'; id: string; detail?: string };

const MIX = 0.18; // seconds of cross-blend when a move takes over a property mid-flight
const keyOf = (layerId: string, path: string) => `${layerId}|${path}`;

export class MotionRuntime {
  private doc: SceneDocument;
  values: Record<string, InputValue> = {};
  private playing = new Map<string, Playing>();
  private seq = 0;
  private last: Layer[] = [];
  private listeners = new Set<(e: RuntimeEvent) => void>();
  /** Ring of recent events for the "what just happened" panel. */
  log: { t: number; text: string }[] = [];
  private clock = 0;
  /** Where pointer-following sliders are heading; they ease toward it every step. */
  private targets = new Map<string, number>();

  constructor(doc: SceneDocument) {
    this.doc = doc;
    this.last = doc.layers;
    this.reset();
  }

  on(fn: (e: RuntimeEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(e: RuntimeEvent, text?: string) {
    if (text) { this.log.push({ t: this.clock, text }); if (this.log.length > 40) this.log.shift(); }
    this.listeners.forEach((f) => f(e));
  }

  /** Swap in an edited document without losing control values or what's playing. */
  setDoc(doc: SceneDocument) {
    this.doc = doc;
    const ids = new Set(doc.machine.inputs.map((i) => i.id));
    for (const k of Object.keys(this.values)) if (!ids.has(k)) delete this.values[k];
    for (const i of doc.machine.inputs) if (!(i.id in this.values) && i.type !== 'trigger') this.values[i.id] = i.default;
    for (const [id, p] of this.playing) {
      const a = doc.machine.animations.find((x) => x.id === id);
      if (!a) this.playing.delete(id); else p.anim = a;
    }
  }

  /** Back to the starting state: defaults, nothing playing, then the "when it starts" rules. */
  reset() {
    this.values = {};
    for (const i of this.doc.machine.inputs) if (i.type !== 'trigger') this.values[i.id] = i.default;
    this.playing.clear();
    this.last = this.doc.layers;
    this.log = [];
    this.clock = 0;
    this.targets.clear();
    // Rules that describe a resting state (a toggle that starts on, a slider already past a value)
    // are settled instantly so the first frame already looks right.
    for (const r of this.doc.machine.rules) {
      if ((r.when.type === 'boolean' || r.when.type === 'number') && this.holds(r.when) && this.guards(r)) this.run(r, { settle: true });
    }
    for (const r of this.doc.machine.rules) if (r.when.type === 'start' && this.guards(r)) this.run(r);
  }

  private input(id: string) { return this.doc.machine.inputs.find((i) => i.id === id); }
  private compare(op: string, a: number, b: number) { return op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b : Math.abs(a - b) < 1e-9; }
  private holds(c: Condition | When): boolean {
    if (c.type === 'boolean') return this.values[c.inputId] === c.value;
    if (c.type === 'number') return this.compare(c.op, Number(this.values[c.inputId] ?? 0), c.value);
    return false;
  }
  private guards(r: Rule) { return r.only.every((c) => this.holds(c)); }

  // ---------- events from outside (preview controls, pointer, embeds) ----------

  setBoolean(id: string, value: boolean) {
    const inp = this.input(id);
    if (!inp || inp.type !== 'boolean' || this.values[id] === value) return;
    this.values[id] = value;
    this.emit({ kind: 'input', id }, `${inp.name} → ${value ? 'on' : 'off'}`);
    for (const r of this.doc.machine.rules) if (r.when.type === 'boolean' && r.when.inputId === id && r.when.value === value && this.guards(r)) this.run(r);
  }
  toggle(id: string) { this.setBoolean(id, !this.values[id]); }

  fire(id: string) {
    const inp = this.input(id);
    if (!inp || inp.type !== 'trigger') return;
    this.emit({ kind: 'input', id }, `${inp.name} pressed`);
    for (const r of this.doc.machine.rules) if (r.when.type === 'trigger' && r.when.inputId === id && this.guards(r)) this.run(r);
  }

  setNumber(id: string, value: number, quiet = false) {
    const inp = this.input(id);
    if (!inp || inp.type !== 'number') return;
    const v = Math.min(inp.max ?? Infinity, Math.max(inp.min ?? -Infinity, value));
    const before = Number(this.values[id] ?? 0);
    if (before === v) return;
    this.values[id] = v;
    // Pointer-following updates happen every frame; they change values silently (no log, no UI churn).
    if (!quiet) this.emit({ kind: 'input', id }, `${inp.name} = ${+v.toFixed(2)}`);
    // Number rules fire when their condition becomes true (crossing the threshold), not on every change.
    for (const r of this.doc.machine.rules) {
      if (r.when.type !== 'number' || r.when.inputId !== id) continue;
      if (!this.compare(r.when.op, before, r.when.value) && this.compare(r.when.op, v, r.when.value) && this.guards(r)) this.run(r);
    }
  }

  pointer(event: 'click' | 'enter' | 'leave' | 'down' | 'up', layerId: string) {
    for (const r of this.doc.machine.rules) if (r.when.type === 'pointer' && r.when.event === event && r.when.layerId === layerId && this.guards(r)) this.run(r);
  }

  /** Does anything follow the pointer? (Players then track it across the whole page.) */
  get follows() { return this.doc.machine.inputs.some((i) => i.type === 'number' && i.follow); }

  /** Pointer position as fractions of the canvas (may be outside 0–1 when off the canvas). */
  pointerMove(fx: number, fy: number) {
    for (const i of this.doc.machine.inputs) {
      if (i.type !== 'number' || !i.follow) continue;
      const f = Math.min(1, Math.max(0, i.follow === 'pointerX' ? fx : fy));
      const lo = i.min ?? 0, hi = i.max ?? 100;
      this.targets.set(i.id, lo + (hi - lo) * f);
    }
  }
  /** The pointer went away: following sliders drift back to where they started. */
  pointerAway() {
    for (const i of this.doc.machine.inputs) if (i.type === 'number' && i.follow) this.targets.set(i.id, Number(i.default));
  }

  /** Layers that react to the pointer (for hit-testing order and the cursor). */
  get pointerLayers() { return new Set(this.doc.machine.rules.flatMap((r) => (r.when.type === 'pointer' ? [r.when.layerId] : []))); }
  isPlaying(animId: string) { const p = this.playing.get(animId); return !!p && !p.done; }

  // ---------- actions ----------

  private run(rule: Rule, opts: { settle?: boolean } = {}) {
    this.emit({ kind: 'rule', id: rule.id });
    for (const a of rule.do) this.act(a, opts);
  }

  private act(a: Action, opts: { settle?: boolean }) {
    if (a.type === 'play') {
      const anim = this.doc.machine.animations.find((x) => x.id === a.animationId);
      if (!anim) return;
      const dir = a.direction === 'reverse' ? -1 : 1;
      const prev = this.playing.get(anim.id);
      // Playing backwards "from where it is" when it has never played: it is already at its start.
      if (dir < 0 && a.from === 'current' && !prev) return;
      let time = dir > 0 ? 0 : anim.duration;
      if (a.from === 'current' && prev) time = prev.time;
      if (opts.settle && anim.loop === 'once') time = dir > 0 ? anim.duration : 0;
      const continuing = a.from === 'current' && !!prev;
      this.playing.set(anim.id, {
        anim, time, dir: dir as 1 | -1, seq: ++this.seq, done: !!opts.settle && anim.loop === 'once',
        mixFrom: continuing || opts.settle ? new Map() : this.snapshot(anim.tracks), mixElapsed: 0,
      });
      if (!opts.settle) this.emit({ kind: 'play', id: anim.id }, `▶ ${anim.name}${dir < 0 ? ' (backwards)' : ''}`);
    } else if (a.type === 'stop') {
      if (this.playing.delete(a.animationId)) this.emit({ kind: 'stop', id: a.animationId }, `■ ${this.doc.machine.animations.find((x) => x.id === a.animationId)?.name ?? ''}`);
    } else if (a.type === 'setBoolean') {
      const cur = !!this.values[a.inputId];
      this.setBoolean(a.inputId, a.value === 'toggle' ? !cur : a.value === 'on');
    } else if (a.type === 'fire') {
      this.fire(a.inputId);
    } else if (a.type === 'setNumber') {
      this.setNumber(a.inputId, a.mode === 'add' ? Number(this.values[a.inputId] ?? 0) + a.value : a.value);
    }
  }

  private snapshot(tracks: Track[]) {
    const m = new Map<string, number | string>();
    for (const t of tracks) {
      const l = this.last.find((x) => x.id === t.layerId);
      const v = l ? getIn(l, t.path) : undefined;
      if (typeof v === 'number' || typeof v === 'string') m.set(keyOf(t.layerId, t.path), v);
    }
    return m;
  }

  // ---------- time ----------

  /** Advance every playing move by dt seconds; fires "when … finishes" rules. */
  step(dt: number) {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.clock += dt;
    for (const [id, target] of this.targets) {
      const inp = this.input(id);
      if (!inp) { this.targets.delete(id); continue; }
      const cur = Number(this.values[id] ?? 0);
      const rate = 2 + (1 - (inp.smoothing ?? 0.6)) * 28; // per second; higher = snappier
      const next = Math.abs(target - cur) < 1e-3 ? target : cur + (target - cur) * (1 - Math.exp(-rate * dt));
      this.setNumber(id, next, true);
    }
    const finished: string[] = [];
    for (const p of [...this.playing.values()]) {
      p.mixElapsed += dt;
      if (p.done) continue;
      const d = p.anim.duration;
      p.time += dt * p.dir;
      if (p.anim.loop === 'loop') { p.time = ((p.time % d) + d) % d; }
      else if (p.anim.loop === 'pingpong') {
        if (p.time > d) { p.time = 2 * d - p.time; p.dir = -1; }
        else if (p.time < 0) { p.time = -p.time; p.dir = 1; }
      } else if (p.time >= d || p.time <= 0) {
        p.time = Math.min(d, Math.max(0, p.time));
        p.done = true;
        finished.push(p.anim.id);
      }
    }
    for (const id of finished) {
      this.emit({ kind: 'finish', id });
      for (const r of this.doc.machine.rules) if (r.when.type === 'finished' && r.when.animationId === id && this.guards(r)) this.run(r);
    }
  }

  /** The layers to draw now: base design → playing moves (newest wins) → slider links. */
  layers(): Layer[] {
    let out = this.doc.layers;
    const byId = new Map(out.map((l, i) => [l.id, i]));
    const write = (layerId: string, path: string, v: number | string) => {
      const i = byId.get(layerId);
      if (i === undefined) return;
      const cur = getIn(out[i], path);
      if (cur === undefined || typeof cur !== typeof v) return;
      if (out === this.doc.layers) out = out.slice();
      out[i] = setIn(out[i], path, v);
    };
    for (const p of [...this.playing.values()].sort((a, b) => a.seq - b.seq)) {
      const k = p.mixElapsed < MIX ? ease('easeOut', p.mixElapsed / MIX) : 1;
      for (const t of p.anim.tracks) {
        let v = evaluateTrack(t, p.time);
        if (v === undefined) continue;
        const from = k < 1 ? p.mixFrom.get(keyOf(t.layerId, t.path)) : undefined;
        if (from !== undefined) v = blend(from, v, k);
        write(t.layerId, t.path, v);
      }
    }
    for (const b of this.doc.machine.bindings) {
      const x = Number(this.values[b.inputId] ?? 0);
      const span = b.from[1] - b.from[0];
      const u = span === 0 ? 0 : Math.min(1, Math.max(0, (x - b.from[0]) / span));
      const mapped = b.to[0] + (b.to[1] - b.to[0]) * u;
      if (!b.relative) { write(b.layerId, b.path, mapped); continue; }
      // Relative links add to whatever the layer shows now (design + playing moves), so they combine.
      const i = byId.get(b.layerId);
      const cur = i === undefined ? undefined : getIn(out[i], b.path);
      if (typeof cur === 'number') write(b.layerId, b.path, cur + mapped);
    }
    this.last = out;
    return out;
  }
}

function blend(a: number | string, b: number | string, k: number): number | string {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * k;
  if (typeof a === 'string' && typeof b === 'string' && isHex(a) && isHex(b)) return mixHex(a, b, k);
  return k < 0.5 ? a : b;
}

/** A plain timeline document for one move — used to export it as video or a still. */
export function docForAnimation(doc: SceneDocument, animationId: string): SceneDocument {
  const a = doc.machine.animations.find((x) => x.id === animationId);
  if (!a) return doc;
  return { ...doc, tracks: a.tracks, canvas: { ...doc.canvas, duration: a.duration, loop: a.loop !== 'once' } };
}

/**
 * A looping approximation of how a file looks when it starts (its "when it starts" moves), for
 * thumbnails and cards that render without the interactive runtime.
 */
export function previewDoc(doc: SceneDocument): SceneDocument {
  if (!doc.machine.rules.length) return doc;
  const ids = new Set(doc.machine.rules.filter((r) => r.when.type === 'start').flatMap((r) => r.do.flatMap((a) => (a.type === 'play' && a.direction === 'forward' ? [a.animationId] : []))));
  const anims = doc.machine.animations.filter((a) => ids.has(a.id));
  if (!anims.length) return { ...doc, tracks: [] };
  const duration = Math.max(...anims.map((a) => a.duration));
  return { ...doc, tracks: anims.flatMap((a) => a.tracks), canvas: { ...doc.canvas, duration, loop: true } };
}
