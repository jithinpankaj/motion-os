import type { Layer, SceneDocument } from '../../scene/schema';
import { Rig, after, anim, finish, input, is, onPointer, param, play, playBack, playOn, ring, rule, sound, toggle, tr } from './rig';

/**
 * Like burst. A heart built from two circles and a turned square. Liking it squashes it
 * (anticipation), pops it with a colour change, sends out a ring and a burst of confetti, and rolls
 * the counter up a number. Unliking is calm: the colour drains and the number rolls back.
 */
export function likeBurst(): SceneDocument {
  const r = new Rig(1080, 1080);
  const OFF = '#d9cfd8', RED = '#ff3b5c', INK = '#3a2233';
  const BITS = ['#ff3b5c', '#ffb000', '#7b61ff', '#2bb673'];
  const C = { x: 540, y: 500 };

  const burstRing = r.shape('Ring', 'ellipse', C, { w: 250, h: 250, color: RED, fill: 'none', stroke: RED, strokeW: 16, opacity: 0 });
  const bits = ring(C.x, C.y, 150, 10, -90).map(([x, y, a], i) => {
    const l = r.shape(`Spark ${i + 1}`, i % 2 ? 'polygon' : 'ellipse', { x, y }, { w: i % 2 ? 26 : 22, h: i % 2 ? 26 : 22, sides: 3, color: BITS[i % 4], rotation: a + 90, opacity: 0 });
    const rad = (a * Math.PI) / 180;
    return { l, to: { x: C.x + Math.cos(rad) * 290, y: C.y + Math.sin(rad) * 290 } };
  });
  const heart = r.group('Heart', { x: C.x, y: C.y + 20 });
  const parts = [
    r.shape('Heart left', 'ellipse', { x: C.x - 58, y: C.y - 30 }, { w: 172, h: 172, color: OFF, parent: heart }),
    r.shape('Heart right', 'ellipse', { x: C.x + 58, y: C.y - 30 }, { w: 172, h: 172, color: OFF, parent: heart }),
    r.shape('Heart point', 'rect', { x: C.x, y: C.y + 32 }, { w: 160, h: 160, radius: 14, color: OFF, rotation: 45, parent: heart }),
  ];
  r.shape('Shine', 'ellipse', { x: C.x - 86, y: C.y - 64 }, { w: 42, h: 24, color: '#ffffff', rotation: -40, opacity: 0.75, parent: heart });

  const before = r.text('Count', '128', { x: C.x, y: 790 }, { size: 66, color: INK, weight: 800, font: 'Cabinet Grotesk' });
  const afterT = r.text('Count +1', '129', { x: C.x, y: 790 }, { size: 66, color: RED, weight: 800, font: 'Cabinet Grotesk' });
  afterT.opacity = 0;
  const cy = before.transform.y;

  const like = anim('Like', 1.1, 'once', 'Anticipation: the heart squashes for 0.08 s before it pops to 130 % and settles with a spring. The ring and sparks fire as it pops and fly out with a fast-then-slow ease, fading as they go. The counter rolls: the old number slides up and out while the new one slides in from below.', [
    tr(heart, 'transform.scaleX', [[0, 1, 'easeOut'], [0.08, 1.12, 'backOut'], [0.26, 1.3, 'easeInOut'], [0.5, 0.95, 'easeInOut'], [0.7, 1]]),
    tr(heart, 'transform.scaleY', [[0, 1, 'easeOut'], [0.08, 0.84, 'backOut'], [0.26, 1.3, 'easeInOut'], [0.5, 0.95, 'easeInOut'], [0.7, 1]]),
    ...parts.map((p) => tr(p, 'props.fill.color', [[0.06, OFF], [0.18, RED]])),
    tr(burstRing, 'transform.scale', [[0.12, 0.8, 'expoOut'], [0.6, 2.1]]),
    tr(burstRing, 'opacity', [[0.12, 0], [0.16, 0.9], [0.6, 0]]),
    tr(burstRing, 'props.stroke.width', [[0.12, 16, 'easeOut'], [0.6, 2]]),
    ...bits.flatMap(({ l, to }, i) => [
      tr(l, 'opacity', after(0.14 + (i % 3) * 0.02, [[0, 0], [0.04, 1], [0.55, 0]])),
      tr(l, 'transform.x', after(0.14 + (i % 3) * 0.02, [[0, l.transform.x, 'expoOut'], [0.55, to.x / r.W]])),
      tr(l, 'transform.y', after(0.14 + (i % 3) * 0.02, [[0, l.transform.y, 'expoOut'], [0.55, to.y / r.H]])),
      tr(l, 'transform.scale', after(0.14 + (i % 3) * 0.02, [[0, 1, 'easeIn'], [0.55, 0.3]])),
    ]),
    tr(before, 'transform.y', [[0.15, cy, 'easeIn'], [0.4, r.dy(before, -50)]]),
    tr(before, 'opacity', [[0.15, 1], [0.35, 0]]),
    tr(afterT, 'transform.y', [[0.25, r.dy(afterT, 50), 'backOut'], [0.55, cy]]),
    tr(afterT, 'opacity', [[0.25, 0], [0.45, 1]]),
  ]);
  const unlike = anim('Unlike', 0.5, 'once', 'Undoing a like is calm: the colour drains, a small shrink, and the number rolls back down.', [
    ...parts.map((p) => tr(p, 'props.fill.color', [[0, RED], [0.3, OFF]])),
    tr(heart, 'transform.scaleX', [[0, 1, 'easeOut'], [0.15, 0.9, 'easeInOut'], [0.4, 1]]),
    tr(heart, 'transform.scaleY', [[0, 1, 'easeOut'], [0.15, 0.9, 'easeInOut'], [0.4, 1]]),
    tr(afterT, 'transform.y', [[0, cy, 'easeIn'], [0.25, r.dy(afterT, 50)]]),
    tr(afterT, 'opacity', [[0, 1], [0.2, 0]]),
    tr(before, 'transform.y', [[0.1, r.dy(before, -50), 'easeOut'], [0.4, cy]]),
    tr(before, 'opacity', [[0.1, 0], [0.3, 1]]),
  ]);
  const hover = anim('Hover', 0.3, 'once', 'The heart grows a little under the pointer.', [tr(heart, 'transform.scale', [[0, 1, 'backOut'], [0.3, 1.08]])]);

  const liked = input('Liked', 'boolean', false);
  const hit = parts[2];
  return finish(r, {
    name: 'Like burst', category: 'Celebrations', background: '#fff0f3', duration: 1,
    description: 'A heart that squashes, pops, bursts into sparks and rolls its counter up when you like it.',
    tags: ['like', 'heart', 'toggle', 'burst', 'counter'],
    exposed: [
      param('liked', 'Liked colour', 'The heart and ring when liked, and the new count.', 'color', [[burstRing, 'props.stroke.color'], [afterT, 'props.color']], RED),
      param('count', 'Count before', 'The number before liking.', 'text', [[before, 'props.text']], '128', 'Content'),
      param('count2', 'Count after', 'The number after liking.', 'text', [[afterT, 'props.text']], '129', 'Content'),
      param('sparks', 'Spark colour', 'Half of the sparks.', 'color', bits.filter((_, i) => i % 4 === 1).map((b) => [b.l, 'props.fill.color'] as [Layer, string]), BITS[1]),
    ],
    machine: {
      inputs: [liked], animations: [like, unlike, hover], bindings: [],
      rules: [
        ...parts.map((p) => rule(onPointer('click', p), [], toggle(liked))),
        rule(is(liked, true), [], play(like), sound('pop', 0.55), sound('sparkle', 0.35)),
        rule(is(liked, false), [], play(unlike), sound('tick', 0.4)),
        rule(onPointer('enter', hit), [], playOn(hover)),
        rule(onPointer('leave', hit), [], playBack(hover)),
      ],
    },
  });
}
