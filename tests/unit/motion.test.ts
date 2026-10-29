import { describe, it, expect } from 'vitest';
import { MotionRuntime, docForAnimation, previewDoc } from '../../shared/motion/runtime';
import { MOVES, buildMove, mergeIntoAnimation } from '../../shared/motion/moves';
import { LIBRARY_CATEGORIES, MOTION_PRESETS, categoryTag } from '../../shared/motion/presets';
import { getIn } from '../../shared/util/paths';
import { resolveHierarchy } from '../../src/engine/renderer';
import { createLayer, createScene } from '../../shared/scene/defaults';
import { deserializeScene, serializeScene } from '../../shared/scene/serialize';
import type { Animation, SceneDocument } from '../../shared/scene/schema';
import { safeFetch, setFetchImpl } from '../../server/services/safeFetch';
import { parseFigmaLink } from '../../server/services/figma';

/** A tiny file: one box, a toggle "On", a button "Ping", a slider "Level" and three moves. */
function sample() {
  const d = createScene();
  const box = createLayer('shape', { id: 'box', name: 'Box' });
  d.layers = [box];
  const k = (t: number, value: number | string) => ({ id: `k${String(t).replace('.', '_')}${String(value).replace(/\W/g, '')}`, t, value, easing: 'linear' as const });
  const grow: Animation = { id: 'grow', name: 'Grow', duration: 1, loop: 'once', tracks: [{ id: 't1', layerId: 'box', path: 'props.width', keyframes: [k(0, 100), k(1, 300)] }] };
  const spin: Animation = { id: 'spin', name: 'Spin', duration: 2, loop: 'loop', tracks: [{ id: 't2', layerId: 'box', path: 'transform.rotation', keyframes: [k(0, 0), k(2, 360)] }] };
  const tint: Animation = { id: 'tint', name: 'Tint', duration: 0.5, loop: 'once', tracks: [{ id: 't3', layerId: 'box', path: 'props.fill.color', keyframes: [k(0, '#000000'), k(0.5, '#ffffff')] }] };
  d.machine = {
    inputs: [{ id: 'on', name: 'On', type: 'boolean', default: false }, { id: 'ping', name: 'Ping', type: 'trigger', default: false }, { id: 'lvl', name: 'Level', type: 'number', default: 0, min: 0, max: 100 }],
    animations: [grow, spin, tint],
    rules: [
      { id: 'r1', when: { type: 'boolean', inputId: 'on', value: true }, only: [], do: [{ type: 'play', animationId: 'grow', direction: 'forward', from: 'current' }] },
      { id: 'r2', when: { type: 'boolean', inputId: 'on', value: false }, only: [], do: [{ type: 'play', animationId: 'grow', direction: 'reverse', from: 'current' }] },
      { id: 'r3', when: { type: 'trigger', inputId: 'ping' }, only: [{ type: 'boolean', inputId: 'on', value: true }], do: [{ type: 'play', animationId: 'tint', direction: 'forward', from: 'start' }] },
      { id: 'r4', when: { type: 'number', inputId: 'lvl', op: '>=', value: 50 }, only: [], do: [{ type: 'play', animationId: 'spin', direction: 'forward', from: 'start' }] },
      { id: 'r5', when: { type: 'number', inputId: 'lvl', op: '<', value: 50 }, only: [], do: [{ type: 'stop', animationId: 'spin' }] },
      { id: 'r6', when: { type: 'pointer', event: 'click', layerId: 'box' }, only: [], do: [{ type: 'setBoolean', inputId: 'on', value: 'toggle' }] },
      { id: 'r7', when: { type: 'finished', animationId: 'tint' }, only: [], do: [{ type: 'fire', inputId: 'ping' }, { type: 'setNumber', inputId: 'lvl', mode: 'add', value: 10 }] },
    ],
    bindings: [{ id: 'b1', inputId: 'lvl', layerId: 'box', path: 'opacity', from: [0, 100], to: [0.2, 1] }],
  };
  return deserializeScene(d);
}
const box = (rt: MotionRuntime) => rt.layers().find((l) => l.id === 'box') as any;
const run = (rt: MotionRuntime, seconds: number) => { for (let t = 0; t < seconds; t += 0.05) rt.step(0.05); };

describe('interaction runtime', () => {
  it('a toggle plays a move forwards and backwards from where it is', () => {
    const rt = new MotionRuntime(sample());
    expect(box(rt).props.width).toBe(240); // the design itself before anything plays
    rt.setBoolean('on', true);
    run(rt, 1.2);
    expect(box(rt).props.width).toBeCloseTo(300);
    rt.setBoolean('on', false);
    run(rt, 0.5);
    expect(box(rt).props.width).toBeGreaterThan(100);
    expect(box(rt).props.width).toBeLessThan(300);
    run(rt, 1);
    expect(box(rt).props.width).toBeCloseTo(100);
  });
  it('a button only works when its “only if” condition holds, and “finished” rules chain', () => {
    const rt = new MotionRuntime(sample());
    rt.fire('ping');
    run(rt, 1);
    expect(rt.isPlaying('tint')).toBe(false);
    expect(box(rt).props.fill.color).toBe('#6b8cff');
    rt.setBoolean('on', true);
    rt.fire('ping');
    run(rt, 0.3);
    expect(box(rt).props.fill.color).not.toBe('#000000');
    run(rt, 0.5); // tint finishes → fires Ping again (still on) and adds 10 to Level
    expect(rt.values.lvl).toBeGreaterThanOrEqual(10);
  });
  it('number rules fire when a threshold is crossed, not on every change', () => {
    const rt = new MotionRuntime(sample());
    rt.setNumber('lvl', 40);
    expect(rt.isPlaying('spin')).toBe(false);
    rt.setNumber('lvl', 60);
    expect(rt.isPlaying('spin')).toBe(true);
    run(rt, 0.5);
    const r = box(rt).transform.rotation;
    rt.setNumber('lvl', 70); // still above: no restart
    run(rt, 0.05);
    expect(box(rt).transform.rotation).toBeGreaterThan(r);
    rt.setNumber('lvl', 10);
    expect(rt.isPlaying('spin')).toBe(false);
    expect(box(rt).transform.rotation).toBe(0);
  });
  it('slider links map and clamp, and sliders respect their range', () => {
    const rt = new MotionRuntime(sample());
    rt.setNumber('lvl', 50);
    expect(box(rt).opacity).toBeCloseTo(0.6);
    rt.setNumber('lvl', 500);
    expect(rt.values.lvl).toBe(100);
    expect(box(rt).opacity).toBeCloseTo(1);
  });
  it('pointer events reach the rules for that layer', () => {
    const rt = new MotionRuntime(sample());
    expect(rt.pointerLayers.has('box')).toBe(true);
    rt.pointer('click', 'box');
    expect(rt.values.on).toBe(true);
    rt.pointer('click', 'other');
    expect(rt.values.on).toBe(true);
  });
  it('starts in the right resting state and reset returns there', () => {
    const d = sample();
    d.machine.inputs[0] = { ...d.machine.inputs[0], default: true };
    const rt = new MotionRuntime(d);
    expect(box(rt).props.width).toBeCloseTo(300); // settled instantly, no animation at load
    rt.setBoolean('on', false);
    run(rt, 2);
    rt.reset();
    expect(rt.values.on).toBe(true);
    expect(box(rt).props.width).toBeCloseTo(300);
  });
  it('playing backwards a move that never played does nothing', () => {
    const rt = new MotionRuntime(sample());
    rt.setBoolean('on', true);
    rt.setBoolean('on', false);
    rt.reset();
    rt.values.on = true; // force the "off" edge without a prior forward play
    rt.setBoolean('on', false);
    run(rt, 0.2);
    expect(box(rt).props.width).toBe(240);
  });
  it('exports a move as a plain timeline', () => {
    const d = sample();
    const one = docForAnimation(d, 'spin');
    expect(one.canvas.duration).toBe(2);
    expect(one.canvas.loop).toBe(true);
    expect(one.tracks).toHaveLength(1);
    expect(() => serializeScene(one)).not.toThrow();
  });
});

describe('moves and presets', () => {
  it('every one-click move builds valid keyframes for every layer type', () => {
    const d = createScene();
    for (const type of ['shape', 'text', 'image', 'gradient', 'particles'] as const) {
      const l = createLayer(type);
      d.layers = [l];
      for (const m of MOVES) {
        const built = buildMove(m.key, l, d, { color: '#ff0000' });
        const anim = mergeIntoAnimation({ id: 'a', name: 'A', duration: 0.1, loop: built.loop, tracks: [] }, built, 0);
        const doc = { ...d, machine: { inputs: [], animations: [anim], rules: [], bindings: [] } };
        expect(() => deserializeScene(JSON.parse(JSON.stringify(doc)))).not.toThrow();
        expect(anim.duration).toBeGreaterThanOrEqual(built.duration);
      }
    }
  });
  it('merging a move replaces keys in its time range and keeps the rest', () => {
    const d = createScene();
    const l = createLayer('shape');
    d.layers = [l];
    const a1 = mergeIntoAnimation({ id: 'a', name: 'A', duration: 1, loop: 'once', tracks: [] }, buildMove('pulse', l, d), 0);
    const a2 = mergeIntoAnimation(a1, buildMove('pulse', l, d), 2);
    expect(a2.tracks).toHaveLength(1);
    expect(a2.tracks[0].keyframes.length).toBe(6);
    expect(a2.duration).toBeCloseTo(3.2);
  });
  it('every library component is a valid, interactive, categorised file that round-trips', () => {
    expect(MOTION_PRESETS.length).toBeGreaterThanOrEqual(1);
    for (const p of MOTION_PRESETS) {
      const doc = p.build();
      const back = deserializeScene(serializeScene(doc));
      expect(back).toEqual(doc);
      expect(LIBRARY_CATEGORIES).toContain(p.category);
      expect(back.meta.tags).toContain(categoryTag(p.category));
      expect(back.machine.rules.length + back.machine.bindings.length).toBeGreaterThan(0);
      expect(back.machine.animations.every((a) => a.note && a.note.length > 20)).toBe(true); // every move explains itself
      const rt = new MotionRuntime(back);
      for (let i = 0; i < 40; i++) rt.step(0.05);
      expect(rt.layers()).toHaveLength(back.layers.length);
      expect(previewDoc(back).tracks.every((t) => back.layers.some((l) => l.id === t.layerId))).toBe(true);
    }
  });

  describe('the living button', () => {
    const doc = MOTION_PRESETS.find((p) => p.key === 'living-button')!.build();
    const id = (name: string) => doc.machine.inputs.find((i) => i.name === name)!.id;
    const cap = (rt: MotionRuntime) => rt.layers().find((l) => l.name === 'Cap')!.transform;
    const run = (rt: MotionRuntime, s: number) => { for (let t = 0; t < s; t += 0.01) rt.step(0.01); };
    const touch = doc.layers.find((l) => l.name === 'Touch area')!;

    it('lifts on hover, squashes into its base when pressed, and springs past its height on release', () => {
      const rt = new MotionRuntime(doc);
      const rest = cap(rt).y;
      rt.pointer('enter', touch.id); run(rt, 0.6);
      const hovered = cap(rt).y;
      expect((rest - hovered) * 1080).toBeCloseTo(12, 0);
      rt.pointer('down', touch.id); run(rt, 0.3);
      expect(cap(rt).y).toBeGreaterThan(rest); // pushed down into the base
      expect(cap(rt).scaleY).toBeLessThan(0.9);
      expect(cap(rt).scaleX).toBeGreaterThan(1); // wider while squashed: it keeps its volume
      rt.pointer('up', touch.id); run(rt, 0.14);
      expect(cap(rt).y).toBeLessThan(hovered); // overshoots…
      run(rt, 1);
      expect(cap(rt).y).toBeCloseTo(hovered, 4); // …then settles at the hover height
      rt.pointer('leave', touch.id); run(rt, 1);
      expect(cap(rt).y).toBeCloseTo(rest, 4);
      expect(cap(rt).scaleY).toBeCloseTo(1, 4);
    });
    it('leaving while held releases it; on touch screens (no hover) it goes straight back to rest', () => {
      const rt = new MotionRuntime(doc);
      const rest = cap(rt).y;
      rt.pointer('enter', touch.id); rt.pointer('down', touch.id); run(rt, 0.3);
      rt.pointer('leave', touch.id);
      expect(rt.values[id('Held')]).toBe(false);
      run(rt, 1.2);
      expect(cap(rt).y).toBeCloseTo(rest, 4);
      rt.pointer('down', touch.id); run(rt, 0.3); rt.pointer('up', touch.id); run(rt, 1.2);
      expect(cap(rt).y).toBeCloseTo(rest, 4);
    });
    it('never has two states fighting over the idle loop', () => {
      const keys = (name: string) => new Set(doc.machine.animations.find((a) => a.name === name)!.tracks.map((t) => `${t.layerId}|${t.path}`));
      const idle = keys('Idle');
      for (const name of ['Hover', 'Unhover', 'Press', 'Release']) for (const k of keys(name)) expect(idle.has(k)).toBe(false);
    });
    it('its Customise settings each change real properties of the right type', () => {
      expect(doc.exposed.map((p) => p.label)).toEqual(['Button colour', 'Ink colour', 'Sparkle colour', 'Cheek colour', 'Shine colour', 'Label']);
      for (const p of doc.exposed) for (const t of p.targets) {
        const v = getIn(doc.layers.find((l) => l.id === t.layerId)!, t.path);
        expect(typeof v).toBe('string');
        if (p.type === 'color') expect(v).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });
  });

  it('squash and stretch on a group spreads and stretches its children along its own axes', () => {
    const g = createLayer('group', { id: 'g', transform: { x: 0.5, y: 0.5, scaleY: 0.5, scaleX: 2 } });
    const child = createLayer('shape', { id: 'c', parentId: 'g', transform: { x: 0.6, y: 0.7 } });
    const out = resolveHierarchy([g, child]).find((l) => l.id === 'c')!.transform;
    expect(out.x).toBeCloseTo(0.7); // 0.1 right of the pivot, doubled
    expect(out.y).toBeCloseTo(0.6); // 0.2 below the pivot, halved
    expect(out).toMatchObject({ scaleX: 2, scaleY: 0.5 });
  });
  it('a circle turned inside a squashed group stays squashed along the group, not along itself', () => {
    const g = createLayer('group', { id: 'g', transform: { x: 0.5, y: 0.5, scaleY: 0.3 } });
    for (const deg of [0, 45, 90, 135]) {
      const c = createLayer('shape', { id: 'c', parentId: 'g', transform: { x: 0.5, y: 0.5, rotation: deg } });
      c.props = { ...c.props, kind: 'ellipse', width: 100, height: 100 };
      const t = resolveHierarchy([g, c]).find((l) => l.id === 'c')!.transform;
      // The drawn ellipse's horizontal and vertical radii (for a unit circle) must be 1 and 0.3.
      const r = (t.rotation * Math.PI) / 180;
      const horiz = Math.hypot(Math.cos(r) * t.scaleX, Math.sin(r) * t.scaleY), vert = Math.hypot(Math.sin(r) * t.scaleX, Math.cos(r) * t.scaleY);
      expect(Math.max(horiz, vert)).toBeCloseTo(1, 5);
      expect(Math.min(horiz, vert)).toBeCloseTo(0.3, 5);
      expect(horiz).toBeGreaterThan(vert);
    }
    // A thin line turned inside a slightly stretched group keeps pointing the same way.
    const g2 = createLayer('group', { id: 'g', transform: { x: 0.5, y: 0.5, scaleX: 1.02, scaleY: 0.98 } });
    const line = createLayer('shape', { id: 'c', parentId: 'g', transform: { x: 0.5, y: 0.5, rotation: 200 } });
    expect(Math.abs(resolveHierarchy([g2, line]).find((l) => l.id === 'c')!.transform.rotation - 200)).toBeLessThan(2); // a stretch tilts a slanted line only slightly
  });
  it('old files without stretch values still load, at 100%', () => {
    const d = createScene();
    const l: any = createLayer('shape');
    delete l.transform.scaleX; delete l.transform.scaleY;
    d.layers = [l];
    expect(deserializeScene(JSON.parse(JSON.stringify(d))).layers[0].transform).toMatchObject({ scaleX: 1, scaleY: 1 });
  });
  it('“play a sound” reaches the player as an event, but not while settling the starting state', () => {
    const d = createScene();
    const box = createLayer('shape', { id: 'box' });
    const on = { id: 'on', name: 'On', type: 'boolean' as const, default: true };
    d.layers = [box];
    d.machine = { inputs: [on], animations: [], bindings: [], rules: [
      { id: 'r1', when: { type: 'boolean', inputId: 'on', value: true }, only: [], do: [{ type: 'sound', sound: 'chime', assetId: null, volume: 0.4 }] },
      { id: 'r2', when: { type: 'pointer', event: 'click', layerId: 'box' }, only: [], do: [{ type: 'sound', sound: 'pop', assetId: null, volume: 0.7 }] },
    ] };
    const back = deserializeScene(JSON.parse(JSON.stringify(d)));
    const heard: { id: string; volume?: number }[] = [];
    const rt = new MotionRuntime(back);
    rt.on((e) => { if (e.kind === 'sound') heard.push({ id: e.id, volume: e.volume }); });
    rt.reset(); // "On" starts true: settling must stay silent
    expect(heard).toEqual([]);
    rt.pointer('click', 'box');
    expect(heard).toEqual([{ id: 'pop', volume: 0.7 }]);
    const bad = { ...d, machine: { ...d.machine, rules: [{ ...d.machine.rules[1], do: [{ type: 'sound', sound: null, assetId: null, volume: 1 }] }] } };
    expect(() => deserializeScene(bad)).toThrow(/built-in sound or an uploaded file/);
  });
  it('a drag slider follows only while its layer is held, then springs home with an overshoot', () => {
    const d = createScene();
    const blob = createLayer('shape', { id: 'blob' });
    d.layers = [blob];
    d.machine = { inputs: [{ id: 'dx', name: 'Drag X', type: 'number', default: 0, min: -1, max: 1, follow: 'pointerX', smoothing: 0.4, dragLayer: 'blob', bounce: 0.6 }], animations: [], rules: [], bindings: [] };
    const rt = new MotionRuntime(deserializeScene(JSON.parse(JSON.stringify(d))));
    expect(rt.pointerLayers.has('blob')).toBe(true);
    rt.pointerMove(1, 0.5);
    for (let i = 0; i < 60; i++) rt.step(1 / 60);
    expect(rt.values.dx).toBe(0); // not held: ignores the pointer
    rt.pointer('down', 'blob');
    for (let i = 0; i < 90; i++) rt.step(1 / 60);
    expect(rt.values.dx).toBeCloseTo(1, 2);
    rt.pointer('up', 'blob');
    let lowest = 1;
    for (let i = 0; i < 180; i++) { rt.step(1 / 60); lowest = Math.min(lowest, Number(rt.values.dx)); }
    expect(lowest).toBeLessThan(-0.05); // overshot past home
    expect(rt.values.dx).toBeCloseTo(0, 3); // and settled
  });
  it('rejects rules that point at missing layers, controls or moves', () => {
    const d = sample() as SceneDocument;
    const bad = { ...d, machine: { ...d.machine, rules: [...d.machine.rules, { id: 'x', when: { type: 'trigger', inputId: 'nope' }, only: [], do: [{ type: 'stop', animationId: 'grow' }] }] } };
    expect(() => deserializeScene(bad)).toThrow(/missing control/);
  });
  it('migrates v2 files to v3 with an empty interaction model', () => {
    const v2 = { ...createScene(), schemaVersion: 2 } as any;
    delete v2.machine;
    expect(deserializeScene(v2).machine).toEqual({ inputs: [], animations: [], rules: [], bindings: [] });
  });
});

describe('outbound safety and link parsing', () => {
  it('blocks private and non-http destinations', async () => {
    await expect(safeFetch('http://127.0.0.1:8787/api/session')).rejects.toThrow(/private/);
    await expect(safeFetch('http://localhost/')).rejects.toThrow(/private/);
    await expect(safeFetch('http://[::1]/')).rejects.toThrow(/private/);
    await expect(safeFetch('http://10.0.0.5/')).rejects.toThrow(/private/);
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/http/);
  });
  it('re-checks every redirect hop', async () => {
    setFetchImpl(async (url) => (url.startsWith('https://public.example') ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }) : new Response('secret')));
    try { await expect(safeFetch('https://public.example/')).rejects.toThrow(); } finally { setFetchImpl((u, i) => fetch(u, i)); }
  });
  it('parses Figma links', () => {
    expect(parseFigmaLink('https://www.figma.com/design/AbCdEfGhIjKl/Poster?node-id=12-34')).toEqual({ fileKey: 'AbCdEfGhIjKl', nodeId: '12:34' });
    expect(() => parseFigmaLink('https://evil.com/design/AbCdEfGhIjKl')).toThrow();
  });
});
