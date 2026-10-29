import { createLayer, createScene } from '../../scene/defaults';
import type { Action, Animation, BuiltinSound, Easing, ExposedParam, Input, Keyframe, Layer, Machine, Rule, SceneDocument, ShapeProps, Track, When } from '../../scene/schema';
import { categoryTag, type LibraryCategory } from './categories';
import { uid } from '../../util/random';

// ---------- a small rig builder ----------
// Positions are written in canvas pixels ("where it sits on the canvas") and converted to the
// coordinates of the layer's group, so parts can be nested without doing the maths by hand.

type Pt = { x: number; y: number };
export class Rig {
  layers: Layer[] = [];
  private pivots = new Map<string, Pt>();
  constructor(readonly W: number, readonly H: number) {}

  /** Group-local position (fractions) for a point given in canvas pixels. */
  private local(p: Pt, parent?: Layer) {
    const o = parent ? this.pivots.get(parent.id)! : { x: this.W / 2, y: this.H / 2 };
    return { x: (p.x - o.x + this.W / 2) / this.W, y: (p.y - o.y + this.H / 2) / this.H };
  }
  /** A group is a pivot: everything inside turns, scales and stretches around this point. */
  group(name: string, pivot: Pt, parent?: Layer) {
    const g = createLayer('group', { name, parentId: parent?.id ?? null, transform: this.local(pivot, parent) });
    this.pivots.set(g.id, pivot);
    this.layers.push(g);
    return g;
  }
  shape(name: string, kind: ShapeProps['kind'], at: Pt, o: { w: number; h: number; color: string; parent?: Layer; radius?: number; sides?: number; inner?: number; fill?: ShapeProps['fill']['type']; stroke?: string; strokeW?: number; opacity?: number; rotation?: number; locked?: boolean }) {
    const l = createLayer('shape', { name, parentId: o.parent?.id ?? null, opacity: o.opacity ?? 1, locked: !!o.locked, transform: { ...this.local(at, o.parent), rotation: o.rotation ?? 0 } });
    l.props = { kind, width: o.w, height: o.h, radius: o.radius ?? 0, sides: o.sides ?? 5, innerRadius: o.inner ?? 0.45, fill: { type: o.fill ?? 'solid', color: o.color, color2: o.color, angle: 90 }, stroke: { color: o.stroke ?? '#000000', width: o.strokeW ?? 0 } };
    this.layers.push(l);
    return l;
  }
  text(name: string, value: string, at: Pt, o: { size: number; color: string; parent?: Layer; weight?: number; font?: string; tracking?: number }) {
    const l = createLayer('text', { name, parentId: o.parent?.id ?? null, transform: this.local(at, o.parent) });
    l.props = { ...l.props, text: value, size: o.size / Math.min(this.W, this.H), color: o.color, weight: o.weight ?? 700, fontFamily: o.font ?? 'Geist', maxWidth: 0.9, tracking: o.tracking ?? -0.01, animation: { ...l.props.animation, preset: 'none' } };
    this.layers.push(l);
    return l;
  }
  /** px → fraction helpers for keyframe values (positions are stored as fractions of the canvas). */
  dx(l: Layer, px: number) { return +(l.transform.x + px / this.W).toFixed(5); }
  dy(l: Layer, px: number) { return +(l.transform.y + px / this.H).toFixed(5); }
}

export type Key = [t: number, value: number | string, easing?: Easing];
/** One property's keyframes: [[time, value, how it moves to the next key], …]. */
export const tr = (l: Layer, path: string, keys: Key[]): Track => ({
  id: uid('tr'), layerId: l.id, path,
  keyframes: keys.map(([t, value, easing]): Keyframe => ({ id: uid('kf'), t, value, easing: easing ?? 'easeInOut' })),
});
export const anim = (name: string, duration: number, loop: Animation['loop'], note: string, tracks: Track[]): Animation => ({ id: uid('an'), name, duration, loop, note, tracks });
export const input = (name: string, type: Input['type'], def: boolean | number): Input => ({ id: uid('in'), name, type, default: def });
export const rule = (when: When, only: Rule['only'], ...actions: Action[]): Rule => ({ id: uid('ru'), when, only, do: actions });
export const play = (a: Animation): Action => ({ type: 'play', animationId: a.id, direction: 'forward', from: 'start' });
export const setBool = (i: Input, value: 'on' | 'off'): Action => ({ type: 'setBoolean', inputId: i.id, value });
export const is = (i: Input, value: boolean) => ({ type: 'boolean' as const, inputId: i.id, value });
export const param = (key: string, label: string, description: string, type: 'color' | 'text', targets: [Layer, string][], def: string, group = 'Style'): ExposedParam => ({
  key, label, description, type, default: def, group, targets: targets.map(([l, path]) => ({ layerId: l.id, path })), ...(type === 'text' ? { maxLength: 18 } : {}),
});

export const playBack = (a: Animation): Action => ({ type: 'play', animationId: a.id, direction: 'reverse', from: 'current' });
export const stop = (a: Animation): Action => ({ type: 'stop', animationId: a.id });
export const fire = (i: Input): Action => ({ type: 'fire', inputId: i.id });
export const setNum = (i: Input, value: number, mode: 'set' | 'add' = 'set'): Action => ({ type: 'setNumber', inputId: i.id, mode, value });
export const sound = (s: BuiltinSound, volume = 0.6): Action => ({ type: 'sound', sound: s, assetId: null, volume });
export const toggle = (i: Input): Action => ({ type: 'setBoolean', inputId: i.id, value: 'toggle' });
export const onPointer = (event: 'click' | 'enter' | 'leave' | 'down' | 'up', l: Layer): When => ({ type: 'pointer', event, layerId: l.id });
export const numIs = (i: Input, op: '>' | '<' | '=' | '>=' | '<=', value: number) => ({ type: 'number' as const, inputId: i.id, op, value });
export const link = (i: Input, l: Layer, path: string, from: [number, number], to: [number, number], relative = true) => ({ id: uid('bd'), inputId: i.id, layerId: l.id, path, from, to, relative });
/** A slider that follows the pointer (optionally only while a layer is dragged). */
export const follower = (name: string, axis: 'pointerX' | 'pointerY', o: { min?: number; max?: number; smoothing?: number; drag?: Layer; bounce?: number } = {}): Input => ({
  id: uid('in'), name, type: 'number', default: 0, min: o.min ?? -1, max: o.max ?? 1, follow: axis, smoothing: o.smoothing ?? 0.7,
  ...(o.drag ? { dragLayer: o.drag.id } : {}), ...(o.bounce ? { bounce: o.bounce } : {}),
});
/** Keyframes that hold a value until `t0`, then animate through the rest (staggering made readable). */
export const after = (t0: number, keys: Key[]): Key[] => keys.map(([t, v, e]) => [+(t + t0).toFixed(3), v, e]);

/** Assemble a finished library file from a rig and its interaction model. */
export function finish(r: Rig, o: { name: string; description: string; category: LibraryCategory; tags: string[]; background: string; machine: Machine; exposed?: ExposedParam[]; duration?: number }): SceneDocument {
  const d = createScene({ meta: { name: o.name, description: o.description, tags: [categoryTag(o.category), ...o.tags], category: o.category } });
  d.canvas = { ...d.canvas, width: r.W, height: r.H, background: o.background, duration: o.duration ?? 4, loop: true };
  d.layers = r.layers;
  d.fallback = { staticFrame: 0, reducedMotion: 'static' };
  d.export = { posterTime: 0 };
  d.exposed = o.exposed ?? [];
  d.machine = o.machine;
  return d;
}
/** Points around a circle: [x, y, angle in degrees] for i of n, starting at `start` degrees (0 = right, 90 = down). */
export const ring = (cx: number, cy: number, radius: number, n: number, start = -90): [number, number, number][] =>
  Array.from({ length: n }, (_, i) => { const a = start + (360 * i) / n; const rad = (a * Math.PI) / 180; return [cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius, a]; });
/** Play a move forward from wherever it currently is (pairs with playBack for hover in/out). */
export const playOn = (a: Animation): Action => ({ type: 'play', animationId: a.id, direction: 'forward', from: 'current' });
