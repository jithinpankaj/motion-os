import type { Layer, SceneDocument } from '../../scene/schema';
import { Rig, after, anim, finish, follower, input, is, link, onPointer, param, play, playBack, playOn, rule, sound, toggle, tr } from './rig';

/**
 * 04 · The blooming flower. A flat, editorial illustration — no outlines, layered tones, and petals
 * that are deliberately uneven in size, angle and colour. It sways from the pot, turns its head
 * toward the pointer, fans its petals on hover, and a click makes it bloom: petals open one after
 * another, the leaves lift, and pollen drifts up.
 */
export function bloomingFlower(): SceneDocument {
  const r = new Rig(1080, 1080);
  const SUN = '#efd9b8', POT = '#c9673f', RIM = '#db7a4f', POT_SHADE = '#b45a36', STEM = '#3f7d4e', LEAF1 = '#4f9460', LEAF2 = '#3c7a4b', RIB = '#86c08e';
  const PETALS = ['#f07a5a', '#f59a72', '#e8644a', '#f28462', '#f6a67c', '#ea6d4f', '#f38c66'];
  const BACK = '#cf5440', CENTRE = '#f4b63f', RING = '#e39a2b', SEED = '#7a4a1c';

  r.shape('Sun', 'ellipse', { x: 600, y: 430 }, { w: 600, h: 600, color: SUN });
  r.shape('Ground shadow', 'ellipse', { x: 540, y: 960 }, { w: 380, h: 36, color: '#3a2a1a', opacity: 0.12 });

  const plant = r.group('Plant', { x: 540, y: 780 });
  // Stem: three rounded pieces that bend slightly, joined by their round ends.
  [
    { x: 536, y: 694, h: 150, rot: -4 }, { x: 538, y: 566, h: 140, rot: 6 }, { x: 552, y: 454, h: 118, rot: 10 },
  ].map((p, i) => r.shape(`Stem ${i + 1}`, 'rect', p, { w: 18, h: p.h, radius: 9, color: STEM, rotation: p.rot, parent: plant }));
  const leafL = r.group('Leaf left', { x: 532, y: 664 }, plant);
  r.shape('Leaf', 'ellipse', { x: 452, y: 628 }, { w: 180, h: 66, color: LEAF1, rotation: 24, parent: leafL });
  r.shape('Leaf vein', 'rect', { x: 458, y: 631 }, { w: 120, h: 5, radius: 2.5, color: RIB, rotation: 24, opacity: 0.8, parent: leafL });
  const leafR = r.group('Leaf right', { x: 542, y: 574 }, plant);
  r.shape('Leaf', 'ellipse', { x: 618, y: 548 }, { w: 150, h: 58, color: LEAF2, rotation: -22, parent: leafR });
  r.shape('Leaf vein', 'rect', { x: 612, y: 551 }, { w: 100, h: 5, radius: 2.5, color: RIB, rotation: -22, opacity: 0.8, parent: leafR });

  // Flower head: back petals, front petals (each in its own group so it can open around the centre), centre.
  const C = { x: 562, y: 394 };
  const head = r.group('Flower', C, plant);
  const petalAt = (a: number, dist: number, w: number, h: number, color: string, name: string) => {
    const g = r.group(name, C, head);
    const rad = (a * Math.PI) / 180;
    r.shape('Petal', 'ellipse', { x: C.x + Math.cos(rad) * dist, y: C.y + Math.sin(rad) * dist }, { w, h, color, rotation: a + 90, parent: g });
    return g;
  };
  // Hand-tuned irregularity: angles, sizes and distances all vary a little.
  const backPetals = [-62, -10, 40, 92, 140, 190, 240].map((a, i) => petalAt(a + (i % 2 ? 4 : -3), 94 + (i % 3) * 6, 94 + (i % 2) * 10, 170 - (i % 3) * 12, BACK, `Back petal ${i + 1}`));
  const front = [{ a: -90, s: 1 }, { a: -38, s: 0.92 }, { a: 14, s: 1.06 }, { a: 64, s: 0.95 }, { a: 117, s: 1.02 }, { a: 166, s: 0.9 }, { a: 218, s: 1 }];
  const petals = front.map((p, i) => petalAt(p.a, 100 * p.s, 106 * p.s, 188 * p.s, PETALS[i], `Petal ${i + 1}`));
  const centre = r.group('Centre', C, head);
  r.shape('Centre', 'ellipse', C, { w: 128, h: 124, color: CENTRE, parent: centre });
  r.shape('Centre ring', 'ellipse', C, { w: 86, h: 84, color: RING, parent: centre });
  const seeds = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    return r.shape(`Seed ${i + 1}`, 'ellipse', { x: C.x + Math.cos(a) * 24, y: C.y + Math.sin(a) * 22 }, { w: 9, h: 9, color: SEED, parent: centre });
  });
  r.shape('Centre shine', 'ellipse', { x: C.x - 28, y: C.y - 34 }, { w: 24, h: 14, color: '#fff3d6', rotation: -30, opacity: 0.8, parent: centre });
  const pollen = [[-60, -150], [10, -190], [70, -140]].map(([dx, dy], i) => r.shape(`Pollen ${i + 1}`, 'ellipse', { x: C.x + dx * 0.2, y: C.y + dy * 0.2 }, { w: 20, h: 20, color: '#ffd45e', opacity: 0, parent: plant }));
  const pollenEnd = [[-60, -150], [10, -190], [70, -140]];

  // Pot in front of the stem base.
  r.shape('Pot', 'rect', { x: 540, y: 872 }, { w: 250, h: 170, radius: 34, color: POT });
  r.shape('Pot shade', 'rect', { x: 600, y: 880 }, { w: 90, h: 150, radius: 30, color: POT_SHADE, opacity: 0.55 });
  r.shape('Pot rim', 'rect', { x: 540, y: 786 }, { w: 296, h: 58, radius: 20, color: RIM });
  const touch = r.shape('Touch area', 'ellipse', C, { w: 520, h: 520, color: CENTRE, fill: 'none', locked: true });

  // ---------- moves ----------
  const CLOSED = 0.62;
  for (const g of [...petals, ...backPetals]) g.transform.scale = CLOSED; // it starts as a half-open bud
  const idle = anim('Sway', 4, 'loop', 'The plant sways from the pot, and the flower head follows a moment later and a little further — the lag between them is what makes it feel like a soft stem rather than a stiff stick.', [
    tr(plant, 'transform.rotation', [[0, -2], [2, 2], [4, -2]]),
    tr(head, 'transform.rotation', [[0, -2], [0.4, -2.5], [2.4, 3], [4, -2]]),
    tr(leafL, 'transform.rotation', [[0, 0], [2.2, -4], [4, 0]]),
    tr(leafR, 'transform.rotation', [[0, 0], [1.8, 4], [4, 0]]),
  ]);
  const fan = anim('Fan out', 0.5, 'once', 'On hover each petal turns a few degrees outward, one after another — a small, staggered reaction.', [
    ...petals.map((g, i) => tr(g, 'transform.rotation', after(i * 0.03, [[0, 0, 'backOut'], [0.3, i % 2 ? 5 : -5]]))),
  ]);
  const bloom = anim('Bloom', 1.6, 'once', 'Staggered: each petal starts 0.07 s after the previous one and overshoots a little before settling (a springy ease), so the flower opens like a ripple, never all at once. The centre pops first, the leaves lift as if pushed by the bloom, and pollen floats up last.', [
    tr(centre, 'transform.scale', [[0, 1, 'easeOut'], [0.1, 0.88, 'backOut'], [0.35, 1.18, 'easeInOut'], [0.7, 1]]),
    ...petals.map((g, i) => tr(g, 'transform.scale', after(0.08 + i * 0.07, [[0, CLOSED, 'easeOut'], [0.36, 1.08, 'easeInOut'], [0.62, 1]]))),
    ...backPetals.map((g, i) => tr(g, 'transform.scale', after(0.2 + i * 0.06, [[0, CLOSED, 'easeOut'], [0.4, 1.06, 'easeInOut'], [0.7, 1]]))),
    tr(leafL, 'transform.scale', [[0.2, 1, 'backOut'], [0.5, 1.12, 'easeInOut'], [0.9, 1.04]]),
    tr(leafR, 'transform.scale', [[0.26, 1, 'backOut'], [0.56, 1.12, 'easeInOut'], [0.96, 1.04]]),
    ...pollen.flatMap((p, i) => [
      tr(p, 'opacity', after(0.7 + i * 0.12, [[0, 0], [0.12, 1], [0.6, 0]])),
      tr(p, 'transform.y', after(0.7 + i * 0.12, [[0, p.transform.y, 'easeOut'], [0.7, r.dy(p, pollenEnd[i][1] * 0.8)]])),
      tr(p, 'transform.x', after(0.7 + i * 0.12, [[0, p.transform.x, 'easeOut'], [0.7, r.dx(p, pollenEnd[i][0] * 0.8)]])),
    ]),
  ]);
  const close = anim('Close', 0.9, 'once', 'Closing is quieter than blooming: the petals fold back in reverse order with a smooth ease and no overshoot.', [
    ...petals.map((g, i) => tr(g, 'transform.scale', after((petals.length - 1 - i) * 0.05, [[0, 1, 'easeInOut'], [0.5, CLOSED]]))),
    ...backPetals.map((g, i) => tr(g, 'transform.scale', after((backPetals.length - 1 - i) * 0.04, [[0, 1, 'easeInOut'], [0.5, CLOSED]]))),
    tr(leafL, 'transform.scale', [[0, 1.04], [0.5, 1]]),
    tr(leafR, 'transform.scale', [[0, 1.04], [0.5, 1]]),
  ]);

  const bloomed = input('Bloomed', 'boolean', false);
  const lookX = follower('Look X', 'pointerX', { smoothing: 0.85 }), lookY = follower('Look Y', 'pointerY', { smoothing: 0.85 });
  return finish(r, {
    name: 'Blooming flower', category: 'Illustrations', background: '#f4ede2', duration: 4,
    description: 'A flat, editorial flower that sways, turns toward your pointer and blooms petal by petal when clicked.',
    tags: ['illustration', 'flower', 'stagger', 'toggle'],
    exposed: [
      param('petal1', 'Petal colour', 'The main petals.', 'color', petals.filter((_, i) => i % 2 === 0).map((g) => [r.layers.find((l) => l.parentId === g.id)!, 'props.fill.color'] as [Layer, string]), PETALS[0]),
      param('petal2', 'Second petal colour', 'Every other petal.', 'color', petals.filter((_, i) => i % 2 === 1).map((g) => [r.layers.find((l) => l.parentId === g.id)!, 'props.fill.color'] as [Layer, string]), PETALS[1]),
      param('back', 'Inner petal colour', 'The petals behind.', 'color', backPetals.map((g) => [r.layers.find((l) => l.parentId === g.id)!, 'props.fill.color'] as [Layer, string]), BACK),
      param('pot', 'Pot colour', 'The pot.', 'color', [[r.layers.find((l) => l.name === 'Pot')!, 'props.fill.color']], POT),
      param('sun', 'Sun colour', 'The circle behind the flower.', 'color', [[r.layers.find((l) => l.name === 'Sun')!, 'props.fill.color']], SUN),
    ],
    machine: {
      inputs: [bloomed, lookX, lookY], animations: [idle, fan, bloom, close],
      bindings: [
        // The head turns toward the pointer (on top of the sway).
        link(lookX, head, 'transform.rotation', [-1, 1], [-12, 12]),
        link(lookX, head, 'transform.x', [-1, 1], [-18 / r.W, 18 / r.W]),
        link(lookY, head, 'transform.y', [-1, 1], [-10 / r.H, 10 / r.H]),
      ],
      rules: [
        rule({ type: 'start' }, [], play(idle)),
        rule(onPointer('click', touch), [], toggle(bloomed)),
        rule(is(bloomed, true), [], play(bloom), sound('sparkle', 0.45)),
        rule(is(bloomed, false), [], play(close)),
        rule(onPointer('enter', touch), [], playOn(fan)),
        rule(onPointer('leave', touch), [], playBack(fan)),
      ],
    },
  });
}

