import type { Layer, SceneDocument } from '../../scene/schema';
import { Rig, after, anim, finish, input, link, numIs, param, play, rule, sound, tr } from './rig';

/**
 * Inchworm loader. A "Progress" slider (0–100) fills the bar and carries a little inchworm along
 * with it while it inches in place — connect the slider to your app's real progress. Reaching 100
 * makes it jump and the label changes to “Done!”; going back below 100 resets it.
 */
export function inchwormLoader(): SceneDocument {
  const r = new Rig(1080, 1080);
  const INK = '#2b2350', TRACK = '#e3dcf5', FILL = '#7c5cff', WORM = '#6fd08c', BELLY = '#9be3ae', CHEEK = '#ff8fab';
  const X0 = 190, X1 = 890, Y = 640, BAR = 40;
  // The worm waits at the start until the fill reaches it (20 %), then rides the fill's leading edge.
  const WX = X0 + BAR + (X1 - X0 - BAR) * 0.2 - 28;

  r.shape('Track', 'rect', { x: 540, y: Y }, { w: X1 - X0, h: BAR, radius: BAR / 2, color: TRACK });
  // The fill's width and position are both set by the slider, so its round ends never distort.
  const fill = r.shape('Fill', 'rect', { x: X0 + BAR / 2, y: Y }, { w: BAR, h: BAR, radius: BAR / 2, color: FILL });

  // The worm sits on the bar; it's designed at 20 % and shifted by the slider from there.
  const worm = r.group('Worm', { x: WX + 10, y: Y - BAR / 2 });
  const hop = r.group('Hop', { x: WX + 10, y: Y - BAR / 2 }, worm);
  const segX = [-118, -88, -58, -28];
  const segs = segX.map((dx, i) => {
    const g = r.group(`Segment ${i + 1}`, { x: WX + dx, y: Y - BAR / 2 - 22 }, hop);
    r.shape('Segment', 'ellipse', { x: WX + dx, y: Y - BAR / 2 - 22 }, { w: 46 + i * 3, h: 44 + i * 3, color: WORM, stroke: INK, strokeW: 6, parent: g });
    r.shape('Belly', 'ellipse', { x: WX + dx, y: Y - BAR / 2 - 12 }, { w: 30, h: 14, color: BELLY, parent: g });
    return g;
  });
  const head = r.group('Head', { x: WX + 12, y: Y - BAR / 2 - 34 }, hop);
  const antennae = [-1, 1].map((side) => r.shape(side < 0 ? 'Antenna back' : 'Antenna front', 'rect', { x: WX + 12 + side * 12, y: Y - BAR / 2 - 92 }, { w: 6, h: 34, radius: 3, color: INK, rotation: side * 18, parent: head }));
  r.shape('Head', 'ellipse', { x: WX + 12, y: Y - BAR / 2 - 34 }, { w: 72, h: 68, color: WORM, stroke: INK, strokeW: 6, parent: head });
  const eye = r.shape('Eye', 'ellipse', { x: WX + 24, y: Y - BAR / 2 - 42 }, { w: 12, h: 18, color: INK, parent: head });
  r.shape('Cheek', 'ellipse', { x: WX + 30, y: Y - BAR / 2 - 22 }, { w: 16, h: 10, color: CHEEK, parent: head });

  const loading = r.text('Label', 'Loading…', { x: 540, y: 430 }, { size: 64, color: INK, weight: 400, font: 'Barriecito' });
  const done = r.text('Done label', 'Done!', { x: 540, y: 430 }, { size: 64, color: FILL, weight: 400, font: 'Barriecito' });
  done.opacity = 0;

  const inch = anim('Inch', 1, 'loop', 'The inching walk: the middle segments arch up in turn, then the head nods forward — a small loop that repeats while the slider carries the worm along the bar.', [
    ...segs.map((g, i) => {
      const y = g.transform.y, lift = [0, -14, -22, -10][i];
      return tr(g, 'transform.y', after(i * 0.06, [[0, y, 'easeInOut'], [0.35, r.dy(g, lift), 'easeInOut'], [0.7, y], [0.94 - i * 0.06, y]]));
    }),
    tr(head, 'transform.rotation', [[0, 0], [0.4, 8], [0.7, -4], [1, 0]]),
    ...antennae.map((a, i) => tr(a, 'transform.rotation', [[0, a.transform.rotation], [0.5, a.transform.rotation + (i ? 14 : -14)], [1, a.transform.rotation]])),
  ]);
  const hy = hop.transform.y;
  const finished = anim('Finished', 1.1, 'once', 'At 100 % the worm crouches, leaps and lands with a squash, the eye pops, and the label swaps to “Done!”.', [
    tr(hop, 'transform.y', [[0, hy, 'easeOut'], [0.12, hy, 'easeOut'], [0.36, r.dy(hop, -90), 'easeIn'], [0.6, hy]]),
    tr(hop, 'transform.scaleY', [[0, 1, 'easeOut'], [0.12, 0.8, 'easeOut'], [0.3, 1.15, 'easeInOut'], [0.58, 1, 'easeOut'], [0.66, 0.85, 'easeOut'], [0.85, 1]]),
    tr(hop, 'transform.scaleX', [[0, 1, 'easeOut'], [0.12, 1.12, 'easeOut'], [0.3, 0.92, 'easeInOut'], [0.58, 1, 'easeOut'], [0.66, 1.1, 'easeOut'], [0.85, 1]]),
    tr(eye, 'props.height', [[0.1, 18, 'backOut'], [0.3, 26], [0.9, 18]]),
    tr(loading, 'opacity', [[0, 1], [0.2, 0]]),
    tr(done, 'opacity', [[0.15, 0], [0.4, 1]]),
    tr(done, 'transform.scale', [[0.15, 0.6, 'backOut'], [0.5, 1]]),
  ]);
  const reset = anim('Reset', 0.4, 'once', 'Dropping back below 100 quietly swaps the label back.', [
    tr(done, 'opacity', [[0, 1], [0.2, 0]]),
    tr(loading, 'opacity', [[0.1, 0], [0.4, 1]]),
  ]);

  const progress = { ...input('Progress', 'number', 35), min: 0, max: 100 };
  const W = r.W;
  return finish(r, {
    name: 'Inchworm loader', category: 'Loaders', background: '#f6f2ff', duration: 1,
    description: 'A progress bar with an inchworm riding its leading edge. Drive the Progress slider; at 100 it jumps for joy.',
    tags: ['loader', 'progress', 'slider', 'character'],
    exposed: [
      param('fill', 'Bar colour', 'The filled part of the bar and the “Done!” label.', 'color', [[fill, 'props.fill.color'], [done, 'props.color']], FILL),
      param('worm', 'Worm colour', 'The worm’s body and head.', 'color', r.layers.filter((l) => l.name === 'Segment' || (l.name === 'Head' && l.type === 'shape')).map((l) => [l, 'props.fill.color'] as [Layer, string]), WORM),
      param('loading', 'Loading text', 'Shown while loading.', 'text', [[loading, 'props.text']], 'Loading…', 'Content'),
      param('done', 'Done text', 'Shown at 100.', 'text', [[done, 'props.text']], 'Done!', 'Content'),
    ],
    machine: {
      inputs: [progress], animations: [inch, finished, reset],
      bindings: [
        link(progress, fill, 'props.width', [0, 100], [BAR, X1 - X0], false),
        link(progress, fill, 'transform.x', [0, 100], [(X0 + BAR / 2) / W, 540 / W], false),
        link(progress, worm, 'transform.x', [20, 100], [0, ((X1 - X0 - BAR) * 0.8) / W]),
      ],
      rules: [
        rule({ type: 'start' }, [], play(inch)),
        rule(numIs(progress, '>=', 100), [], play(finished), sound('chime', 0.5)),
        rule(numIs(progress, '<', 100), [], play(reset)),
      ],
    },
  });
}
