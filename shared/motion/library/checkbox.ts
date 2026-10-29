import type { Layer, SceneDocument } from '../../scene/schema';
import { Rig, after, anim, finish, input, is, onPointer, param, play, playBack, playOn, rule, sound, toggle, tr } from './rig';

/**
 * Task checkbox. Ticking it draws the check mark stroke by stroke (each stroke is a group that
 * stretches from its start point), squashes the box, strikes the label through and pops a little
 * confetti. Unticking undoes it quickly and quietly.
 */
export function taskCheckbox(): SceneDocument {
  const r = new Rig(1080, 1080);
  const INK = '#1f2a24', CARD = '#ffffff', GREEN = '#33c47a', TICK = '#ffffff';
  const CONFETTI = ['#ffb000', '#ff5d7a', '#7b61ff', '#33c47a', '#2d9cdb'];

  r.shape('Card shadow', 'rect', { x: 548, y: 552 }, { w: 760, h: 210, radius: 44, color: INK, opacity: 0.08 });
  const card = r.shape('Card', 'rect', { x: 540, y: 540 }, { w: 760, h: 210, radius: 44, color: CARD });
  const confetti = Array.from({ length: 7 }, (_, i) => {
    const a = (-150 + i * 40) * (Math.PI / 180);
    const kind = (['ellipse', 'polygon', 'rect'] as const)[i % 3];
    const l = r.shape(`Confetti ${i + 1}`, kind, { x: 280, y: 540 }, { w: 18, h: kind === 'rect' ? 10 : 18, sides: 3, radius: 3, color: CONFETTI[i % 5], opacity: 0, rotation: i * 37 });
    return { l, to: { x: 280 + Math.cos(a) * 120, y: 540 + Math.sin(a) * 110 } };
  });
  const box = r.group('Box', { x: 280, y: 540 });
  const boxShape = r.shape('Checkbox', 'rect', { x: 280, y: 540 }, { w: 108, h: 108, radius: 30, color: CARD, stroke: INK, strokeW: 9, parent: box });
  // Each check stroke is a group turned to its angle; the bar inside starts at the group's pivot,
  // so stretching the group's width from 0 to 100 % "draws" the stroke.
  const stroke = (name: string, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const len = Math.hypot(to.x - from.x, to.y - from.y), ang = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    const g = r.group(name, from, box);
    // A capsule whose round caps are centred exactly on the two end points, so the short and long
    // strokes share one round corner instead of overshooting each other.
    const T = 15;
    r.shape('Stroke', 'rect', { x: from.x + len / 2, y: from.y }, { w: len + T, h: T, radius: T / 2, color: TICK, parent: g });
    g.transform.rotation = ang;
    g.transform.scaleX = 0.01;
    return g;
  };
  const s1 = stroke('Check short', { x: 252, y: 540 }, { x: 274, y: 564 });
  const s2 = stroke('Check long', { x: 274, y: 564 }, { x: 314, y: 514 });

  const label = r.text('Label', 'Water the plants', { x: 594, y: 536 }, { size: 56, color: INK, weight: 500, font: 'Satoshi' });
  const strike = r.group('Strike', { x: 382, y: 540 });
  r.shape('Strike line', 'rect', { x: 594, y: 540 }, { w: 432, h: 8, radius: 4, color: INK, parent: strike });
  strike.transform.scaleX = 0.01;
  strike.opacity = 0;

  const check = anim('Check', 0.9, 'once', 'The box squashes when pressed and springs bigger as it fills (anticipation, then overshoot). The tick is drawn short stroke first, then long — like a pen would — by stretching each stroke from its starting point. The strike-through follows, and the confetti comes last.', [
    tr(box, 'transform.scaleX', [[0, 1, 'easeOut'], [0.08, 1.1, 'backOut'], [0.3, 0.94, 'easeInOut'], [0.45, 1]]),
    tr(box, 'transform.scaleY', [[0, 1, 'easeOut'], [0.08, 0.86, 'backOut'], [0.3, 1.08, 'easeInOut'], [0.45, 1]]),
    tr(boxShape, 'props.fill.color', [[0.04, CARD], [0.16, GREEN]]),
    tr(s1, 'transform.scaleX', [[0.12, 0.01, 'easeOut'], [0.22, 1]]),
    tr(s2, 'transform.scaleX', [[0.22, 0.01, 'easeOut'], [0.38, 1]]),
    tr(strike, 'transform.scaleX', [[0.3, 0.01, 'easeInOut'], [0.62, 1]]),
    tr(strike, 'opacity', [[0.3, 0, 'step'], [0.31, 1]]),
    tr(label, 'opacity', [[0.3, 1], [0.62, 0.45]]),
    ...confetti.flatMap(({ l, to }, i) => [
      tr(l, 'opacity', after(0.2 + i * 0.02, [[0, 0], [0.04, 1], [0.5, 0]])),
      tr(l, 'transform.x', after(0.2 + i * 0.02, [[0, l.transform.x, 'expoOut'], [0.5, to.x / r.W]])),
      tr(l, 'transform.y', after(0.2 + i * 0.02, [[0, l.transform.y, 'expoOut'], [0.5, to.y / r.H]])),
      tr(l, 'transform.rotation', after(0.2 + i * 0.02, [[0, l.transform.rotation, 'easeOut'], [0.5, l.transform.rotation + 160]])),
    ]),
  ]);
  const uncheck = anim('Uncheck', 0.4, 'once', 'Undoing is faster and plainer than doing — no confetti, the tick un-draws in reverse order.', [
    tr(s2, 'transform.scaleX', [[0, 1, 'easeIn'], [0.12, 0.01]]),
    tr(s1, 'transform.scaleX', [[0.1, 1, 'easeIn'], [0.2, 0.01]]),
    tr(boxShape, 'props.fill.color', [[0.1, GREEN], [0.3, CARD]]),
    tr(strike, 'transform.scaleX', [[0, 1, 'easeInOut'], [0.3, 0.01]]),
    tr(strike, 'opacity', [[0.29, 1, 'step'], [0.3, 0]]),
    tr(label, 'opacity', [[0, 0.45], [0.3, 1]]),
  ]);
  const hover = anim('Hover', 0.25, 'once', 'The box grows slightly under the pointer.', [tr(box, 'transform.scale', [[0, 1, 'backOut'], [0.25, 1.08]])]);

  const done = input('Done', 'boolean', false);
  return finish(r, {
    name: 'Task checkbox', category: 'Interactive UI', background: '#e9f2ec', duration: 1,
    description: 'A to-do item that draws its tick stroke by stroke, strikes itself through and pops a little confetti.',
    tags: ['checkbox', 'toggle', 'ui', 'todo'],
    exposed: [
      param('label', 'Task', 'The task text.', 'text', [[label, 'props.text']], 'Water the plants', 'Content'),
      param('ink', 'Text & outline colour', 'Label, strike line and box outline.', 'color', [[label, 'props.color'], [boxShape, 'props.stroke.color'], [r.layers.find((l) => l.name === 'Strike line')!, 'props.fill.color']], INK),
      param('card', 'Card colour', 'The card behind the task.', 'color', [[card, 'props.fill.color']], CARD),
      param('tick', 'Tick colour', 'The check mark.', 'color', r.layers.filter((l) => l.name === 'Stroke').map((l) => [l, 'props.fill.color'] as [Layer, string]), TICK),
    ],
    machine: {
      inputs: [done], animations: [check, uncheck, hover], bindings: [],
      rules: [
        rule(onPointer('click', card), [], toggle(done)),
        rule(is(done, true), [], play(check), sound('pop', 0.5)),
        rule(is(done, false), [], play(uncheck), sound('tick', 0.5)),
        rule(onPointer('enter', card), [], playOn(hover)),
        rule(onPointer('leave', card), [], playBack(hover)),
      ],
    },
  });
}
