import type { Layer, SceneDocument } from '../../scene/schema';
import { Rig, after, anim, fire, finish, input, onPointer, param, play, ring, rule, sound, tr } from './rig';

/**
 * Reward badge. A gold medal on ribbons against slowly turning rays. Celebrate: it ducks and tilts
 * (anticipation), flips twice like a tossed coin (stretching its width to near zero fakes the turn in
 * 2D), pops, the rays flare, confetti arcs out and falls, and the title bounces in.
 */
export function rewardBadge(): SceneDocument {
  const r = new Rig(1080, 1080);
  const BG = '#1f1b3d', RAY1 = '#2b2660', RAY2 = '#352f73', GOLD = '#ffc83d', GOLD_DARK = '#eea524', GOLD_LIGHT = '#ffd968', STAR = '#fff3c4', RIB1 = '#ff5d7a', RIB2 = '#e2486a', TITLE = '#fff3c4';
  const CONF = ['#ff5d7a', '#ffc83d', '#4dd4ac', '#7b9bff', '#ffffff'];
  const C = { x: 540, y: 470 };

  const raysOuter = r.group('Rays', C);
  const raysSpin = r.group('Ray spin', C, raysOuter);
  ring(C.x, C.y, 330, 16).forEach(([x, y, a], i) => r.shape(`Ray ${i + 1}`, 'polygon', { x, y }, { w: 150, h: 420, sides: 3, color: i % 2 ? RAY1 : RAY2, rotation: a - 90, parent: raysSpin }));

  const float = r.group('Float', C);
  // Ribbon tails with a notch cut by painting a background-coloured triangle over their ends.
  [-1, 1].forEach((side) => {
    const x = C.x + side * 64;
    r.shape(side < 0 ? 'Ribbon left' : 'Ribbon right', 'rect', { x, y: 660 }, { w: 92, h: 270, radius: 6, color: side < 0 ? RIB1 : RIB2, rotation: side * 14, parent: float });
    r.shape('Ribbon notch', 'polygon', { x: x + side * 32, y: 806 }, { w: 70, h: 70, sides: 3, color: BG, rotation: side * 14, parent: float });
  });
  const medal = r.group('Medal', C, float);
  const outer = r.shape('Medal rim', 'ellipse', C, { w: 330, h: 330, color: GOLD, parent: medal });
  r.shape('Medal ring', 'ellipse', C, { w: 272, h: 272, color: GOLD_DARK, parent: medal });
  const face = r.shape('Medal face', 'ellipse', C, { w: 246, h: 246, color: GOLD_LIGHT, parent: medal });
  const star = r.shape('Star', 'star', { x: C.x, y: C.y + 6 }, { w: 150, h: 150, sides: 5, inner: 0.47, color: STAR, parent: medal });
  r.shape('Shine', 'ellipse', { x: C.x - 76, y: C.y - 86 }, { w: 70, h: 30, color: '#ffffff', rotation: -40, opacity: 0.55, parent: medal });
  const twinkles = [[C.x + 190, C.y - 150, 46], [C.x - 210, C.y + 40, 30], [C.x + 160, C.y + 170, 24]].map(([x, y, d], i) => r.shape(`Twinkle ${i + 1}`, 'star', { x, y }, { w: d, h: d, sides: 4, inner: 0.35, color: STAR, parent: float }));

  const title = r.text('Title', 'Level up!', { x: 540, y: 900 }, { size: 96, color: TITLE, weight: 700, font: 'Clash Display' });
  const confetti = Array.from({ length: 16 }, (_, i) => {
    const a = (-160 + (i * 140) / 15) * (Math.PI / 180);
    const dist = 260 + (i % 4) * 50;
    const l = r.shape(`Confetti ${i + 1}`, i % 3 === 0 ? 'ellipse' : 'rect', C, { w: i % 3 === 0 ? 20 : 26, h: i % 3 === 0 ? 20 : 12, radius: 3, color: CONF[i % 5], opacity: 0, rotation: i * 23 });
    return { l, peak: { x: C.x + Math.cos(a) * dist, y: C.y + Math.sin(a) * dist }, land: { x: C.x + Math.cos(a) * dist * 1.15, y: C.y + Math.sin(a) * dist + 360 } };
  });
  const touch = r.shape('Touch area', 'ellipse', C, { w: 420, h: 420, color: GOLD, fill: 'none', locked: true });

  const fy = float.transform.y;
  const idle = anim('Idle', 4, 'loop', 'The rays turn exactly one ray-width per loop (22.5° for 16 rays), so the loop is seamless. The medal floats and the twinkles flash at different times.', [
    tr(raysSpin, 'transform.rotation', [[0, 0, 'linear'], [4, 22.5]]),
    tr(float, 'transform.y', [[0, fy], [2, r.dy(float, -12)], [4, fy]]),
    ...twinkles.map((t, i) => tr(t, 'transform.scale', [[0, 1], [0.6 + i * 1.1, 1, 'easeInOut'], [0.9 + i * 1.1, 0.3, 'easeInOut'], [1.2 + i * 1.1, 1], [4, 1]])),
  ]);
  const celebrate = anim('Celebrate', 2, 'once', 'Anticipation (it ducks and tilts back), then the coin-flip: squeezing the width to almost nothing and back reads as a turn in 2D. It pops past full size and settles. The rays flare a beat later, the confetti arcs up and falls with gravity (fast out, slowing at the top, speeding up as it drops), and the title bounces in last.', [
    tr(medal, 'transform.scale', [[0, 1, 'easeOut'], [0.15, 0.86, 'easeIn'], [0.3, 1, 'easeOut'], [0.75, 1.18, 'easeInOut'], [1.0, 0.96, 'easeInOut'], [1.2, 1]]),
    tr(medal, 'transform.rotation', [[0, 0, 'easeOut'], [0.15, -10, 'easeInOut'], [0.35, 0]]),
    tr(medal, 'transform.scaleX', [[0.2, 1, 'easeIn'], [0.32, 0.04, 'easeOut'], [0.44, 1, 'easeIn'], [0.56, 0.04, 'easeOut'], [0.7, 1]]),
    tr(face, 'props.fill.color', [[0.2, GOLD_LIGHT, 'step'], [0.32, '#fff0a8', 'step'], [0.44, GOLD_LIGHT, 'step'], [0.56, '#fff0a8', 'step'], [0.7, GOLD_LIGHT]]),
    tr(star, 'transform.rotation', [[0.6, 0, 'backOut'], [1.1, 72]]),
    tr(raysOuter, 'transform.scale', [[0.65, 1, 'expoOut'], [0.95, 1.22, 'easeInOut'], [1.8, 1]]),
    ...confetti.flatMap(({ l, peak, land }, i) => {
      const t0 = 0.7 + (i % 5) * 0.03;
      return [
        tr(l, 'opacity', after(t0, [[0, 0], [0.03, 1], [0.9, 1], [1.2, 0]])),
        tr(l, 'transform.x', after(t0, [[0, l.transform.x, 'easeOut'], [0.45, peak.x / r.W, 'linear'], [1.2, land.x / r.W]])),
        tr(l, 'transform.y', after(t0, [[0, l.transform.y, 'easeOut'], [0.45, peak.y / r.H, 'easeIn'], [1.2, land.y / r.H]])),
        tr(l, 'transform.rotation', after(t0, [[0, l.transform.rotation, 'linear'], [1.2, l.transform.rotation + (i % 2 ? 420 : -380)]])),
      ];
    }),
    tr(title, 'transform.scale', [[0.85, 1, 'easeIn'], [0.95, 0.7, 'backOut'], [1.25, 1.12, 'easeInOut'], [1.5, 1]]),
  ]);

  const go = input('Celebrate', 'trigger', false);
  return finish(r, {
    name: 'Reward badge', category: 'Celebrations', background: BG, duration: 4,
    description: 'A medal that ducks, flips like a tossed coin, pops and showers confetti when you earn it.',
    tags: ['reward', 'badge', 'confetti', 'trigger', 'gamification'],
    exposed: [
      param('title', 'Title', 'The words under the medal.', 'text', [[title, 'props.text']], 'Level up!', 'Content'),
      param('gold', 'Medal colour', 'The medal’s rim.', 'color', [[outer, 'props.fill.color']], GOLD),
      param('ribbon', 'Ribbon colour', 'The left ribbon.', 'color', [[r.layers.find((l) => l.name === 'Ribbon left')!, 'props.fill.color']], RIB1),
      param('rays', 'Ray colour', 'Every other ray.', 'color', r.layers.filter((l, i) => l.name.startsWith('Ray ') && i % 2 === 0).map((l) => [l, 'props.fill.color'] as [Layer, string]), RAY2),
    ],
    machine: {
      inputs: [go], animations: [idle, celebrate], bindings: [],
      rules: [
        rule({ type: 'start' }, [], play(idle)),
        rule(onPointer('click', touch), [], fire(go)),
        rule({ type: 'trigger', inputId: go.id }, [], play(celebrate), sound('success', 0.55)),
      ],
    },
  });
}
