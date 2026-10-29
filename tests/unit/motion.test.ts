import { describe, it, expect } from 'vitest';
import { MotionRuntime, docForAnimation, previewDoc } from '../../shared/motion/runtime';
import { MOVES, buildMove, mergeIntoAnimation } from '../../shared/motion/moves';
import { MOTION_PRESETS } from '../../shared/motion/presets';
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
  it('every preset is a valid, interactive file that round-trips', () => {
    expect(MOTION_PRESETS.length).toBeGreaterThanOrEqual(10);
    for (const p of MOTION_PRESETS) {
      const doc = p.build();
      const back = deserializeScene(serializeScene(doc));
      expect(back.machine.rules.length + back.machine.bindings.length).toBeGreaterThan(0);
      const rt = new MotionRuntime(back);
      for (let i = 0; i < 40; i++) rt.step(0.05);
      expect(rt.layers()).toHaveLength(back.layers.length);
      expect(previewDoc(back).tracks.every((t) => back.layers.some((l) => l.id === t.layerId))).toBe(true);
    }
  });
  it('the curious buddy looks toward the pointer, eases there, and looks back when it leaves', () => {
    const doc = MOTION_PRESETS.find((p) => p.key === 'curious-buddy')!.build();
    const rt = new MotionRuntime(doc);
    expect(rt.follows).toBe(true);
    const pupil = () => rt.layers().find((l) => l.name === 'Pupil left')!.transform;
    const white = () => rt.layers().find((l) => l.name === 'Eye left')!.transform;
    const rest = { ...pupil() };
    rt.pointerMove(1.4, -0.3); // off the canvas, up and to the right: clamps to the edge
    rt.step(0.016);
    const early = pupil().x - rest.x;
    for (let i = 0; i < 90; i++) rt.step(0.016);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(pupil().x - rest.x); // eased, not snapped
    expect((pupil().x - rest.x) * 1080).toBeCloseTo(40, 0); // full 40px shift right
    expect((pupil().y - rest.y) * 1080).toBeCloseTo(-32, 0); // and up
    expect(pupil().x - rest.x).toBeGreaterThan(white().x - doc.layers.find((l) => l.name === 'Eye left')!.transform.x); // pupils move more than the eye
    expect(rt.log.some((e) => e.text.includes('Look'))).toBe(false); // following is silent
    rt.pointerAway();
    for (let i = 0; i < 120; i++) rt.step(0.016);
    expect(pupil().x).toBeCloseTo(rest.x, 3);
  });
  it('the traffic light cycles through its lights with the Next button', () => {
    const doc = MOTION_PRESETS.find((p) => p.key === 'traffic-light')!.build();
    const rt = new MotionRuntime(doc);
    const step = doc.machine.inputs.find((i) => i.name === 'Step')!, next = doc.machine.inputs.find((i) => i.name === 'Next')!;
    const seen = [];
    for (let i = 0; i < 4; i++) { rt.fire(next.id); seen.push(rt.values[step.id]); }
    expect(seen).toEqual([1, 2, 0, 1]);
  });
  it('the checklist only celebrates when every box is ticked', () => {
    const doc = MOTION_PRESETS.find((p) => p.key === 'checklist')!.build();
    const rt = new MotionRuntime(doc);
    const cheer = doc.machine.animations.find((a) => a.name === 'Celebrate')!;
    const [a, b, c] = doc.machine.inputs;
    rt.setBoolean(a.id, true); rt.setBoolean(b.id, true);
    expect(rt.isPlaying(cheer.id)).toBe(false);
    rt.setBoolean(c.id, true);
    expect(rt.isPlaying(cheer.id)).toBe(true);
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
