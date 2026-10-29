import type { Layer, SceneDocument } from '../../scene/schema';
import { Rig, after, anim, finish, follower, link, onPointer, param, play, playBack, playOn, rule, sound, tr, type Key } from './rig';

/**
 * 02 · The wandering creature. A long, winding noodle of a creature built from overlapping
 * segments (each its own group, so it can breathe and bounce on its own), with geometric spikes and
 * spots, two antennae and eyes that follow the pointer. Clicking sends a wave down its body: the head
 * reacts first, the body follows segment by segment, and the spikes settle last.
 */
export function wanderingCreature(): SceneDocument {
  const r = new Rig(1080, 1080);
  const INK = '#1d1b2c', TEAL = '#2a7c76', MUSTARD = '#f2b134', CORAL = '#ee6c5a', CREAM = '#fff8ea';

  const touch = r.shape('Touch area', 'rect', { x: 500, y: 580 }, { w: 820, h: 660, color: TEAL, fill: 'none', locked: true });
  r.shape('Ground shadow', 'ellipse', { x: 470, y: 906 }, { w: 720, h: 42, color: INK, opacity: 0.1 });

  // Body: segments along a winding path — the tail trails along the ground, then the body rears up
  // into the neck. Catmull-Rom through hand-placed points, sampled evenly along its length.
  const N = 11;
  const P = [[150, 800], [270, 850], [420, 852], [560, 800], [660, 700], [700, 575], [706, 470]];
  const cr = (t: number) => {
    const seg = Math.min(P.length - 2, Math.floor(t * (P.length - 1))), u = t * (P.length - 1) - seg;
    const p0 = P[Math.max(0, seg - 1)], p1 = P[seg], p2 = P[seg + 1], p3 = P[Math.min(P.length - 1, seg + 2)];
    const f = (i: number) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * u + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u * u + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u * u * u);
    return { x: f(0), y: f(1) };
  };
  const samples = Array.from({ length: 400 }, (_, i) => cr(i / 399));
  const lens = samples.reduce<number[]>((acc, p, i) => [...acc, i ? acc[i - 1] + Math.hypot(p.x - samples[i - 1].x, p.y - samples[i - 1].y) : 0], []);
  const at = (s: number) => samples[Math.max(0, lens.findIndex((l) => l >= s * lens[lens.length - 1]))];
  const BELLY = '#3d9b92';
  const segs = Array.from({ length: N }, (_, i) => {
    const s = i / (N - 1);
    const p = at(s), q = at(Math.min(1, s + 0.02)), o = at(Math.max(0, s - 0.02));
    const d = 84 + 86 * s ** 0.9;
    const tangent = (Math.atan2(q.y - o.y, q.x - o.x) * 180) / Math.PI;
    const g = r.group(`Segment ${N - i}`, p);
    // Little feet on the segments that touch the ground.
    const foot = p.y > 760 && i % 2 === 0 ? r.shape(`Foot ${N - i}`, 'ellipse', { x: p.x + 6, y: p.y + d / 2 - 1 }, { w: 30, h: 22, color: INK, parent: g }) : null;
    const body = r.shape(`Body ${N - i}`, 'ellipse', p, { w: d, h: d * 0.94, color: TEAL, stroke: INK, strokeW: 9, parent: g });
    // A lighter belly tone on the side facing forward gives the segment roundness.
    const n2 = ((tangent + 90) * Math.PI) / 180;
    r.shape(`Belly ${N - i}`, 'ellipse', { x: p.x + Math.cos(n2) * d * 0.17, y: p.y + Math.sin(n2) * d * 0.17 }, { w: d * 0.68, h: d * 0.42, color: BELLY, rotation: tangent, parent: g });
    const spot = r.shape(`Spot ${N - i}`, 'ellipse', { x: p.x - Math.cos(n2) * d * 0.12, y: p.y - Math.sin(n2) * d * 0.12 }, { w: d * 0.26, h: d * 0.22, color: i % 3 === 1 ? CORAL : MUSTARD, rotation: tangent, parent: g });
    // A spike on the back (the side away from the belly).
    const n = ((tangent - 90) * Math.PI) / 180;
    const spike = r.shape(`Spike ${N - i}`, 'polygon', { x: p.x + Math.cos(n) * (d / 2 + 4), y: p.y + Math.sin(n) * (d / 2 + 4) }, { w: d * 0.46, h: d * 0.46, sides: 3, color: i % 2 ? CORAL : MUSTARD, stroke: INK, strokeW: 7, rotation: tangent, parent: g });
    return { g, body, spot, spike, foot, d, tangent };
  });
  // Spikes sit behind the body outline: move each spike just before its segment's body.
  for (const sg of segs) { const L = r.layers; L.splice(L.indexOf(sg.spike), 1); L.splice(L.indexOf(sg.body), 0, sg.spike); }

  // Head.
  const H = { x: 744, y: 370 };
  const head = r.group('Head', H);
  const antenna = ([-1, 1] as const).map((side) => {
    const base = { x: H.x + side * 44, y: H.y - 96 };
    const sway = r.group(side < 0 ? 'Antenna left' : 'Antenna right', base, head);
    const boing = r.group(side < 0 ? 'Antenna left spring' : 'Antenna right spring', base, sway);
    r.shape('Stalk', 'rect', { x: base.x + side * 12, y: base.y - 44 }, { w: 11, h: 92, radius: 5.5, color: INK, rotation: side * 14, parent: boing });
    const ball = r.shape('Bulb', 'ellipse', { x: base.x + side * 24, y: base.y - 92 }, { w: 40, h: 40, color: MUSTARD, stroke: INK, strokeW: 7, parent: boing });
    return { sway, boing, ball };
  });
  r.shape('Head', 'ellipse', H, { w: 236, h: 222, color: TEAL, stroke: INK, strokeW: 10, parent: head });
  r.shape('Head shine', 'ellipse', { x: H.x - 62, y: H.y - 62 }, { w: 46, h: 26, color: CREAM, opacity: 0.35, rotation: -35, parent: head });
  const cheeks = [-1, 1].map((side) => r.shape(side < 0 ? 'Cheek left' : 'Cheek right', 'ellipse', { x: H.x + side * 78, y: H.y + 40 }, { w: 40, h: 22, color: CORAL, opacity: 0.7, parent: head }));
  const eyes = r.group('Eyes', { x: H.x, y: H.y - 6 }, head);
  const whites = [-1, 1].map((side) => r.shape(side < 0 ? 'Eye left' : 'Eye right', 'ellipse', { x: H.x + side * 42, y: H.y - 6 }, { w: 74, h: 84, color: CREAM, stroke: INK, strokeW: 7, parent: eyes }));
  const pupils = [-1, 1].map((side) => r.shape(side < 0 ? 'Pupil left' : 'Pupil right', 'ellipse', { x: H.x + side * 42, y: H.y - 2 }, { w: 34, h: 38, color: INK, parent: eyes }));
  const glints = [-1, 1].map((side) => r.shape(side < 0 ? 'Glint left' : 'Glint right', 'ellipse', { x: H.x + side * 42 + 7, y: H.y - 10 }, { w: 11, h: 11, color: CREAM, parent: eyes }));
  const mouth = r.shape('Mouth', 'ellipse', { x: H.x, y: H.y + 62 }, { w: 30, h: 20, color: INK, parent: head });

  // ---------- moves ----------
  const idle = anim('Idle', 3.2, 'loop',
    'A breath travels along the body from head to tail — each segment swells a little, one after another. The antennae sway out of step with each other, the spots twinkle, and the eyes blink once and then twice.', [
      ...segs.map((sg, i) => tr(sg.g, 'transform.scale', [[0, 1], ...after((N - 1 - i) * 0.12, [[0, 1, 'easeInOut'], [0.55, 1.06, 'easeInOut'], [1.1, 1]]), [3.2, 1]])),
      tr(antenna[0].sway, 'transform.rotation', [[0, -5], [1.6, 6], [3.2, -5]]),
      tr(antenna[1].sway, 'transform.rotation', [[0, 6], [1.6, -5], [3.2, 6]]),
      ...segs.map((sg, i) => tr(sg.spot, 'transform.scale', [[0, 1], [0.8 + (i % 3) * 0.6, 1.18], [1.6 + (i % 3) * 0.6, 1], [3.2, 1]])),
      tr(eyes, 'transform.scaleY', [[0, 1, 'linear'], [1.0, 1, 'easeIn'], [1.07, 0.08, 'easeOut'], [1.18, 1, 'linear'], [2.5, 1, 'easeIn'], [2.57, 0.08, 'easeOut'], [2.66, 1, 'linear'], [2.76, 1, 'easeIn'], [2.82, 0.08, 'easeOut'], [2.92, 1, 'linear'], [3.2, 1]]),
    ]);

  const hy = head.transform.y, hpx = (px: number) => +(hy + px / r.H).toFixed(5);
  const wiggle = anim('Wiggle', 1.5, 'once',
    'Overlapping action: the head dips (anticipation), leaps and tilts first; each body segment hops 0.06 s after the one in front of it, so a wave runs down to the tail; the spikes and antennae flick last and settle. Nothing stops at the same moment, which is what makes it feel alive.', [
      tr(head, 'transform.y', [[0, hy, 'easeOut'], [0.1, hpx(10), 'easeOut'], [0.28, hpx(-62), 'easeInOut'], [0.5, hpx(8), 'easeInOut'], [0.7, hy]]),
      tr(head, 'transform.rotation', [[0, 0, 'easeOut'], [0.28, -9, 'easeInOut'], [0.55, 5, 'easeInOut'], [0.8, 0]]),
      tr(head, 'transform.scaleY', [[0, 1, 'easeOut'], [0.1, 0.9, 'easeOut'], [0.28, 1.08, 'easeInOut'], [0.5, 0.95, 'easeInOut'], [0.7, 1]]),
      tr(head, 'transform.scaleX', [[0, 1, 'easeOut'], [0.1, 1.08, 'easeOut'], [0.28, 0.95, 'easeInOut'], [0.5, 1.04, 'easeInOut'], [0.7, 1]]),
      ...whites.map((w) => tr(w, 'transform.scale', [[0.08, 1, 'backOut'], [0.22, 1.18, 'easeInOut'], [0.9, 1]])),
      tr(mouth, 'props.height', [[0.08, 20, 'backOut'], [0.22, 38, 'easeInOut'], [0.9, 20]]),
      ...segs.map((sg, i) => {
        const y = sg.g.transform.y, dl = 0.14 + (N - 1 - i) * 0.06;
        return tr(sg.g, 'transform.y', after(dl, [[0, y, 'easeOut'], [0.16, +(y - 34 / r.H).toFixed(5), 'easeIn'], [0.34, +(y + 6 / r.H).toFixed(5), 'easeOut'], [0.5, y]]));
      }),
      ...segs.map((sg, i) => tr(sg.spike, 'transform.rotation', after(0.5 + (N - 1 - i) * 0.05, [[0, sg.tangent, 'easeOut'], [0.12, sg.tangent + 20, 'easeInOut'], [0.3, sg.tangent - 10, 'easeInOut'], [0.5, sg.tangent]]))),
      ...antenna.map((a, i) => tr(a.boing, 'transform.rotation', [[0.3, 0, 'easeOut'], [0.45, i ? 26 : -26, 'easeInOut'], [0.66, i ? -16 : 16, 'easeInOut'], [0.86, i ? 7 : -7, 'easeInOut'], [1.06, 0]])),
    ]);
  const notice = anim('Notice', 0.4, 'once', 'Hovering makes it blush and perk up its antenna bulbs — a small reward that tells people it can be clicked.', [
    ...cheeks.map((c) => tr(c, 'opacity', [[0, 0.7], [0.3, 1]])),
    ...cheeks.map((c) => tr(c, 'transform.scale', [[0, 1, 'backOut'], [0.35, 1.2]])),
    ...antenna.map((a) => tr(a.ball, 'transform.scale', [[0, 1, 'backOut'], [0.35, 1.25]])),
  ]);

  // Eyes follow the pointer: pupils move most, whites a little, the head tilts toward it.
  const lookX = follower('Look X', 'pointerX', { smoothing: 0.75 }), lookY = follower('Look Y', 'pointerY', { smoothing: 0.75 });
  const W = r.W, Hh = r.H;
  const bindings = [
    ...pupils.flatMap((p) => [link(lookX, p, 'transform.x', [-1, 1], [-17 / W, 17 / W]), link(lookY, p, 'transform.y', [-1, 1], [-14 / Hh, 14 / Hh])]),
    ...glints.flatMap((p) => [link(lookX, p, 'transform.x', [-1, 1], [-17 / W, 17 / W]), link(lookY, p, 'transform.y', [-1, 1], [-14 / Hh, 14 / Hh])]),
    ...whites.flatMap((p) => [link(lookX, p, 'transform.x', [-1, 1], [-5 / W, 5 / W]), link(lookY, p, 'transform.y', [-1, 1], [-4 / Hh, 4 / Hh])]),
    link(lookX, head, 'transform.rotation', [-1, 1], [-7, 7]),
    link(lookY, head, 'transform.y', [-1, 1], [-6 / Hh, 6 / Hh]),
  ];

  const bodies = segs.map((s) => s.body);
  return finish(r, {
    name: 'Wandering creature', category: 'Characters', background: '#efe6d2', duration: 3.2,
    description: 'A winding, segmented creature whose eyes follow your pointer. Click it and a wiggle travels from its head to the tip of its tail.',
    tags: ['character', 'follow', 'pointer', 'overlapping-action'],
    exposed: [
      param('bodyColour', 'Body colour', 'Every body segment and the head.', 'color', [...bodies.map((b) => [b, 'props.fill.color'] as [Layer, string]), [r.layers.find((l) => l.name === 'Head' && l.type === 'shape')!, 'props.fill.color']], TEAL),
      param('spotColour', 'Spot colour', 'The round spots and antenna bulbs.', 'color', [...segs.filter((_, i) => i % 3 !== 1).map((s) => [s.spot, 'props.fill.color'] as [Layer, string]), ...antenna.map((a) => [a.ball, 'props.fill.color'] as [Layer, string])], MUSTARD),
      param('cheekColour', 'Cheek colour', 'Cheeks and the coral spots.', 'color', [...cheeks.map((c) => [c, 'props.fill.color'] as [Layer, string]), ...segs.filter((_, i) => i % 3 === 1).map((s) => [s.spot, 'props.fill.color'] as [Layer, string])], CORAL),
    ],
    machine: {
      inputs: [lookX, lookY], animations: [idle, wiggle, notice], bindings,
      rules: [
        rule({ type: 'start' }, [], play(idle)),
        rule(onPointer('click', touch), [], play(wiggle), sound('boing', 0.5)),
        rule(onPointer('enter', touch), [], playOn(notice)),
        rule(onPointer('leave', touch), [], playBack(notice)),
      ],
    },
  });
}

export type { Key };
