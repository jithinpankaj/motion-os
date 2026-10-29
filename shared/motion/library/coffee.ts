import type { Layer, SceneDocument } from '../../scene/schema';
import { evaluateTrack } from '../../timeline';
import { Rig, after, anim, finish, follower, link, onPointer, param, play, rule, sound, tr, type Key } from './rig';

/**
 * Morning coffee. A flat-vector still life in the editorial style: a porcelain cup on its saucer,
 * a heart poured into the crema, soft slate light. Steam rises in three out-of-step wisps that
 * lean toward the pointer. Click to stir: the cup gives a small damped clink on the saucer, the
 * heart dissolves into a swirl and settles back, the crema shimmers and the steam puffs up a beat later.
 */
export function morningCoffee(): SceneDocument {
  const r = new Rig(1080, 1080);
  const BG = '#56696a', GLOW = '#667a7b', SHADOW = '#475859';
  const SAUCER_T = '#f6f8f8', SAUCER_B = '#d9e1e3', WELL = '#e4eaec', CUP_SHADOW = '#c3cdd0';
  const CUP_L = '#e3ebef', CUP_R = '#a3b5bf', RIM = '#f1f5f6', INNER = '#9badb6', HANDLE = '#b4c4cc';
  const CREMA = '#c98a4e', CREMA_EDGE = '#8b5428', FOAM = '#f6eadb', STEAM = '#ffffff';
  const C = { x: 540, y: 400 }; // centre of the cup's opening

  // Light and shadow under everything.
  r.shape('Glow', 'ellipse', { x: 540, y: 520 }, { w: 1060, h: 1060, color: GLOW, fill: 'radial' }).props.fill.color2 = BG;
  r.shape('Saucer shadow', 'ellipse', { x: 572, y: 772 }, { w: 740, h: 290, color: SHADOW, opacity: 0.7 });
  const plate = r.group('Saucer group', { x: 540, y: 735 });
  const saucer = r.shape('Saucer', 'ellipse', { x: 540, y: 735 }, { w: 720, h: 280, color: SAUCER_T, fill: 'linear', parent: plate });
  saucer.props.fill.color2 = SAUCER_B; saucer.props.fill.angle = 90;
  r.shape('Saucer well', 'ellipse', { x: 540, y: 724 }, { w: 450, h: 150, color: WELL, parent: plate });
  r.shape('Cup shadow', 'ellipse', { x: 556, y: 722 }, { w: 380, h: 96, color: CUP_SHADOW, opacity: 0.9, parent: plate });

  // Steam sits behind the cup so it appears to rise out of it.
  const steam = r.group('Steam', { x: 540, y: 330 });
  const wisps = [478, 540, 602].map((x, i) => {
    const g = r.group(`Wisp ${i + 1}`, { x, y: 300 }, steam);
    const l = r.shape('Wisp', 'rect', { x, y: 300 }, { w: 26, h: 150, radius: 13, color: STEAM, opacity: 0, parent: g });
    return { g, l };
  });

  // The cup: a straight-sided bowl (rect) with a rounded base (ellipse) sharing one horizontal
  // gradient, so the two read as a single lit form. The handle ring sits behind the body.
  const cup = r.group('Cup', { x: 540, y: 690 });
  const handle = r.shape('Handle', 'ellipse', { x: 772, y: 520 }, { w: 150, h: 128, color: HANDLE, fill: 'none', stroke: HANDLE, strokeW: 30, rotation: -12, parent: cup });
  r.shape('Handle shine', 'ellipse', { x: 806, y: 500 }, { w: 30, h: 60, color: '#ffffff', opacity: 0.45, rotation: -20, parent: cup });
  const body = r.shape('Cup body', 'rect', { x: C.x, y: 500 }, { w: 450, h: 200, color: CUP_L, fill: 'linear', parent: cup });
  const base = r.shape('Cup base', 'ellipse', { x: C.x, y: 590 }, { w: 450, h: 250, color: CUP_L, fill: 'linear', parent: cup });
  for (const l of [body, base]) { l.props.fill.color2 = CUP_R; l.props.fill.angle = 0; }
  r.shape('Cup foot', 'ellipse', { x: C.x, y: 708 }, { w: 190, h: 30, color: CUP_R, parent: cup });
  r.shape('Body shine', 'rect', { x: 372, y: 540 }, { w: 26, h: 190, radius: 13, color: '#ffffff', opacity: 0.5, parent: cup });
  r.shape('Rim', 'ellipse', { x: C.x, y: C.y }, { w: 462, h: 150, color: RIM, parent: cup });
  r.shape('Inner wall', 'ellipse', { x: C.x, y: C.y + 4 }, { w: 432, h: 132, color: INNER, parent: cup });
  const coffee = r.shape('Coffee', 'ellipse', { x: C.x, y: C.y + 10 }, { w: 406, h: 116, color: CREMA, fill: 'radial', parent: cup });
  coffee.props.fill.color2 = CREMA_EDGE;

  // Latte art: a clean poured heart, drawn directly in perspective (no squashed parent, so nothing
  // distorts). A slightly larger caramel copy underneath gives the foam its soft, blended edge.
  const sy = C.y + 12;
  const art = r.group('Heart', { x: C.x, y: sy }, cup);
  const heart = (name: string, grow: number, color: string) => {
    r.shape(`${name} lobe L`, 'ellipse', { x: C.x - 34, y: sy - 8 }, { w: 94 + grow, h: 40 + grow * 0.45, color, parent: art });
    r.shape(`${name} lobe R`, 'ellipse', { x: C.x + 34, y: sy - 8 }, { w: 94 + grow, h: 40 + grow * 0.45, color, parent: art });
    r.shape(`${name} point`, 'polygon', { x: C.x, y: sy + 14 + grow * 0.2 }, { w: 150 + grow * 1.2, h: 56 + grow * 0.5, sides: 3, color, parent: art });
  };
  heart('Foam edge', 14, '#ddb184');
  heart('Foam', 0, FOAM);

  // The swirl: two spiral arms laid out flat in a plane squashed onto the surface. Each arm is a
  // ribbon of overlapping strokes, thick at the centre and tapering outward; each stroke's long
  // axis follows the spiral's tangent, which keeps it exact under the squash. Four bands turn at
  // graded speeds (fastest at the centre), so stirring reads as smooth fluid shear.
  const plane = r.group('Swirl plane', { x: C.x, y: sy }, cup);
  const bands = [0, 1, 2, 3].map((k) => r.group(`Swirl band ${k + 1}`, { x: C.x, y: sy }, plane));
  const N = 44, STEP = 16;
  for (const arm of [0, 180]) {
    for (let i = 0; i < N; i++) {
      const rad = 8 + i * 3.7, deg = arm + i * STEP, th = (deg * Math.PI) / 180;
      const len = Math.max(14, rad * ((STEP * Math.PI) / 180) * 1.7), thick = 15 - (i / N) * 10;
      r.shape(`Swirl ${arm ? 'B' : 'A'}${i + 1}`, 'ellipse', { x: C.x + Math.cos(th) * rad, y: sy + Math.sin(th) * rad }, { w: len, h: thick, color: FOAM, rotation: deg + 90, parent: bands[Math.floor((i / N) * 4)] });
    }
  }
  plane.transform.scaleY = 0.28;
  plane.opacity = 0;
  const gloss = r.shape('Crema gloss', 'ellipse', { x: C.x - 112, y: C.y - 6 }, { w: 96, h: 16, color: '#ffffff', opacity: 0.18, rotation: -6, parent: cup });

  const touch = r.shape('Touch area', 'rect', { x: 560, y: 560 }, { w: 640, h: 460, color: CUP_L, fill: 'none', locked: true });

  // Each wisp rises, stretches and fades; the three are 0.9 s apart. A shifted loop is resampled
  // into keys so it still joins up seamlessly at the loop point.
  const D = 2.7;
  const shifted = (l: Layer, path: string, keys: Key[], off: number) => {
    const baseTrack = tr(l, path, keys);
    const n = 30;
    return tr(l, path, Array.from({ length: n + 1 }, (_, k): Key => {
      const t = (k / n) * D;
      return [+t.toFixed(3), evaluateTrack(baseTrack, (((t - off) % D) + D) % D) as number, 'linear'];
    }));
  };
  const rise = (i: number) => {
    const off = i * 0.9, y = wisps[i].g.transform.y;
    return [
      shifted(wisps[i].l, 'opacity', [[0, 0], [0.6, 0.32], [2.2, 0], [D, 0]], off),
      shifted(wisps[i].g, 'transform.y', [[0, y, 'linear'], [2.2, r.dy(wisps[i].g, -130), 'linear'], [D, r.dy(wisps[i].g, -130)]], off),
      shifted(wisps[i].g, 'transform.scaleY', [[0, 0.6, 'linear'], [2.2, 1.35], [D, 1.35]], off),
      shifted(wisps[i].g, 'transform.scaleX', [[0, 1, 'linear'], [2.2, 0.55], [D, 0.55]], off),
      shifted(wisps[i].g, 'transform.rotation', [[0, 0], [0.8, i % 2 ? 9 : -9], [1.6, i % 2 ? -7 : 7], [2.2, 0], [D, 0]], off),
    ];
  };
  const idle = anim('Steam', D, 'loop', 'Three wisps rise, thin out and fade, each 0.9 s out of step, so the steam never stops and never visibly repeats. The light on the crema breathes with them.', [
    ...[0, 1, 2].flatMap(rise),
    tr(gloss, 'opacity', [[0, 0.18], [1.35, 0.3], [D, 0.18]]),
  ]);
  const cy = cup.transform.y;
  const stir = anim('Stir', 2.5, 'once', 'A small lift and a damped clink (each tilt smaller: follow-through), the saucer answers a beat later. The heart draws in and becomes a two-arm swirl that spins up on a long ease-out, inner arms faster than outer like real stirred milk, then slows, fades, and the heart settles back. The crema shimmers and the steam puffs up last.', [
    tr(cup, 'transform.y', [[0, cy, 'easeOut'], [0.12, r.dy(cup, -14), 'easeIn'], [0.24, cy]]),
    tr(cup, 'transform.rotation', [[0, 0, 'easeOut'], [0.12, -3.5, 'easeInOut'], [0.3, 2.2, 'easeInOut'], [0.48, -1, 'easeInOut'], [0.66, 0]]),
    tr(plate, 'transform.scaleY', [[0.22, 1, 'easeOut'], [0.3, 0.95, 'easeInOut'], [0.5, 1.015, 'easeInOut'], [0.7, 1]]),
    // The heart draws in and dissolves into the swirl…
    tr(art, 'transform.scale', [[0.05, 1, 'easeIn'], [0.32, 0.55, 'step'], [1.9, 0.7, 'backOut'], [2.45, 1]]),
    tr(art, 'opacity', [[0.05, 1, 'easeIn'], [0.3, 0, 'step'], [1.9, 0, 'easeOut'], [2.4, 1]]),
    // …which spins up on a long ease-out, inner arms faster than outer, then slows and fades…
    tr(plane, 'opacity', [[0.12, 0, 'easeOut'], [0.36, 1, 'step'], [1.75, 1, 'easeInOut'], [2.3, 0]]),
    tr(plane, 'transform.scale', [[0.12, 0.45, 'expoOut'], [0.9, 1, 'easeInOut'], [2.3, 0.9]]),
    ...bands.map((band, k) => tr(band, 'transform.rotation', [[0.12, 0, 'expoOut'], [2.3, 860 - k * 110]])),
    // …and the heart settles back in, as if freshly poured.
    tr(art, 'transform.y', [[1.9, r.dy(art, 6), 'backOut'], [2.4, art.transform.y]]),
    tr(coffee, 'props.fill.color', [[0.1, CREMA, 'easeInOut'], [0.4, '#d89a5c', 'easeInOut'], [1.2, CREMA]]),
    tr(gloss, 'transform.x', [[0.1, gloss.transform.x, 'easeInOut'], [0.9, r.dx(gloss, 60), 'easeInOut'], [1.6, gloss.transform.x]]),
    tr(steam, 'transform.scale', after(0.3, [[0, 1, 'backOut'], [0.4, 1.3, 'easeInOut'], [1.3, 1]])),
  ]);

  const drift = follower('Breeze', 'pointerX', { smoothing: 0.9 });
  return finish(r, {
    name: 'Morning coffee', category: 'Illustrations', background: BG, duration: D,
    description: 'A porcelain cup with a heart in the crema. Steam leans toward your pointer; click to stir it into a swirl.',
    tags: ['illustration', 'still-life', 'loop', 'cosy', 'latte'],
    exposed: [
      param('cup', 'Cup colour', 'The lit side of the cup.', 'color', [[body, 'props.fill.color'], [base, 'props.fill.color']], CUP_L),
      param('crema', 'Coffee colour', 'The crema in the middle of the cup.', 'color', [[coffee, 'props.fill.color']], CREMA),
      param('foam', 'Heart colour', 'The poured heart (the swirl keeps the classic milk colour).', 'color', r.layers.filter((l) => l.parentId === art.id && !l.name.startsWith('Foam edge')).map((l) => [l, 'props.fill.color'] as [Layer, string]), FOAM),
      param('light', 'Background', 'The light behind the cup.', 'color', [[r.layers.find((l) => l.name === 'Glow')!, 'props.fill.color']], GLOW),
    ],
    machine: {
      inputs: [drift], animations: [idle, stir],
      bindings: [link(drift, steam, 'transform.rotation', [-1, 1], [-14, 14]), link(drift, steam, 'transform.x', [-1, 1], [-26 / r.W, 26 / r.W])],
      rules: [
        rule({ type: 'start' }, [], play(idle)),
        rule(onPointer('click', touch), [], play(stir), sound('bubble', 0.5)),
      ],
    },
  });
}
