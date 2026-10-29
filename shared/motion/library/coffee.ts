import type { Layer, SceneDocument } from '../../scene/schema';
import { evaluateTrack } from '../../timeline';
import { Rig, after, anim, finish, follower, link, onPointer, param, play, rule, sound, tr, type Key } from './rig';

/**
 * Morning coffee. A quiet still life: a terracotta mug under an arched window of light, steam
 * curling up in three out-of-step wisps that drift toward the pointer. Click to stir: the spoon
 * wobbles, the latte heart swirls round, the mug gives a little hop and the steam puffs up.
 */
export function morningCoffee(): SceneDocument {
  const r = new Rig(1080, 1080);
  const ARCH = '#ecd5b6', MUG = '#d9643a', MUG_SHADE = '#b94f2b', RIM = '#c55a33', COFFEE = '#5a3624', CREAM = '#f7e9d4', SAUCER = '#f7efe4', SAUCER_SHADE = '#dcc8ac', SPOON = '#b8b2aa', STEAM = '#ffffff';

  r.shape('Window light', 'rect', { x: 540, y: 520 }, { w: 620, h: 760, radius: 310, color: ARCH });
  r.shape('Saucer shade', 'ellipse', { x: 540, y: 816 }, { w: 470, h: 76, color: SAUCER_SHADE });
  const saucer = r.shape('Saucer', 'ellipse', { x: 540, y: 800 }, { w: 470, h: 74, color: SAUCER });

  const steam = r.group('Steam', { x: 540, y: 470 });
  const wisps = [490, 542, 594].map((x, i) => {
    const g = r.group(`Wisp ${i + 1}`, { x, y: 420 }, steam);
    const l = r.shape('Wisp', 'rect', { x, y: 420 }, { w: 20, h: 120, radius: 10, color: STEAM, opacity: 0, parent: g });
    return { g, l };
  });

  const mug = r.group('Mug', { x: 540, y: 790 });
  r.shape('Handle', 'ellipse', { x: 696, y: 640 }, { w: 150, h: 150, color: MUG, fill: 'none', stroke: MUG, strokeW: 32, parent: mug });
  const spoon = r.group('Spoon', { x: 566, y: 516 }, mug);
  r.shape('Spoon handle', 'rect', { x: 600, y: 432 }, { w: 18, h: 210, radius: 9, color: SPOON, rotation: 20, parent: spoon });
  r.shape('Spoon shine', 'rect', { x: 596, y: 420 }, { w: 5, h: 120, radius: 2.5, color: '#ffffff', rotation: 20, opacity: 0.6, parent: spoon });
  const body = r.shape('Mug', 'rect', { x: 540, y: 652 }, { w: 300, h: 280, radius: 50, color: MUG, parent: mug });
  r.shape('Mug shade', 'rect', { x: 636, y: 656 }, { w: 80, h: 262, radius: 38, color: MUG_SHADE, opacity: 0.55, parent: mug });
  const dots = [[470, 620], [540, 660], [610, 620], [470, 700], [610, 700]].map(([x, y], i) => r.shape(`Dot ${i + 1}`, 'ellipse', { x, y }, { w: 18, h: 18, color: CREAM, opacity: 0.9, parent: mug }));
  const rim = r.shape('Rim', 'ellipse', { x: 540, y: 514 }, { w: 300, h: 62, color: RIM, parent: mug });
  const surface = r.shape('Coffee', 'ellipse', { x: 540, y: 516 }, { w: 262, h: 44, color: COFFEE, parent: mug });
  // Latte foam: a ring of dots drawn flat inside a spinning group, inside an outer group squashed
  // vertically so the ring lies on the coffee's surface. (Spin inside, squash outside, so turning
  // never distorts the perspective.)
  const foam = r.group('Foam', { x: 540, y: 516 }, mug);
  const latte = r.group('Foam swirl', { x: 540, y: 516 }, foam);
  [[0, 0, 30], ...Array.from({ length: 7 }, (_, i) => { const a = (i / 7) * Math.PI * 2; return [Math.cos(a) * (58 + (i % 2) * 8), Math.sin(a) * (58 + (i % 2) * 8), i % 2 ? 14 : 22]; })]
    .forEach(([dx, dy, d], i) => r.shape(i ? `Foam ${i}` : 'Foam centre', 'ellipse', { x: 540 + dx, y: 516 + dy }, { w: d, h: d, color: CREAM, parent: latte }));
  foam.transform.scaleY = 0.3;
  // The spoon is drawn before the mug, so the mug's front and the coffee hide its lower end.

  const touch = r.shape('Touch area', 'rect', { x: 560, y: 620 }, { w: 520, h: 420, color: MUG, fill: 'none', locked: true });

  // Each wisp rises, stretches and fades over the loop; the three are shifted in time by 0.9 s.
  // A shifted loop is sampled into keys so it still joins up seamlessly at the loop point.
  const D = 2.7;
  const shifted = (l: Layer, path: string, keys: Key[], off: number) => {
    const base = tr(l, path, keys);
    const n = 30;
    return tr(l, path, Array.from({ length: n + 1 }, (_, k): Key => {
      const t = (k / n) * D;
      return [+t.toFixed(3), evaluateTrack(base, (((t - off) % D) + D) % D) as number, 'linear'];
    }));
  };
  const rise = (i: number) => {
    const off = i * 0.9, y = wisps[i].g.transform.y;
    return [
      shifted(wisps[i].l, 'opacity', [[0, 0], [0.5, 0.6], [2.2, 0], [D, 0]], off),
      shifted(wisps[i].g, 'transform.y', [[0, y, 'linear'], [2.2, r.dy(wisps[i].g, -110), 'linear'], [D, r.dy(wisps[i].g, -110)]], off),
      shifted(wisps[i].g, 'transform.scaleY', [[0, 0.7, 'linear'], [2.2, 1.3], [D, 1.3]], off),
      shifted(wisps[i].g, 'transform.rotation', [[0, 0], [0.8, i % 2 ? 8 : -8], [1.6, i % 2 ? -6 : 6], [2.2, 0], [D, 0]], off),
    ];
  };
  const idle = anim('Steam', 2.7, 'loop', 'Three wisps of steam rise, stretch and fade, each 0.9 s out of step with the next, so the steam never stops and never repeats in an obvious way.', [0, 1, 2].flatMap(rise));
  const my = mug.transform.y;
  const stir = anim('Stir', 1.4, 'once', 'The spoon rocks back and forth (each swing smaller — follow-through), the latte heart swirls a full turn and slows to a stop, the mug hops with a squash, and the steam puffs up a moment later.', [
    tr(spoon, 'transform.rotation', [[0, 0, 'easeInOut'], [0.15, -14, 'easeInOut'], [0.35, 12, 'easeInOut'], [0.55, -8, 'easeInOut'], [0.75, 5, 'easeInOut'], [0.95, 0]]),
    tr(latte, 'transform.rotation', [[0, 0, 'expoOut'], [1.3, 360]]),
    tr(surface, 'transform.scaleX', [[0, 1, 'easeInOut'], [0.2, 0.94, 'easeInOut'], [0.45, 1.03, 'easeInOut'], [0.7, 1]]),
    tr(mug, 'transform.y', [[0, my, 'easeOut'], [0.08, my, 'easeOut'], [0.22, r.dy(mug, -16), 'easeIn'], [0.36, my]]),
    tr(mug, 'transform.scaleY', [[0, 1, 'easeOut'], [0.08, 0.94, 'easeOut'], [0.22, 1.04, 'easeInOut'], [0.36, 0.96, 'easeOut'], [0.5, 1]]),
    tr(mug, 'transform.scaleX', [[0, 1, 'easeOut'], [0.08, 1.04, 'easeOut'], [0.22, 0.97, 'easeInOut'], [0.36, 1.03, 'easeOut'], [0.5, 1]]),
    tr(steam, 'transform.scale', after(0.2, [[0, 1, 'backOut'], [0.35, 1.35, 'easeInOut'], [1, 1]])),
    tr(saucer, 'transform.scaleX', [[0.3, 1, 'easeOut'], [0.38, 1.03, 'easeInOut'], [0.6, 1]]),
  ]);

  const drift = follower('Breeze', 'pointerX', { smoothing: 0.9 });
  return finish(r, {
    name: 'Morning coffee', category: 'Illustrations', background: '#f3e4cf', duration: 2.7,
    description: 'A warm still life: steam curls up and drifts toward your pointer; click to stir — the spoon rocks, the latte heart swirls.',
    tags: ['illustration', 'still-life', 'loop', 'cosy'],
    exposed: [
      param('mug', 'Mug colour', 'The mug and handle.', 'color', [[body, 'props.fill.color'], [r.layers.find((l) => l.name === 'Handle')!, 'props.stroke.color']], MUG),
      param('pattern', 'Pattern colour', 'The dots on the mug and the latte art.', 'color', [...dots.map((d) => [d, 'props.fill.color'] as [Layer, string]), ...r.layers.filter((l) => l.parentId === latte.id).map((l) => [l, 'props.fill.color'] as [Layer, string])], CREAM),
      param('light', 'Window light', 'The arch of light behind.', 'color', [[r.layers.find((l) => l.name === 'Window light')!, 'props.fill.color']], ARCH),
    ],
    machine: {
      inputs: [drift], animations: [idle, stir],
      bindings: [link(drift, steam, 'transform.rotation', [-1, 1], [-14, 14]), link(drift, steam, 'transform.x', [-1, 1], [-24 / r.W, 24 / r.W])],
      rules: [
        rule({ type: 'start' }, [], play(idle)),
        rule(onPointer('click', touch), [], play(stir), sound('bubble', 0.5)),
      ],
    },
  });
}

