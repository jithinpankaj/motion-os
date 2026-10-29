import type { Layer, SceneDocument } from '../../scene/schema';
import { Rig, anim, finish, follower, link, onPointer, param, play, playBack, playOn, rule, sound, tr } from './rig';

/**
 * 05 · The elastic character. A soft mochi with a sprout on its head. Grab it and drag: it leans and
 * stretches toward the pointer (but less than the pointer moves, so it feels like it resists), its
 * eyes slide in the direction of the pull, and the sprout whips behind. Let go and springs pull it
 * home — it overshoots, wobbles and settles, with the sprout settling last.
 */
export function mochi(): SceneDocument {
  const r = new Rig(1080, 1080);
  const INK = '#3b2433', SKIN = '#fffaf3', PINK = '#ff8fab', LEAF = '#6cc070', WHITE = '#ffffff';

  r.shape('Ground shadow', 'ellipse', { x: 540, y: 816 }, { w: 380, h: 40, color: INK, opacity: 0.1 });
  for (const x of [470, 610]) r.shape(x < 540 ? 'Foot left' : 'Foot right', 'ellipse', { x, y: 802 }, { w: 76, h: 36, color: SKIN, stroke: INK, strokeW: 8 });

  const blob = r.group('Mochi', { x: 540, y: 800 });
  const sprout = r.group('Sprout', { x: 540, y: 488 }, blob);
  r.shape('Stem', 'rect', { x: 540, y: 462 }, { w: 9, h: 50, radius: 4.5, color: INK, parent: sprout });
  const leaves = [r.shape('Leaf left', 'ellipse', { x: 506, y: 438 }, { w: 70, h: 34, color: LEAF, stroke: INK, strokeW: 6, rotation: 28, parent: sprout }),
    r.shape('Leaf right', 'ellipse', { x: 574, y: 430 }, { w: 70, h: 34, color: LEAF, stroke: INK, strokeW: 6, rotation: -24, parent: sprout })];
  const body = r.shape('Body', 'rect', { x: 540, y: 642 }, { w: 390, h: 320, radius: 152, color: SKIN, stroke: INK, strokeW: 10, parent: blob });
  r.shape('Shine', 'ellipse', { x: 420, y: 548 }, { w: 62, h: 30, color: WHITE, rotation: -32, parent: blob });
  r.shape('Shine dot', 'ellipse', { x: 462, y: 524 }, { w: 14, h: 14, color: WHITE, parent: blob });
  const cheeks = [450, 630].map((x, i) => r.shape(i ? 'Cheek right' : 'Cheek left', 'ellipse', { x, y: 688 }, { w: 58, h: 30, color: PINK, opacity: 0.85, parent: blob }));
  const face = r.group('Face', { x: 540, y: 652 }, blob);
  const eyesG = r.group('Eyes', { x: 540, y: 646 }, face);
  const eyes = [490, 590].map((x, i) => r.shape(i ? 'Eye right' : 'Eye left', 'ellipse', { x, y: 646 }, { w: 28, h: 38, color: INK, parent: eyesG }));
  const glints = [495, 595].map((x, i) => r.shape(i ? 'Glint right' : 'Glint left', 'ellipse', { x, y: 636 }, { w: 9, h: 9, color: WHITE, parent: eyesG }));
  const mouth = r.shape('Mouth', 'ellipse', { x: 540, y: 694 }, { w: 30, h: 14, color: INK, parent: face });
  r.text('Hint', 'drag me', { x: 540, y: 912 }, { size: 50, color: INK, weight: 600, font: 'Caveat' }).opacity = 0.45;

  const idle = anim('Idle', 2.8, 'loop', 'Gentle breathing from its feet, a blink, and the sprout leaves swaying — it looks soft even before you touch it.', [
    tr(blob, 'transform.scaleY', [[0, 1], [1.4, 1.03], [2.8, 1]]),
    tr(blob, 'transform.scaleX', [[0, 1], [1.4, 0.985], [2.8, 1]]),
    tr(eyesG, 'transform.scaleY', [[0, 1, 'linear'], [1.9, 1, 'easeIn'], [1.97, 0.08, 'easeOut'], [2.08, 1, 'linear'], [2.8, 1]]),
    tr(leaves[0], 'transform.rotation', [[0, 28], [1.4, 18], [2.8, 28]]),
    tr(leaves[1], 'transform.rotation', [[0, -24], [1.4, -14], [2.8, -24]]),
  ]);
  const grab = anim('Grab', 0.2, 'once', 'When grabbed it squeezes its eyes shut and gasps — a quick, readable reaction before the stretch takes over.', [
    ...eyes.map((e) => tr(e, 'props.height', [[0, 38, 'expoOut'], [0.12, 8]])),
    ...eyes.map((e) => tr(e, 'props.width', [[0, 28, 'expoOut'], [0.12, 36]])),
    ...glints.map((g) => tr(g, 'opacity', [[0, 1], [0.06, 0]])),
    tr(mouth, 'props.height', [[0, 14, 'backOut'], [0.18, 34]]),
    tr(mouth, 'props.width', [[0, 30, 'backOut'], [0.18, 34]]),
    ...cheeks.map((c) => tr(c, 'transform.scale', [[0, 1, 'backOut'], [0.18, 1.25]])),
  ]);
  const letGo = anim('Let go', 0.7, 'once', 'On release the springs (see the Drag sliders’ “bounce”) pull the body home with an overshoot. This move only handles the face: the eyes pop open wider than normal, then settle — follow-through on the details.', [
    ...eyes.map((e) => tr(e, 'props.height', [[0, 8, 'backOut'], [0.18, 46], [0.5, 38]])),
    ...eyes.map((e) => tr(e, 'props.width', [[0, 36, 'backOut'], [0.18, 24], [0.5, 28]])),
    ...glints.map((g) => tr(g, 'opacity', [[0.08, 0], [0.18, 1]])),
    tr(mouth, 'props.height', [[0, 34], [0.4, 14]]),
    tr(mouth, 'props.width', [[0, 34], [0.4, 30]]),
    ...cheeks.map((c) => tr(c, 'transform.scale', [[0, 1.25], [0.6, 1]])),
  ]);
  const curious = anim('Curious', 0.35, 'once', 'Hover: the eyes grow a little — it knows you are there.', [
    tr(eyesG, 'transform.scale', [[0, 1, 'backOut'], [0.3, 1.14]]),
  ]);

  // Dragging: the sliders follow the pointer only while the body is held, and spring home on release.
  const dragX = follower('Drag X', 'pointerX', { drag: body, smoothing: 0.4, bounce: 0.6 });
  const dragY = follower('Drag Y', 'pointerY', { drag: body, smoothing: 0.4, bounce: 0.6 });
  const whip = follower('Sprout lag', 'pointerX', { drag: body, smoothing: 0.72, bounce: 0.8 });
  const W = r.W, H = r.H;
  return finish(r, {
    name: 'Mochi', category: 'Characters', background: '#ffe8ee', duration: 2.8,
    description: 'A squishy character you can grab and stretch. Let go and it springs back, wobbles and settles — its sprout settles last.',
    tags: ['character', 'drag', 'elastic', 'spring', 'squash-and-stretch'],
    exposed: [
      param('skin', 'Body colour', 'The body and feet.', 'color', [[body, 'props.fill.color'], ...r.layers.filter((l) => l.name.startsWith('Foot')).map((l) => [l, 'props.fill.color'] as [Layer, string])], SKIN),
      param('cheeks', 'Cheek colour', 'Both cheeks.', 'color', cheeks.map((c) => [c, 'props.fill.color'] as [Layer, string]), PINK),
      param('leaf', 'Sprout colour', 'The two leaves.', 'color', leaves.map((l) => [l, 'props.fill.color'] as [Layer, string]), LEAF),
    ],
    machine: {
      inputs: [dragX, dragY, whip], animations: [idle, grab, letGo, curious],
      bindings: [
        // It leans and slides toward the pull, but less than the pointer moves: it resists.
        link(dragX, blob, 'transform.rotation', [-1, 1], [-26, 26]),
        link(dragX, blob, 'transform.x', [-1, 1], [-80 / W, 80 / W]),
        // Pulling up stretches it tall and thin; pushing down squashes it wide (it keeps its volume).
        link(dragY, blob, 'transform.scaleY', [-1, 1], [0.55, -0.34]),
        link(dragY, blob, 'transform.scaleX', [-1, 1], [-0.24, 0.3]),
        link(dragX, face, 'transform.x', [-1, 1], [-30 / W, 30 / W]),
        link(dragY, face, 'transform.y', [-1, 1], [-22 / H, 22 / H]),
        link(whip, sprout, 'transform.rotation', [-1, 1], [42, -42]),
      ],
      rules: [
        rule({ type: 'start' }, [], play(idle)),
        rule(onPointer('down', body), [], play(grab), sound('squish', 0.6)),
        rule(onPointer('up', body), [], play(letGo), sound('boing', 0.45)),
        rule(onPointer('enter', body), [], playOn(curious)),
        rule(onPointer('leave', body), [], playBack(curious)),
      ],
    },
  });
}
