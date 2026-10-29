import type { SceneDocument } from '../../scene/schema';
import { Rig, after, anim, fire, finish, input, onPointer, param, play, ring, rule, sound, tr } from './rig';

/**
 * Reward badge. A hexagonal achievement badge (white border, green face, gold banner, number and
 * stars) against slowly turning rays. Celebrate: it ducks and tilts
 * (anticipation), flips twice like a tossed coin (stretching its width to near zero fakes the turn in
 * 2D), pops, the rays flare, confetti arcs out and falls, and the title bounces in.
 */
export function rewardBadge(): SceneDocument {
  const r = new Rig(1080, 1080);
  // Achievement-badge language: a white-bordered hexagon, a two-tone green face, a gold banner,
  // a big number and three stars, on warm paper with a soft drop shadow.
  const BG = '#f3efe6', RAY1 = '#ece6d8', RAY2 = '#f0ebdf', GREEN_T = '#2fbf7a', GREEN_B = '#169a5c', GREEN_DEEP = '#0f7a48';
  const GOLD = '#ffcd4a', GOLD_DARK = '#e9a826', STAR = '#ffe08a', TITLE = '#1d2b24';
  const CONF = ['#ff6b81', '#ffcd4a', '#2fbf7a', '#6d8dff', '#1d2b24'];
  const C = { x: 540, y: 450 };

  r.shape('Glow', 'ellipse', { x: C.x, y: C.y }, { w: 980, h: 980, color: '#fbf9f4', fill: 'radial' }).props.fill.color2 = BG;
  const raysOuter = r.group('Rays', C);
  const raysSpin = r.group('Ray spin', C, raysOuter);
  ring(C.x, C.y, 330, 16).forEach(([x, y, a], i) => r.shape(`Ray ${i + 1}`, 'polygon', { x, y }, { w: 130, h: 420, sides: 3, color: i % 2 ? RAY1 : RAY2, rotation: a - 90, parent: raysSpin }));

  const float = r.group('Float', C);
  const medal = r.group('Medal', C, float);
  // The shadow turns with the badge, so the coin flip never leaves it behind.
  r.shape('Badge shadow', 'polygon', { x: C.x + 6, y: C.y + 26 }, { w: 420, h: 420, sides: 6, color: '#2a2418', opacity: 0.1, rotation: 30, parent: medal });
  const outer = r.shape('Badge border', 'polygon', C, { w: 420, h: 420, sides: 6, color: '#ffffff', rotation: 30, parent: medal });
  const face = r.shape('Badge face', 'polygon', C, { w: 366, h: 366, sides: 6, color: GREEN_T, fill: 'linear', rotation: 30, parent: medal });
  face.props.fill.color2 = GREEN_B; face.props.fill.angle = 90;
  r.shape('Inner line', 'polygon', C, { w: 326, h: 326, sides: 6, color: '#ffffff', fill: 'none', stroke: '#ffffff', strokeW: 3, opacity: 0.35, rotation: 30, parent: medal });
  // Banner with folded tails tucked behind it.
  [-1, 1].forEach((side) => r.shape(side < 0 ? 'Tail left' : 'Tail right', 'rect', { x: C.x + side * 160, y: C.y - 68 }, { w: 64, h: 58, radius: 6, color: GOLD_DARK, parent: medal }));
  const banner = r.shape('Banner', 'rect', { x: C.x, y: C.y - 82 }, { w: 300, h: 70, radius: 10, color: GOLD, fill: 'linear', parent: medal });
  banner.props.fill.color2 = GOLD_DARK; banner.props.fill.angle = 90;
  const label = r.text('Banner label', 'LEVEL', { x: C.x, y: C.y - 82 }, { size: 40, color: GREEN_DEEP, weight: 700, font: 'Clash Display', tracking: 0.08, parent: medal });
  const number = r.text('Number', '7', { x: C.x, y: C.y + 46 }, { size: 190, color: '#ffffff', weight: 700, font: 'Clash Display', parent: medal });
  const star = r.shape('Star', 'star', { x: C.x, y: C.y + 150 }, { w: 44, h: 44, sides: 5, inner: 0.47, color: STAR, parent: medal });
  [-1, 1].forEach((side) => r.shape(side < 0 ? 'Star left' : 'Star right', 'star', { x: C.x + side * 46, y: C.y + 142 }, { w: 30, h: 30, sides: 5, inner: 0.47, color: STAR, rotation: side * 12, parent: medal }));
  r.shape('Shine', 'ellipse', { x: C.x - 92, y: C.y - 132 }, { w: 80, h: 24, color: '#ffffff', rotation: -32, opacity: 0.35, parent: medal });
  const twinkles = [[C.x + 220, C.y - 170, 46], [C.x - 236, C.y + 30, 30], [C.x + 190, C.y + 190, 24]].map(([x, y, d], i) => r.shape(`Twinkle ${i + 1}`, 'star', { x, y }, { w: d, h: d, sides: 4, inner: 0.3, color: GOLD, parent: float }));

  const title = r.text('Title', 'Level up!', { x: 540, y: 880 }, { size: 88, color: TITLE, weight: 700, font: 'Clash Display' });
  const confetti = Array.from({ length: 18 }, (_, i) => {
    const a = (-165 + (i * 150) / 17) * (Math.PI / 180);
    const dist = 270 + (i % 4) * 50;
    const l = r.shape(`Confetti ${i + 1}`, i % 3 === 0 ? 'ellipse' : 'rect', C, { w: i % 3 === 0 ? 18 : 26, h: i % 3 === 0 ? 18 : 11, radius: 3, color: CONF[i % 5], opacity: 0, rotation: i * 23 });
    return { l, peak: { x: C.x + Math.cos(a) * dist, y: C.y + Math.sin(a) * dist }, land: { x: C.x + Math.cos(a) * dist * 1.15, y: C.y + Math.sin(a) * dist + 380 } };
  });
  const touch = r.shape('Touch area', 'ellipse', C, { w: 460, h: 460, color: GOLD, fill: 'none', locked: true });

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
    tr(face, 'props.fill.color', [[0.2, GREEN_T, 'step'], [0.32, '#5fd99c', 'step'], [0.44, GREEN_T, 'step'], [0.56, '#5fd99c', 'step'], [0.7, GREEN_T]]),
    tr(number, 'transform.scale', [[0.7, 1, 'easeIn'], [0.78, 0.8, 'backOut'], [1.05, 1.1, 'easeInOut'], [1.3, 1]]),
    tr(banner, 'transform.scaleX', [[0.75, 1, 'easeOut'], [0.85, 1.08, 'easeInOut'], [1.05, 1]]),
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
    description: 'An achievement badge that ducks, flips like a tossed coin, pops and showers confetti when you earn it.',
    tags: ['reward', 'badge', 'confetti', 'trigger', 'gamification'],
    exposed: [
      param('title', 'Title', 'The words under the medal.', 'text', [[title, 'props.text']], 'Level up!', 'Content'),
      param('number', 'Number', 'The big number on the badge.', 'text', [[number, 'props.text']], '7', 'Content'),
      param('label', 'Banner', 'The word on the banner.', 'text', [[label, 'props.text']], 'LEVEL', 'Content'),
      param('face', 'Badge colour', 'The top of the badge face.', 'color', [[face, 'props.fill.color']], GREEN_T),
      param('banner', 'Banner colour', 'The gold banner.', 'color', [[banner, 'props.fill.color']], GOLD),
      param('border', 'Border colour', 'The badge’s outline.', 'color', [[outer, 'props.fill.color']], '#ffffff'),
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
