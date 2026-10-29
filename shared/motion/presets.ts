import { createLayer, createScene } from '../scene/defaults';
import type { Action, Animation, Binding, Condition, Easing, Input, Keyframe, Layer, Rule, SceneDocument, ShapeProps, Track, When } from '../scene/schema';
import { GRADIENT_PRESETS } from '../scene/presets';
import { uid } from '../util/random';

/**
 * Interactive starting points. Each one teaches one idea (a toggle, a button, a slider link,
 * number conditions, hover, a loop) and is published to the Community as a preset to remix.
 */
export type MotionPreset = { key: string; name: string; description: string; tip: string; tags: string[]; build: () => SceneDocument };

// ---------- tiny builders ----------

type Ctx = { W: number; H: number; layers: Layer[] };
const ctxOf = (W: number, H: number): Ctx => ({ W, H, layers: [] });
type ShapeOpts = { x: number; y: number; w: number; h: number; color: string; color2?: string; fill?: ShapeProps['fill']['type']; angle?: number; radius?: number; sides?: number; inner?: number; stroke?: string; strokeW?: number; opacity?: number; scale?: number; rotation?: number; parent?: string };
function shape(c: Ctx, name: string, kind: ShapeProps['kind'], o: ShapeOpts) {
  const l = createLayer('shape', { name, parentId: o.parent ?? null, opacity: o.opacity ?? 1, transform: { x: o.x / c.W, y: o.y / c.H, rotation: o.rotation ?? 0, scale: o.scale ?? 1 } });
  l.props = { kind, width: o.w, height: o.h, radius: o.radius ?? 0, sides: o.sides ?? 5, innerRadius: o.inner ?? 0.45, fill: { type: o.fill ?? 'solid', color: o.color, color2: o.color2 ?? o.color, angle: o.angle ?? 90 }, stroke: { color: o.stroke ?? '#ffffff', width: o.strokeW ?? 0 } };
  c.layers.push(l);
  return l;
}
function text(c: Ctx, name: string, value: string, o: { x: number; y: number; size: number; color: string; weight?: number; opacity?: number; font?: string; parent?: string }) {
  const l = createLayer('text', { name, parentId: o.parent ?? null, opacity: o.opacity ?? 1, transform: { x: o.x / c.W, y: o.y / c.H, rotation: 0, scale: 1 } });
  l.props = { ...l.props, text: value, size: o.size / Math.min(c.W, c.H), color: o.color, weight: o.weight ?? 600, fontFamily: o.font ?? 'Geist', maxWidth: 0.9, tracking: -0.02, animation: { ...l.props.animation, preset: 'none' } };
  c.layers.push(l);
  return l;
}
function group(c: Ctx, name: string, x: number, y: number) {
  const g = createLayer('group', { name, transform: { x: x / c.W, y: y / c.H, rotation: 0, scale: 1 } });
  c.layers.push(g);
  return g;
}
/** Child position inside a group placed at (gx, gy): group-local coordinates centre on 0.5. */
const inGroup = (c: Ctx, gx: number, gy: number, x: number, y: number) => ({ x: x - gx + c.W / 2, y: y - gy + c.H / 2 });

const k = (t: number, value: number | string, easing: Easing = 'easeInOut'): Keyframe => ({ id: uid('kf'), t, value, easing });
const tr = (l: Layer, path: string, keys: Keyframe[]): Track => ({ id: uid('tr'), layerId: l.id, path, keyframes: keys });
const anim = (name: string, duration: number, loop: Animation['loop'], tracks: Track[]): Animation => ({ id: uid('an'), name, duration, loop, tracks });
const input = (name: string, type: Input['type'], def: boolean | number, min?: number, max?: number): Input => ({ id: uid('in'), name, type, default: def, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
const rule = (when: When, ...actions: Action[]): Rule => ({ id: uid('ru'), when, only: [], do: actions });
const ruleIf = (when: When, only: Condition[], ...actions: Action[]): Rule => ({ id: uid('ru'), when, only, do: actions });
const play = (a: Animation, direction: 'forward' | 'reverse' = 'forward', from: 'start' | 'current' = 'current'): Action => ({ type: 'play', animationId: a.id, direction, from });
const stop = (a: Animation): Action => ({ type: 'stop', animationId: a.id });
const click = (l: Layer): When => ({ type: 'pointer', event: 'click', layerId: l.id });
const bind = (i: Input, l: Layer, path: string, from: [number, number], to: [number, number]): Binding => ({ id: uid('bd'), inputId: i.id, layerId: l.id, path, from, to });

function doc(c: Ctx, meta: { name: string; description: string; tags: string[] }, background: string, machine: SceneDocument['machine']): SceneDocument {
  const d = createScene({ meta: { ...meta, category: 'interactive' } });
  d.canvas = { ...d.canvas, width: c.W, height: c.H, background, duration: 4, loop: true };
  d.layers = c.layers;
  d.machine = machine;
  d.fallback = { staticFrame: 0, reducedMotion: 'static' };
  d.export = { posterTime: 0 };
  return d;
}

// ---------- presets ----------

function toggleSwitch(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const offL = text(c, 'Off label', 'Off', { x: 540, y: 760, size: 52, color: '#8b8b99' });
  const onL = text(c, 'On label', 'On', { x: 540, y: 760, size: 52, color: '#34c759', opacity: 0 });
  const trk = shape(c, 'Track', 'rect', { x: 540, y: 540, w: 420, h: 220, radius: 110, color: '#3a3a46' });
  const knob = shape(c, 'Knob', 'ellipse', { x: 440, y: 540, w: 170, h: 170, color: '#ffffff' });
  const on = input('On', 'boolean', false);
  const turnOn = anim('Turn on', 0.45, 'once', [
    tr(knob, 'transform.x', [k(0, 440 / 1080, 'backOut'), k(0.45, 640 / 1080)]),
    tr(knob, 'props.width', [k(0, 170), k(0.18, 215), k(0.45, 170)]),
    tr(trk, 'props.fill.color', [k(0, '#3a3a46'), k(0.3, '#34c759')]),
    tr(onL, 'opacity', [k(0.1, 0), k(0.45, 1)]),
    tr(offL, 'opacity', [k(0, 1), k(0.25, 0)]),
  ]);
  return doc(c, { name: 'Toggle switch', description: 'An on/off switch driven by a toggle control.', tags: ['toggle', 'ui', 'starter'] }, '#101018', {
    inputs: [on], animations: [turnOn], bindings: [],
    rules: [
      rule(click(trk), { type: 'setBoolean', inputId: on.id, value: 'toggle' }),
      rule(click(knob), { type: 'setBoolean', inputId: on.id, value: 'toggle' }),
      rule({ type: 'boolean', inputId: on.id, value: true }, play(turnOn)),
      rule({ type: 'boolean', inputId: on.id, value: false }, play(turnOn, 'reverse')),
    ],
  });
}

function favourite(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const dots = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return { l: shape(c, `Spark ${i + 1}`, 'ellipse', { x: 540 + Math.cos(a) * 120, y: 540 + Math.sin(a) * 120, w: 26, h: 26, color: i % 2 ? '#ff6ad5' : '#ffc83d', opacity: 0 }), a };
  });
  const btn = shape(c, 'Button', 'ellipse', { x: 540, y: 540, w: 300, h: 300, color: '#1f1d2b' });
  const ring = shape(c, 'Ring', 'ellipse', { x: 540, y: 540, w: 300, h: 300, color: '#000000', fill: 'none', stroke: '#ffc83d', strokeW: 10, opacity: 0, scale: 0.6 });
  const star = shape(c, 'Star', 'star', { x: 540, y: 545, w: 170, h: 170, sides: 5, inner: 0.48, color: '#5a5670', radius: 0 });
  const label = text(c, 'Hint', 'Tap the star', { x: 540, y: 820, size: 40, color: '#6e6a85' });
  const liked = input('Liked', 'boolean', false);
  const like = anim('Like', 0.7, 'once', [
    tr(star, 'props.fill.color', [k(0, '#5a5670'), k(0.15, '#ffc83d')]),
    tr(star, 'transform.scale', [k(0, 1, 'easeOut'), k(0.15, 1.35, 'backOut'), k(0.5, 1)]),
    tr(ring, 'transform.scale', [k(0, 0.6, 'easeOut'), k(0.5, 1.45)]),
    tr(ring, 'opacity', [k(0, 0), k(0.08, 1), k(0.5, 0)]),
    ...dots.flatMap(({ l, a }) => [
      tr(l, 'transform.x', [k(0.05, (540 + Math.cos(a) * 120) / 1080, 'expoOut'), k(0.6, (540 + Math.cos(a) * 250) / 1080)]),
      tr(l, 'transform.y', [k(0.05, (540 + Math.sin(a) * 120) / 1080, 'expoOut'), k(0.6, (540 + Math.sin(a) * 250) / 1080)]),
      tr(l, 'opacity', [k(0.05, 0), k(0.12, 1), k(0.6, 0)]),
    ]),
    tr(label, 'opacity', [k(0, 1), k(0.3, 0.35)]),
  ]);
  const unlike = anim('Unlike', 0.3, 'once', [
    tr(star, 'props.fill.color', [k(0, '#ffc83d'), k(0.3, '#5a5670')]),
    tr(star, 'transform.scale', [k(0, 1), k(0.12, 0.85), k(0.3, 1, 'backOut')]),
  ]);
  return doc(c, { name: 'Favourite button', description: 'A star that bursts when you like it.', tags: ['button', 'toggle', 'ui', 'starter'] }, '#12111a', {
    inputs: [liked], animations: [like, unlike], bindings: [],
    rules: [
      rule(click(btn), { type: 'setBoolean', inputId: liked.id, value: 'toggle' }),
      rule(click(star), { type: 'setBoolean', inputId: liked.id, value: 'toggle' }),
      rule({ type: 'boolean', inputId: liked.id, value: true }, stop(unlike), play(like, 'forward', 'start')),
      rule({ type: 'boolean', inputId: liked.id, value: false }, stop(like), play(unlike, 'forward', 'start')),
    ],
  });
}

function progress(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const title = text(c, 'Loading text', 'Loading…', { x: 540, y: 430, size: 56, color: '#e5e7eb' });
  const done = text(c, 'Done text', 'All done!', { x: 540, y: 430, size: 56, color: '#34d399', opacity: 0 });
  shape(c, 'Bar background', 'rect', { x: 540, y: 540, w: 700, h: 36, radius: 18, color: '#232a36' });
  const fill = shape(c, 'Bar fill', 'rect', { x: 190, y: 540, w: 1, h: 36, radius: 18, color: '#6b8cff', color2: '#34d3c5', fill: 'linear', angle: 0 });
  const dot = shape(c, 'Orbit dot', 'ellipse', { x: 540, y: 700, w: 26, h: 26, color: '#6b8cff' });
  const badge = shape(c, 'Done badge', 'ellipse', { x: 540, y: 700, w: 120, h: 120, color: '#34d399', scale: 0.01, opacity: 0 });
  const amount = input('Progress', 'number', 0, 0, 100);
  const N = 12, R = 60;
  const spin = anim('Spinning', 1.2, 'loop', [
    tr(dot, 'transform.x', Array.from({ length: N + 1 }, (_, i) => k((1.2 * i) / N, (540 + Math.cos((i / N) * Math.PI * 2) * R) / 1080, 'linear'))),
    tr(dot, 'transform.y', Array.from({ length: N + 1 }, (_, i) => k((1.2 * i) / N, (700 + Math.sin((i / N) * Math.PI * 2) * R) / 1080, 'linear'))),
  ]);
  const finish = anim('Finished', 0.6, 'once', [
    tr(badge, 'transform.scale', [k(0, 0.01, 'backOut'), k(0.5, 1)]),
    tr(badge, 'opacity', [k(0, 0), k(0.15, 1)]),
    tr(dot, 'opacity', [k(0, 1), k(0.2, 0)]),
    tr(title, 'opacity', [k(0, 1), k(0.25, 0)]),
    tr(done, 'opacity', [k(0.15, 0), k(0.45, 1)]),
  ]);
  return doc(c, { name: 'Progress loader', description: 'A slider fills the bar; reaching 100 shows “done”.', tags: ['slider', 'loader', 'ui', 'starter'] }, '#0e1116', {
    inputs: [amount], animations: [spin, finish],
    bindings: [bind(amount, fill, 'props.width', [0, 100], [1, 700]), bind(amount, fill, 'transform.x', [0, 100], [190 / 1080, 540 / 1080])],
    rules: [
      rule({ type: 'start' }, play(spin, 'forward', 'start')),
      rule({ type: 'number', inputId: amount.id, op: '>=', value: 100 }, stop(spin), play(finish)),
      rule({ type: 'number', inputId: amount.id, op: '<', value: 100 }, play(finish, 'reverse'), play(spin, 'forward', 'start')),
    ],
  });
}

function dayNight(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const sky = shape(c, 'Sky', 'rect', { x: 540, y: 540, w: 1080, h: 1080, color: '#7dd3fc', color2: '#e0f2fe', fill: 'linear', angle: 90 });
  const stars = [[200, 180], [380, 120], [760, 160], [900, 300], [140, 380], [620, 260]].map(([x, y], i) => shape(c, `Star ${i + 1}`, 'star', { x, y, w: 30, h: 30, sides: 4, inner: 0.35, color: '#ffffff', opacity: 0 }));
  const sun = shape(c, 'Sun', 'ellipse', { x: 540, y: 400, w: 220, h: 220, color: '#fde68a', color2: '#f59e0b', fill: 'radial' });
  const moon = shape(c, 'Moon', 'ellipse', { x: 540, y: 980, w: 180, h: 180, color: '#e5e7eb', opacity: 0 });
  const hills = shape(c, 'Hills', 'ellipse', { x: 540, y: 1060, w: 1700, h: 520, color: '#22c55e' });
  const hint = text(c, 'Hint', 'Tap the sky', { x: 540, y: 1010, size: 34, color: '#14532d' });
  const night = input('Night', 'boolean', false);
  const D = 1.6;
  const sunset = anim('Sunset', D, 'once', [
    tr(sky, 'props.fill.color', [k(0, '#7dd3fc'), k(D, '#0b1026')]),
    tr(sky, 'props.fill.color2', [k(0, '#e0f2fe'), k(D, '#312e81')]),
    tr(sun, 'transform.y', [k(0, 400 / 1080, 'easeIn'), k(D * 0.7, 980 / 1080)]),
    tr(sun, 'opacity', [k(D * 0.4, 1), k(D * 0.7, 0)]),
    tr(moon, 'transform.y', [k(D * 0.35, 980 / 1080, 'expoOut'), k(D, 380 / 1080)]),
    tr(moon, 'opacity', [k(D * 0.35, 0), k(D * 0.6, 1)]),
    tr(hills, 'props.fill.color', [k(0, '#22c55e'), k(D, '#14532d')]),
    tr(hint, 'props.color', [k(0, '#14532d'), k(D, '#86efac')]),
    ...stars.map((s, i) => tr(s, 'opacity', [k(D * (0.6 + i * 0.05), 0), k(D * (0.75 + i * 0.04), 1)])),
  ]);
  const toggle = { type: 'setBoolean', inputId: night.id, value: 'toggle' } as const;
  return doc(c, { name: 'Day & night', description: 'One toggle turns day into night.', tags: ['toggle', 'scene', 'illustration'] }, '#7dd3fc', {
    inputs: [night], animations: [sunset], bindings: [],
    rules: [
      rule(click(sky), toggle), rule(click(sun), toggle), rule(click(moon), toggle), rule(click(hills), toggle),
      rule({ type: 'boolean', inputId: night.id, value: true }, play(sunset)),
      rule({ type: 'boolean', inputId: night.id, value: false }, play(sunset, 'reverse')),
    ],
  });
}

function hoverCard(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const glow = shape(c, 'Glow', 'rect', { x: 540, y: 540, w: 540, h: 660, radius: 44, color: '#6b8cff', color2: '#ff6ad5', fill: 'linear', angle: 45, opacity: 0, scale: 0.97 });
  const card = shape(c, 'Card', 'rect', { x: 540, y: 540, w: 520, h: 640, radius: 36, color: '#1c1c26', stroke: '#2b2b38', strokeW: 2 });
  const art = shape(c, 'Artwork', 'rect', { x: 540, y: 440, w: 440, h: 320, radius: 24, color: '#6b8cff', color2: '#a78bfa', fill: 'linear', angle: 120 });
  const orb = shape(c, 'Orb', 'ellipse', { x: 620, y: 420, w: 120, h: 120, color: '#fde68a', color2: '#fb7185', fill: 'radial' });
  const title = text(c, 'Title', 'Hover me', { x: 540, y: 690, size: 52, color: '#f5f5f7' });
  const sub = text(c, 'Subtitle', 'Cards lift when you point at them', { x: 540, y: 760, size: 26, color: '#9ca3af', weight: 450 });
  const D = 0.35;
  const lift = anim('Lift', D, 'once', [
    ...[card, art, title, sub].map((l) => tr(l, 'transform.y', [k(0, l.transform.y, 'expoOut'), k(D, l.transform.y - 18 / 1080)])),
    tr(orb, 'transform.y', [k(0, orb.transform.y, 'expoOut'), k(D, orb.transform.y - 40 / 1080)]),
    tr(orb, 'transform.scale', [k(0, 1, 'backOut'), k(D, 1.2)]),
    tr(glow, 'opacity', [k(0, 0), k(D, 1)]),
    tr(glow, 'transform.y', [k(0, 0.5, 'expoOut'), k(D, 0.5 - 18 / 1080)]),
    tr(glow, 'transform.scale', [k(0, 0.97, 'expoOut'), k(D, 1.0)]),
    tr(art, 'props.fill.color', [k(0, '#6b8cff'), k(D, '#22d3ee')]),
  ]);
  return doc(c, { name: 'Hover card', description: 'A card that lifts and glows when the pointer is over it.', tags: ['hover', 'card', 'ui'] }, '#0f0f14', {
    inputs: [], animations: [lift], bindings: [],
    rules: [
      rule({ type: 'pointer', event: 'enter', layerId: card.id }, play(lift)),
      rule({ type: 'pointer', event: 'leave', layerId: card.id }, play(lift, 'reverse')),
    ],
  });
}

function bell(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const gx = 540, gy = 330; // swing from the top of the bell
  const g = group(c, 'Bell', gx, gy);
  const P = (x: number, y: number) => inGroup(c, gx, gy, x, y);
  const clapper = shape(c, 'Clapper', 'ellipse', { ...P(540, 660), w: 70, h: 70, color: '#f59e0b', parent: g.id });
  const body = shape(c, 'Bell body', 'rect', { ...P(540, 500), w: 300, h: 320, radius: 150, color: '#fbbf24', color2: '#f59e0b', fill: 'linear', angle: 90, parent: g.id });
  const rim = shape(c, 'Rim', 'rect', { ...P(540, 630), w: 380, h: 60, radius: 30, color: '#f59e0b', parent: g.id });
  const knob = shape(c, 'Top', 'ellipse', { ...P(540, 340), w: 60, h: 60, color: '#fbbf24', parent: g.id });
  const badge = shape(c, 'Badge', 'ellipse', { x: 680, y: 380, w: 110, h: 110, color: '#ef4444', stroke: '#111827', strokeW: 10, scale: 0.01 });
  text(c, 'Hint', 'Tap the bell · tap the badge to clear', { x: 540, y: 860, size: 32, color: '#6b7280', weight: 450 });
  const ring = input('Ring', 'trigger', false);
  const unread = input('Unread', 'boolean', false);
  const swing = anim('Ring', 1, 'once', [
    tr(g, 'transform.rotation', [k(0, 0), k(0.12, -18), k(0.3, 15), k(0.48, -10), k(0.66, 6), k(0.84, -3), k(1, 0)]),
    tr(clapper, 'transform.x', [k(0.05, P(540, 0).x / 1080), k(0.2, P(565, 0).x / 1080), k(0.38, P(515, 0).x / 1080), k(0.6, P(540, 0).x / 1080)]),
  ]);
  const pop = anim('Badge pop', 0.4, 'once', [tr(badge, 'transform.scale', [k(0, 0.01, 'backOut'), k(0.4, 1)])]);
  const ringIt = { type: 'fire', inputId: ring.id } as const;
  return doc(c, { name: 'Notification bell', description: 'A button (trigger) rings the bell and sets an unread badge.', tags: ['trigger', 'icon', 'ui'] }, '#111827', {
    inputs: [ring, unread], animations: [swing, pop], bindings: [],
    rules: [
      rule(click(body), ringIt), rule(click(rim), ringIt), rule(click(knob), ringIt),
      rule({ type: 'trigger', inputId: ring.id }, play(swing, 'forward', 'start'), { type: 'setBoolean', inputId: unread.id, value: 'on' }),
      rule({ type: 'boolean', inputId: unread.id, value: true }, play(pop)),
      rule({ type: 'boolean', inputId: unread.id, value: false }, play(pop, 'reverse')),
      rule(click(badge), { type: 'setBoolean', inputId: unread.id, value: 'off' }),
    ],
  });
}

function pressButton(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const ripple = shape(c, 'Ripple', 'ellipse', { x: 540, y: 540, w: 150, h: 150, color: '#000000', fill: 'none', stroke: '#ffffff', strokeW: 6, opacity: 0 });
  const btn = shape(c, 'Button', 'rect', { x: 540, y: 540, w: 520, h: 150, radius: 75, color: '#7c3aed', color2: '#db2777', fill: 'linear', angle: 0 });
  const label = text(c, 'Label', 'Get started', { x: 540, y: 540, size: 52, color: '#ffffff' });
  const go = input('Go', 'trigger', false);
  const press = anim('Press', 0.12, 'once', [tr(btn, 'transform.scale', [k(0, 1, 'easeOut'), k(0.12, 0.94)]), tr(label, 'transform.scale', [k(0, 1, 'easeOut'), k(0.12, 0.94)])]);
  const wave = anim('Ripple', 0.7, 'once', [
    tr(ripple, 'props.width', [k(0, 150, 'expoOut'), k(0.7, 760)]),
    tr(ripple, 'props.height', [k(0, 150, 'expoOut'), k(0.7, 760)]),
    tr(ripple, 'opacity', [k(0, 0.8), k(0.7, 0)]),
  ]);
  return doc(c, { name: 'Press button', description: 'Squishes while held and sends a ripple when clicked.', tags: ['button', 'trigger', 'ui', 'starter'] }, '#0b0b10', {
    inputs: [go], animations: [press, wave], bindings: [],
    rules: [
      rule({ type: 'pointer', event: 'down', layerId: btn.id }, play(press)),
      rule({ type: 'pointer', event: 'up', layerId: btn.id }, play(press, 'reverse')),
      rule({ type: 'pointer', event: 'leave', layerId: btn.id }, play(press, 'reverse')),
      rule(click(btn), { type: 'fire', inputId: go.id }),
      rule({ type: 'trigger', inputId: go.id }, play(wave, 'forward', 'start')),
    ],
  });
}

function trafficLight(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const housing = shape(c, 'Housing', 'rect', { x: 540, y: 520, w: 260, h: 660, radius: 70, color: '#1f2430', stroke: '#2e3546', strokeW: 6 });
  const lights = [['Red', 320, '#3b1d1d', '#ef4444'], ['Amber', 520, '#3b341d', '#f59e0b'], ['Green', 720, '#1d3b26', '#22c55e']] as const;
  const L = lights.map(([n, y, dim]) => shape(c, `${n} light`, 'ellipse', { x: 540, y, w: 170, h: 170, color: dim }));
  text(c, 'Hint', 'Tap the light to step', { x: 540, y: 950, size: 34, color: '#6b7280', weight: 450 });
  const step = input('Step', 'number', 0, 0, 3);
  const next = input('Next', 'trigger', false);
  const A = lights.map(([n, , dim, bright], i) => anim(n, 0.3, 'once', [tr(L[i], 'props.fill.color', [k(0, dim), k(0.3, bright)]), tr(L[i], 'transform.scale', [k(0, 1, 'backOut'), k(0.3, 1.06)])]));
  const showOnly = (i: number) => A.map((a, j) => play(a, j === i ? 'forward' : 'reverse'));
  return doc(c, { name: 'Traffic light', description: 'A number control picks which light is on; a button steps through them.', tags: ['number', 'conditions', 'starter'] }, '#0e1015', {
    inputs: [step, next], animations: A, bindings: [],
    rules: [
      rule(click(housing), { type: 'fire', inputId: next.id }), ...L.map((l) => rule(click(l), { type: 'fire', inputId: next.id })),
      rule({ type: 'trigger', inputId: next.id }, { type: 'setNumber', inputId: step.id, mode: 'add', value: 1 }),
      rule({ type: 'number', inputId: step.id, op: '>=', value: 3 }, { type: 'setNumber', inputId: step.id, mode: 'set', value: 0 }),
      ...[0, 1, 2].map((i) => rule({ type: 'number', inputId: step.id, op: '=', value: i }, ...showOnly(i))),
    ],
  });
}

function bouncingBall(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const shadow = shape(c, 'Shadow', 'ellipse', { x: 540, y: 800, w: 220, h: 40, color: '#000000', opacity: 0.35 });
  const ball = shape(c, 'Ball', 'ellipse', { x: 540, y: 690, w: 200, h: 200, color: '#ff8a5b', color2: '#ff3d6e', fill: 'radial' });
  const bouncy = input('Bouncing', 'boolean', true);
  const D = 1;
  const top = 330 / 1080, floor = 690 / 1080;
  const bounce = anim('Bounce', D, 'loop', [
    tr(ball, 'transform.y', [k(0, floor, 'easeOut'), k(D * 0.5, top, 'easeIn'), k(D, floor)]),
    tr(ball, 'props.width', [k(0, 240), k(0.12, 190), k(D * 0.88, 190), k(D, 240)]),
    tr(ball, 'props.height', [k(0, 160), k(0.12, 210), k(D * 0.88, 210), k(D, 160)]),
    tr(shadow, 'props.width', [k(0, 240, 'easeOut'), k(D * 0.5, 110, 'easeIn'), k(D, 240)]),
    tr(shadow, 'opacity', [k(0, 0.4, 'easeOut'), k(D * 0.5, 0.12, 'easeIn'), k(D, 0.4)]),
  ]);
  return doc(c, { name: 'Bouncing ball', description: 'A looping move with squash and stretch, switched by a toggle.', tags: ['loop', 'character', 'starter'] }, '#14121c', {
    inputs: [bouncy], animations: [bounce], bindings: [],
    rules: [
      rule({ type: 'boolean', inputId: bouncy.id, value: true }, play(bounce, 'forward', 'start')),
      rule({ type: 'boolean', inputId: bouncy.id, value: false }, stop(bounce)),
      rule(click(ball), { type: 'setBoolean', inputId: bouncy.id, value: 'toggle' }),
    ],
  });
}

function auroraMood(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const bg = createLayer('gradient', { name: 'Aurora' });
  bg.props = { ...bg.props, mode: 'aurora', stops: GRADIENT_PRESETS[0].stops.map((s) => ({ ...s })), noiseAmp: 0.5, speed: 1 };
  c.layers.push(bg);
  const title = text(c, 'Title', 'Aurora', { x: 540, y: 520, size: 120, color: '#ffffff', weight: 650 });
  text(c, 'Hint', 'Drag Energy · flip Dusk', { x: 540, y: 620, size: 34, color: '#e5e7eb', weight: 450 });
  const energy = input('Energy', 'number', 0.5, 0, 1);
  const dusk = input('Dusk', 'boolean', false);
  const target = ['#1a0b2e', '#7c2d92', '#f97316', '#fde68a'];
  const toDusk = anim('Dusk', 1.2, 'once', bg.props.stops.slice(0, 4).map((s, i) => tr(bg, `props.stops.${i}.color`, [k(0, s.color), k(1.2, target[i])])));
  return doc(c, { name: 'Aurora mood', description: 'A slider sets how lively the aurora is; a toggle shifts it to dusk.', tags: ['slider', 'background', 'effects'] }, '#05060a', {
    inputs: [energy, dusk], animations: [toDusk],
    bindings: [bind(energy, bg, 'props.noiseAmp', [0, 1], [0.1, 1.3]), bind(energy, bg, 'props.distortion', [0, 1], [0.05, 0.8]), bind(energy, title, 'transform.scale', [0, 1], [0.9, 1.1])],
    rules: [
      rule({ type: 'boolean', inputId: dusk.id, value: true }, play(toDusk)),
      rule({ type: 'boolean', inputId: dusk.id, value: false }, play(toDusk, 'reverse')),
    ],
  });
}

function checkbox(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const rows = ['Design the scene', 'Add a move', 'Make it interactive'];
  const inputs: Input[] = [], anims: Animation[] = [], rules: Rule[] = [];
  rows.forEach((label, i) => {
    const y = 380 + i * 160;
    const box = shape(c, `Box ${i + 1}`, 'rect', { x: 300, y, w: 90, h: 90, radius: 22, color: '#1f2233', stroke: '#3b3f5c', strokeW: 6 });
    const tick = shape(c, `Tick ${i + 1}`, 'star', { x: 300, y, w: 54, h: 54, sides: 4, inner: 0.4, color: '#ffffff', scale: 0.01, rotation: 45 });
    const txt = text(c, `Label ${i + 1}`, label, { x: 600, y, size: 44, color: '#e5e7eb', weight: 500 });
    const done = input(`Done ${i + 1}`, 'boolean', false);
    const a = anim(`Check ${i + 1}`, 0.35, 'once', [
      tr(box, 'props.fill.color', [k(0, '#1f2233'), k(0.2, '#6b8cff')]),
      tr(box, 'props.stroke.color', [k(0, '#3b3f5c'), k(0.2, '#6b8cff')]),
      tr(tick, 'transform.scale', [k(0.05, 0.01, 'backOut'), k(0.35, 1)]),
      tr(txt, 'props.color', [k(0, '#e5e7eb'), k(0.3, '#6b7280')]),
    ]);
    inputs.push(done); anims.push(a);
    rules.push(
      rule(click(box), { type: 'setBoolean', inputId: done.id, value: 'toggle' }),
      rule(click(txt), { type: 'setBoolean', inputId: done.id, value: 'toggle' }),
      rule({ type: 'boolean', inputId: done.id, value: true }, play(a)),
      rule({ type: 'boolean', inputId: done.id, value: false }, play(a, 'reverse')),
    );
  });
  const allDone = text(c, 'All done', 'All done!', { x: 540, y: 880, size: 54, color: '#34d399', opacity: 0 });
  const cheer = anim('Celebrate', 0.5, 'once', [tr(allDone, 'opacity', [k(0, 0), k(0.3, 1)]), tr(allDone, 'transform.scale', [k(0, 0.6, 'backOut'), k(0.5, 1)])]);
  anims.push(cheer);
  // "All done" appears only when every box is ticked: each box's rule checks the other two.
  inputs.forEach((inp, i) => {
    const others = inputs.filter((_, j) => j !== i).map((o): Condition => ({ type: 'boolean', inputId: o.id, value: true }));
    rules.push(ruleIf({ type: 'boolean', inputId: inp.id, value: true }, others, play(cheer)));
    rules.push(rule({ type: 'boolean', inputId: inp.id, value: false }, play(cheer, 'reverse')));
  });
  return doc(c, { name: 'Checklist', description: 'Three checkboxes; “only if” conditions celebrate when all are ticked.', tags: ['toggle', 'conditions', 'ui'] }, '#121420', { inputs, animations: anims, bindings: [], rules });
}

function curiousBuddy(): SceneDocument {
  const c = ctxOf(1080, 1080);
  const W = 1080;
  shape(c, 'Backdrop', 'rect', { x: 540, y: 540, w: 1080, h: 1080, color: '#fef3c7', color2: '#fbcfe8', fill: 'linear', angle: 90 });
  const shadow = shape(c, 'Shadow', 'ellipse', { x: 540, y: 905, w: 440, h: 64, color: '#7c2d12', opacity: 0.16 });
  const g = group(c, 'Buddy', 540, 540);
  const P = (x: number, y: number) => inGroup(c, 540, 540, x, y);
  const earL = shape(c, 'Left ear', 'ellipse', { ...P(385, 350), w: 120, h: 210, color: '#7c3aed', rotation: -22, parent: g.id });
  const earR = shape(c, 'Right ear', 'ellipse', { ...P(695, 350), w: 120, h: 210, color: '#7c3aed', rotation: 22, parent: g.id });
  const stalk = shape(c, 'Antenna', 'rect', { ...P(540, 290), w: 12, h: 110, radius: 6, color: '#6d28d9', parent: g.id });
  const bulb = shape(c, 'Antenna light', 'ellipse', { ...P(540, 228), w: 52, h: 52, color: '#fde68a', color2: '#f59e0b', fill: 'radial', parent: g.id });
  const body = shape(c, 'Body', 'ellipse', { ...P(540, 600), w: 540, h: 540, color: '#a78bfa', color2: '#6d28d9', fill: 'radial', parent: g.id });
  const belly = shape(c, 'Belly', 'ellipse', { ...P(540, 772), w: 290, h: 190, color: '#ddd6fe', opacity: 0.85, parent: g.id });
  const eyes = [455, 625].map((x, i) => {
    const side = i ? 'right' : 'left';
    return {
      white: shape(c, `Eye ${side}`, 'ellipse', { ...P(x, 520), w: 150, h: 172, color: '#ffffff', parent: g.id }),
      pupil: shape(c, `Pupil ${side}`, 'ellipse', { ...P(x, 530), w: 72, h: 82, color: '#1e1b4b', parent: g.id }),
      shine: shape(c, `Shine ${side}`, 'ellipse', { ...P(x + 16, 506), w: 22, h: 22, color: '#ffffff', parent: g.id }),
    };
  });
  const cheeks = [395, 685].map((x, i) => shape(c, `Cheek ${i ? 'right' : 'left'}`, 'ellipse', { ...P(x, 632), w: 76, h: 42, color: '#f472b6', opacity: 0.55, parent: g.id }));
  const mouth = shape(c, 'Mouth', 'rect', { ...P(540, 648), w: 92, h: 26, radius: 13, color: '#1e1b4b', parent: g.id });
  text(c, 'Hint', 'Move your pointer · click me', { x: 540, y: 1000, size: 34, color: '#9a3412', weight: 500 });

  const lookX = { ...input('Look X', 'number', 50, 0, 100), follow: 'pointerX' as const, smoothing: 0.72 };
  const lookY = { ...input('Look Y', 'number', 50, 0, 100), follow: 'pointerY' as const, smoothing: 0.72 };
  const happy = input('Happy', 'trigger', false);
  // Each part shifts by a different amount, so the face reads as round: pupils most, the head least.
  const shift = (i: Input, l: Layer, path: string, px: number): Binding => ({ ...bind(i, l, path, [0, 100], [-px / (path === 'transform.x' ? W : path === 'transform.y' ? W : 1), px / (path === 'transform.x' ? W : path === 'transform.y' ? W : 1)]), relative: true });
  const bindings: Binding[] = [
    ...eyes.flatMap((e) => [shift(lookX, e.pupil, 'transform.x', 40), shift(lookY, e.pupil, 'transform.y', 32), shift(lookX, e.shine, 'transform.x', 36), shift(lookY, e.shine, 'transform.y', 28), shift(lookX, e.white, 'transform.x', 14), shift(lookY, e.white, 'transform.y', 10)]),
    ...cheeks.flatMap((ch) => [shift(lookX, ch, 'transform.x', 20), shift(lookY, ch, 'transform.y', 10)]),
    shift(lookX, mouth, 'transform.x', 20), shift(lookY, mouth, 'transform.y', 12),
    shift(lookX, belly, 'transform.x', 8),
    shift(lookX, stalk, 'transform.rotation', 10), shift(lookX, bulb, 'transform.x', 22), shift(lookY, bulb, 'transform.y', 6),
    shift(lookX, earL, 'transform.rotation', 8), shift(lookX, earR, 'transform.rotation', 8),
    shift(lookX, g, 'transform.rotation', 3),
  ];
  const B = 4;
  const blink = anim('Blink', B, 'loop', eyes.flatMap((e) => [
    tr(e.white, 'props.height', [k(3.55, 172, 'easeIn'), k(3.66, 14, 'easeOut'), k(3.8, 172)]),
    tr(e.pupil, 'props.height', [k(3.55, 82, 'easeIn'), k(3.66, 8, 'easeOut'), k(3.8, 82)]),
    tr(e.shine, 'opacity', [k(3.55, 1, 'step'), k(3.66, 0, 'step'), k(3.78, 1)]),
  ]));
  const jump = anim('Happy jump', 0.9, 'once', [
    tr(g, 'transform.y', [k(0, 0.5, 'easeOut'), k(0.3, 0.5 - 90 / W, 'easeIn'), k(0.55, 0.5, 'backOut'), k(0.9, 0.5)]),
    tr(g, 'transform.scale', [k(0, 1), k(0.08, 0.94, 'backOut'), k(0.3, 1.04, 'easeIn'), k(0.58, 0.96, 'backOut'), k(0.9, 1)]),
    tr(shadow, 'props.width', [k(0, 440, 'easeOut'), k(0.3, 300, 'easeIn'), k(0.55, 460), k(0.9, 440)]),
    tr(mouth, 'props.width', [k(0, 92, 'backOut'), k(0.15, 150), k(0.7, 150, 'easeInOut'), k(0.9, 92)]),
    tr(mouth, 'props.height', [k(0, 26, 'backOut'), k(0.15, 64), k(0.7, 64, 'easeInOut'), k(0.9, 26)]),
    tr(mouth, 'props.radius', [k(0, 13), k(0.15, 32), k(0.7, 32), k(0.9, 13)]),
    ...cheeks.map((ch) => tr(ch, 'opacity', [k(0, 0.55), k(0.15, 1), k(0.7, 1), k(0.9, 0.55)])),
    tr(bulb, 'props.fill.color', [k(0, '#fde68a'), k(0.15, '#ffffff'), k(0.9, '#fde68a')]),
  ]);
  const perk = anim('Ears perk', 0.35, 'once', [
    tr(earL, 'transform.rotation', [k(0, -22, 'backOut'), k(0.35, -8)]),
    tr(earR, 'transform.rotation', [k(0, 22, 'backOut'), k(0.35, 8)]),
    tr(bulb, 'transform.scale', [k(0, 1, 'backOut'), k(0.35, 1.25)]),
  ]);
  return doc(c, { name: 'Curious buddy', description: 'A character that looks wherever your pointer goes, blinks, and jumps when clicked.', tags: ['character', 'follow', 'pointer', 'starter'] }, '#fef3c7', {
    inputs: [lookX, lookY, happy], animations: [blink, jump, perk], bindings,
    rules: [
      rule({ type: 'start' }, play(blink, 'forward', 'start')),
      rule(click(body), { type: 'fire', inputId: happy.id }),
      rule({ type: 'trigger', inputId: happy.id }, play(jump, 'forward', 'start')),
      rule({ type: 'pointer', event: 'enter', layerId: body.id }, play(perk)),
      rule({ type: 'pointer', event: 'leave', layerId: body.id }, play(perk, 'reverse')),
    ],
  });
}

export const MOTION_PRESETS: MotionPreset[] = [
  { key: 'curious-buddy', name: 'Curious buddy', description: 'A character that looks wherever your pointer goes, blinks, and jumps when clicked.', tip: 'Move your pointer around — anywhere on the page. Hover and click the buddy.', tags: ['character', 'follow', 'pointer', 'starter'], build: curiousBuddy },
  { key: 'toggle-switch', name: 'Toggle switch', description: 'An on/off switch driven by a toggle control.', tip: 'Click the switch, or flip “On” in the controls.', tags: ['toggle', 'ui', 'starter'], build: toggleSwitch },
  { key: 'favourite', name: 'Favourite button', description: 'A star that bursts when you like it.', tip: 'Tap the star. “Liked” remembers the state.', tags: ['button', 'toggle', 'ui', 'starter'], build: favourite },
  { key: 'press-button', name: 'Press button', description: 'Squishes while held and sends a ripple when clicked.', tip: 'Press and hold the button, then let go.', tags: ['button', 'trigger', 'ui', 'starter'], build: pressButton },
  { key: 'progress', name: 'Progress loader', description: 'A slider fills the bar; reaching 100 shows “done”.', tip: 'Drag “Progress” all the way to 100.', tags: ['slider', 'loader', 'ui', 'starter'], build: progress },
  { key: 'traffic-light', name: 'Traffic light', description: 'A number control picks which light is on; a button steps through them.', tip: 'Tap the light, or press “Next”.', tags: ['number', 'conditions', 'starter'], build: trafficLight },
  { key: 'checklist', name: 'Checklist', description: 'Three checkboxes; “only if” conditions celebrate when all are ticked.', tip: 'Tick all three boxes.', tags: ['toggle', 'conditions', 'ui'], build: checkbox },
  { key: 'day-night', name: 'Day & night', description: 'One toggle turns day into night.', tip: 'Tap the sky, or flip “Night”.', tags: ['toggle', 'scene', 'illustration'], build: dayNight },
  { key: 'hover-card', name: 'Hover card', description: 'A card that lifts and glows when the pointer is over it.', tip: 'Move your pointer over the card.', tags: ['hover', 'card', 'ui'], build: hoverCard },
  { key: 'bell', name: 'Notification bell', description: 'A button (trigger) rings the bell and sets an unread badge.', tip: 'Tap the bell, then tap the red badge.', tags: ['trigger', 'icon', 'ui'], build: bell },
  { key: 'bouncing-ball', name: 'Bouncing ball', description: 'A looping move with squash and stretch, switched by a toggle.', tip: 'Click the ball to pause it.', tags: ['loop', 'character', 'starter'], build: bouncingBall },
  { key: 'aurora-mood', name: 'Aurora mood', description: 'A slider sets how lively the aurora is; a toggle shifts it to dusk.', tip: 'Drag “Energy” and flip “Dusk”.', tags: ['slider', 'background', 'effects'], build: auroraMood },
];
