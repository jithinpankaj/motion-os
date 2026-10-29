import type { Layer, SceneDocument } from '../../scene/schema';
import { Rig, after, anim, finish, input, link, param, play, playBack, ring, rule, sound, tr } from './rig';

/**
 * Lesson stars. A lesson-complete card driven by one number, Score (0–100), the way a learning app
 * shows how you did: the bar fills with the score, and every 20 points earns a star (20 = one star,
 * 100 = five). Each star pops in on its own (anticipation, overshoot, a ring of sparkle) and dims
 * again if the score drops below its line. Reaching 100 swaps the title and throws confetti.
 */
export function lessonStars(): SceneDocument {
  const r = new Rig(1080, 1080);
  const BG = '#eef6e6', CARD = '#ffffff', INK = '#1f2d24', MUTED = '#8a968d', TRACK = '#e4ebe0', FILL = '#58cc02', FILL_DARK = '#46a302';
  const GOLD = '#ffc800', GOLD_DARK = '#e5a500', DIM = '#e3e6e1';
  const CONF = ['#58cc02', '#ffc800', '#1cb0f6', '#ff4b4b', '#ce82ff'];

  r.shape('Card shadow', 'rect', { x: 540, y: 562 }, { w: 820, h: 700, radius: 56, color: '#cfdcc6' });
  r.shape('Card', 'rect', { x: 540, y: 540 }, { w: 820, h: 700, radius: 56, color: CARD });
  const title = r.text('Title', 'Lesson complete', { x: 540, y: 300 }, { size: 64, color: INK, weight: 800, font: 'Cabinet Grotesk' });
  const perfect = r.text('Perfect title', 'Perfect lesson!', { x: 540, y: 300 }, { size: 64, color: FILL_DARK, weight: 800, font: 'Cabinet Grotesk' });
  perfect.opacity = 0;
  r.text('Hint', 'Every 20 points earns a star', { x: 540, y: 376 }, { size: 32, color: MUTED, weight: 500, font: 'Cabinet Grotesk' });

  // Five stars: a dim outline you haven't earned yet, and a gold star that pops in on top of it.
  const T = [20, 40, 60, 80, 100];
  const stars = T.map((_, i) => {
    const c = { x: 540 + (i - 2) * 132, y: 540 };
    r.shape(`Star ${i + 1} slot`, 'star', c, { w: 112, h: 112, sides: 5, inner: 0.5, color: DIM });
    const g = r.group(`Star ${i + 1}`, c);
    const sparks = ring(c.x, c.y, 58, 6).map(([x, y, a], k) => r.shape(`Spark ${i + 1}.${k + 1}`, 'ellipse', { x, y }, { w: 10, h: 10, color: GOLD, opacity: 0, rotation: a }));
    const back = r.shape(`Star ${i + 1} edge`, 'star', { x: c.x, y: c.y + 5 }, { w: 116, h: 116, sides: 5, inner: 0.5, color: GOLD_DARK, parent: g });
    const face = r.shape(`Star ${i + 1} gold`, 'star', c, { w: 112, h: 112, sides: 5, inner: 0.5, color: GOLD, parent: g });
    r.shape(`Star ${i + 1} shine`, 'ellipse', { x: c.x - 14, y: c.y - 16 }, { w: 22, h: 12, color: '#ffffff', opacity: 0.6, rotation: -30, parent: g });
    g.transform.scale = 0.01;
    return { g, c, sparks, back, face };
  });

  // Progress bar: the fill is a group pinned at the bar's left end, so stretching it reads as filling.
  const BAR = { x: 540, y: 700, w: 620, h: 34 };
  r.shape('Track', 'rect', { x: BAR.x, y: BAR.y }, { w: BAR.w, h: BAR.h, radius: BAR.h / 2, color: TRACK });
  const fill = r.group('Fill', { x: BAR.x - BAR.w / 2, y: BAR.y });
  const bar = r.shape('Fill bar', 'rect', { x: BAR.x, y: BAR.y }, { w: BAR.w, h: BAR.h, radius: BAR.h / 2, color: FILL, parent: fill });
  r.shape('Fill shine', 'rect', { x: BAR.x, y: BAR.y - 7 }, { w: BAR.w - 30, h: 7, radius: 3.5, color: '#ffffff', opacity: 0.35, parent: fill });
  fill.transform.scaleX = 0.01;
  fill.opacity = 0;
  [0, 20, 40, 60, 80, 100].forEach((v) => r.text(`Mark ${v}`, String(v), { x: BAR.x - BAR.w / 2 + (v / 100) * BAR.w, y: 754 }, { size: 22, color: MUTED, weight: 500, font: 'Cabinet Grotesk' }));

  const confetti = Array.from({ length: 18 }, (_, i) => {
    const a = (-170 + (i * 160) / 17) * (Math.PI / 180), d = 260 + (i % 3) * 70;
    const l = r.shape(`Confetti ${i + 1}`, i % 3 ? 'rect' : 'ellipse', { x: 540, y: 540 }, { w: i % 3 ? 24 : 18, h: i % 3 ? 11 : 18, radius: 3, color: CONF[i % 5], opacity: 0, rotation: i * 29 });
    return { l, to: { x: 540 + Math.cos(a) * d, y: 540 + Math.sin(a) * d * 0.8 }, land: { x: 540 + Math.cos(a) * d * 1.1, y: 540 + Math.sin(a) * d * 0.8 + 320 } };
  });

  const earn = stars.map(({ g, sparks, face }, i) => anim(`Star ${i + 1}`, 0.7, 'once', 'Anticipation, then overshoot: the gold star grows past full size while turning back from a tilt, settles, and a ring of sparks flies out and fades. Played backwards it shrinks away, so losing a star looks like the reverse of earning it.', [
    tr(g, 'transform.scale', [[0, 0.01, 'backOut'], [0.38, 1.22, 'easeInOut'], [0.55, 1]]),
    tr(g, 'transform.rotation', [[0, -40, 'backOut'], [0.45, 0]]),
    tr(face, 'props.fill.color', [[0, '#fff2b3', 'easeOut'], [0.4, GOLD]]),
    ...sparks.flatMap((s) => {
      const dx = s.transform.x - g.transform.x, dy = s.transform.y - g.transform.y;
      return [
        tr(s, 'opacity', after(0.18, [[0, 0], [0.04, 1], [0.45, 0]])),
        tr(s, 'transform.x', after(0.18, [[0, s.transform.x, 'expoOut'], [0.45, +(s.transform.x + dx * 0.9).toFixed(5)]])),
        tr(s, 'transform.y', after(0.18, [[0, s.transform.y, 'expoOut'], [0.45, +(s.transform.y + dy * 0.9).toFixed(5)]])),
      ];
    }),
  ]));
  const party = anim('Perfect', 1.6, 'once', 'At 100 the title cross-fades to “Perfect lesson!” with a bounce, the bar flashes, and confetti arcs up and falls with gravity.', [
    tr(title, 'opacity', [[0, 1], [0.2, 0]]),
    tr(perfect, 'opacity', [[0.1, 0], [0.3, 1]]),
    tr(perfect, 'transform.scale', [[0.1, 0.7, 'backOut'], [0.45, 1.08, 'easeInOut'], [0.7, 1]]),
    tr(bar, 'props.fill.color', [[0.1, FILL, 'easeOut'], [0.3, '#8ee000', 'easeInOut'], [0.8, FILL]]),
    ...confetti.flatMap(({ l, to, land }, i) => {
      const t0 = 0.15 + (i % 4) * 0.03;
      return [
        tr(l, 'opacity', after(t0, [[0, 0], [0.03, 1], [1.0, 1], [1.3, 0]])),
        tr(l, 'transform.x', after(t0, [[0, l.transform.x, 'easeOut'], [0.45, to.x / r.W, 'linear'], [1.3, land.x / r.W]])),
        tr(l, 'transform.y', after(t0, [[0, l.transform.y, 'easeOut'], [0.45, to.y / r.H, 'easeIn'], [1.3, land.y / r.H]])),
        tr(l, 'transform.rotation', after(t0, [[0, l.transform.rotation, 'linear'], [1.3, l.transform.rotation + (i % 2 ? 400 : -360)]])),
      ];
    }),
  ]);

  const score = { ...input('Score', 'number', 0), min: 0, max: 100, description: 'Type or drag a score from 0 to 100. Every 20 points earns a star.' };
  return finish(r, {
    name: 'Lesson stars', category: 'Interactive UI', background: BG, duration: 1.6,
    description: 'A lesson-complete card driven by one number: the bar fills with the score, and every 20 points earns a star (100 = five stars).',
    tags: ['progress', 'stars', 'score', 'gamification', 'input', 'number'],
    exposed: [
      param('title', 'Title', 'The heading on the card.', 'text', [[title, 'props.text']], 'Lesson complete', 'Content'),
      param('star', 'Star colour', 'Every earned star.', 'color', stars.map((s) => [s.face, 'props.fill.color'] as [Layer, string]), GOLD),
      param('bar', 'Bar colour', 'The progress fill.', 'color', [[bar, 'props.fill.color']], FILL),
    ],
    machine: {
      inputs: [score], animations: [...earn, party],
      // The bar follows the score; it fades in over the first few points so 0 shows an empty track.
      bindings: [link(score, fill, 'transform.scaleX', [0, 100], [0.01, 1], false), link(score, fill, 'opacity', [0, 3], [0, 1], false)],
      rules: [
        ...T.flatMap((t, i) => [
          rule({ type: 'number', inputId: score.id, op: '>=', value: t }, [], play(earn[i]), sound(i === 4 ? 'chime' : 'pop', 0.45)),
          rule({ type: 'number', inputId: score.id, op: '<', value: t }, [], playBack(earn[i])),
        ]),
        rule({ type: 'number', inputId: score.id, op: '>=', value: 100 }, [], play(party), sound('success', 0.55)),
        rule({ type: 'number', inputId: score.id, op: '<', value: 100 }, [], playBack(party)),
      ],
    },
  });
}
