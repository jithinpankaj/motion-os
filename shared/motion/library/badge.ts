import type { Layer, SceneDocument } from '../../scene/schema';
import { Rig, after, anim, fire, finish, input, onPointer, param, play, ring, rule, sound, tr, type Key } from './rig';

/**
 * Reward badge. A collectible medal in the spirit of game and fitness achievements: a scalloped gold
 * seal with a thick 3D lip, a bevelled rim, a violet gem face with a holographic sheen, an embossed
 * number, a crown of three chunky stars and a folded ribbon, on a dark stage with slow light rays.
 *
 * Idle: it floats, the rays turn, the stars bob out of step, sparkles twinkle and a glint sweeps
 * across the face now and then. Celebrate: it ducks (anticipation), flips twice like a tossed coin
 * (squeezing the width fakes the turn in 2D, and the face flashes as it goes edge-on), pops past full
 * size, the stars pop in one after another, the ribbon unfurls, rays flare and confetti falls.
 */
export function rewardBadge(): SceneDocument {
  const r = new Rig(1080, 1080);
  const BG = '#16102f', GLOW = '#3a2a86', RAY1 = '#1f1744', RAY2 = '#231a4d';
  const GOLD_HI = '#ffe796', GOLD = '#f6b52a', GOLD_DEEP = '#c9800f', LIP = '#8a4f06';
  const FACE_HI = '#9b63ff', FACE_LO = '#4a22c9', EMBOSS = '#2a1078';
  const RIB = '#ff4f78', RIB_LO = '#e02a55', RIB_DEEP = '#a3163a';
  const STAR_HI = '#fff0a6', STAR = '#ffc21f', STAR_LIP = '#c27c00';
  const INK = '#ffffff', SUB = '#b9aef0';
  const CONF = ['#ff4f78', '#ffc21f', '#3fd0a3', '#7b8cff', '#ffffff'];
  const C = { x: 540, y: 470 }, R = 200;

  // Stage: a soft violet glow and slow, low-contrast rays.
  r.shape('Glow', 'ellipse', { x: C.x, y: C.y + 20 }, { w: 1100, h: 1100, color: GLOW, fill: 'radial' }).props.fill.color2 = BG;
  const raysOuter = r.group('Rays', C);
  const raysSpin = r.group('Ray spin', C, raysOuter);
  ring(C.x, C.y, 360, 16).forEach(([x, y, a], i) => r.shape(`Ray ${i + 1}`, 'polygon', { x, y }, { w: 120, h: 480, sides: 3, color: i % 2 ? RAY1 : RAY2, rotation: a - 90, parent: raysSpin }));
  r.shape('Floor shadow', 'ellipse', { x: C.x, y: C.y + R + 66 }, { w: 300, h: 34, color: '#0b0820', opacity: 0.7 });

  // Confetti is drawn behind the medal, so it bursts out from behind it.
  const confetti = Array.from({ length: 22 }, (_, i) => {
    const a = (-168 + (i * 156) / 21) * (Math.PI / 180), dist = 280 + (i % 4) * 52;
    const l = r.shape(`Confetti ${i + 1}`, i % 3 === 0 ? 'ellipse' : 'rect', C, { w: i % 3 === 0 ? 18 : 26, h: i % 3 === 0 ? 18 : 11, radius: 3, color: CONF[i % 5], opacity: 0, rotation: i * 23 });
    return { l, peak: { x: C.x + Math.cos(a) * dist, y: C.y + Math.sin(a) * dist }, land: { x: C.x + Math.cos(a) * dist * 1.15, y: C.y + Math.sin(a) * dist + 380 } };
  });
  const float = r.group('Float', C);
  const medal = r.group('Medal', C, float);
  // Seal: a scalloped edge with a thick darker lip under it gives the chunky, dimensional look.
  r.shape('Seal lip', 'star', { x: C.x, y: C.y + 22 }, { w: R * 2 + 44, h: R * 2 + 44, sides: 12, inner: 0.88, color: LIP, parent: medal });
  const seal = r.shape('Seal', 'star', C, { w: R * 2 + 44, h: R * 2 + 44, sides: 12, inner: 0.88, color: GOLD_HI, fill: 'linear', parent: medal });
  seal.props.fill.color2 = GOLD_DEEP; seal.props.fill.angle = 90;
  const rim = r.shape('Rim', 'ellipse', C, { w: R * 2, h: R * 2, color: GOLD_HI, fill: 'radial', parent: medal });
  rim.props.fill.color2 = GOLD;
  // The bevel runs dark to light (the opposite of the rim) so the face reads as set into the medal.
  const bevel = r.shape('Bevel', 'ellipse', C, { w: R * 2 - 46, h: R * 2 - 46, color: GOLD_DEEP, fill: 'linear', parent: medal });
  bevel.props.fill.color2 = GOLD_HI; bevel.props.fill.angle = 90;
  const face = r.shape('Face', 'ellipse', { x: C.x, y: C.y + 2 }, { w: R * 2 - 72, h: R * 2 - 72, color: FACE_HI, fill: 'linear', parent: medal });
  face.props.fill.color2 = FACE_LO; face.props.fill.angle = 70;
  r.shape('Inner ring', 'ellipse', C, { w: R * 2 - 104, h: R * 2 - 104, color: '#ffffff', fill: 'none', stroke: '#ffffff', strokeW: 3, opacity: 0.28, parent: medal });
  r.shape('Sheen', 'ellipse', { x: C.x - 46, y: C.y - 82 }, { w: 230, h: 92, color: '#ffffff', rotation: -28, opacity: 0.13, parent: medal });
  const glint = r.shape('Glint', 'rect', { x: C.x - 150, y: C.y }, { w: 26, h: 250, radius: 13, color: '#ffffff', rotation: 28, opacity: 0, parent: medal });
  r.text('Level label', 'LEVEL', { x: C.x, y: C.y - 92 }, { size: 34, color: '#e9ddff', weight: 700, font: 'Cabinet Grotesk', tracking: 0.16, parent: medal });
  r.text('Number depth', '7', { x: C.x, y: C.y + 22 }, { size: 210, color: EMBOSS, weight: 800, font: 'Cabinet Grotesk', parent: medal });
  const number = r.text('Number', '7', { x: C.x, y: C.y + 12 }, { size: 210, color: INK, weight: 800, font: 'Cabinet Grotesk', parent: medal });

  // Crown of stars: each with its own lip, the middle one bigger.
  const crown = [{ dx: -104, dy: -206, d: 82, rot: -14 }, { dx: 0, dy: -236, d: 112, rot: 0 }, { dx: 104, dy: -206, d: 82, rot: 14 }].map(({ dx, dy, d, rot }, i) => {
    const at = { x: C.x + dx, y: C.y + dy };
    const g = r.group(`Crown star ${i + 1}`, at, float);
    r.shape('Star lip', 'star', { x: at.x, y: at.y + 9 }, { w: d, h: d, sides: 5, inner: 0.5, color: STAR_LIP, rotation: rot, parent: g });
    const s = r.shape('Star', 'star', at, { w: d, h: d, sides: 5, inner: 0.5, color: STAR_HI, fill: 'radial', rotation: rot, parent: g });
    s.props.fill.color2 = STAR;
    return { g, s };
  });

  // Ribbon: tails tucked behind, a darker lip, then the banner with its label.
  const ribbon = r.group('Ribbon', { x: C.x, y: C.y + 178 }, float);
  [-1, 1].forEach((side) => r.shape(side < 0 ? 'Tail left' : 'Tail right', 'rect', { x: C.x + side * 196, y: C.y + 198 }, { w: 96, h: 70, radius: 10, color: RIB_DEEP, rotation: side * -8, parent: ribbon }));
  r.shape('Banner lip', 'rect', { x: C.x, y: C.y + 190 }, { w: 380, h: 80, radius: 16, color: RIB_DEEP, parent: ribbon });
  const banner = r.shape('Banner', 'rect', { x: C.x, y: C.y + 178 }, { w: 380, h: 80, radius: 16, color: RIB, fill: 'linear', parent: ribbon });
  banner.props.fill.color2 = RIB_LO; banner.props.fill.angle = 90;
  r.shape('Banner shine', 'rect', { x: C.x, y: C.y + 152 }, { w: 330, h: 10, radius: 5, color: '#ffffff', opacity: 0.3, parent: ribbon });
  const label = r.text('Banner label', 'LEVEL UP', { x: C.x, y: C.y + 178 }, { size: 40, color: '#ffffff', weight: 800, font: 'Cabinet Grotesk', tracking: 0.08, parent: ribbon });

  const twinkles = [[C.x + 262, C.y - 150, 52], [C.x - 270, C.y - 40, 34], [C.x + 236, C.y + 124, 26], [C.x - 210, C.y + 170, 22]].map(([x, y, d], i) => r.shape(`Twinkle ${i + 1}`, 'star', { x, y }, { w: d, h: d, sides: 4, inner: 0.28, color: i % 2 ? '#ffffff' : STAR_HI }));

  const title = r.text('Title', 'Level up!', { x: 540, y: 850 }, { size: 96, color: INK, weight: 800, font: 'Cabinet Grotesk' });
  r.text('Subtitle', 'You reached level 7', { x: 540, y: 930 }, { size: 36, color: SUB, weight: 500, font: 'Cabinet Grotesk' });
  const touch = r.shape('Touch area', 'ellipse', C, { w: 520, h: 560, color: GOLD, fill: 'none', locked: true });

  // The glint crosses the face along its tilt; its length follows the face's chord so it never
  // spills past the edge (sampled into keys).
  const FR = R - 36;
  const sweep = (t0: number, dur: number): { x: Key[]; h: Key[]; o: Key[] } => {
    const n = 8, x: Key[] = [], h: Key[] = [], o: Key[] = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n, off = -FR * 0.85 + u * FR * 1.7, chord = 2 * Math.sqrt(Math.max(0, FR * FR - off * off)) * 0.92;
      const t = +(t0 + u * dur).toFixed(3);
      x.push([t, r.dx(glint, off + 150), 'linear']); h.push([t, Math.max(0.05, chord / 250), 'linear']); o.push([t, Math.sin(u * Math.PI) * 0.34, 'linear']);
    }
    return { x, h, o };
  };
  const idleGlint = sweep(1.4, 0.9);
  const fy = float.transform.y;
  const idle = anim('Idle', 4, 'loop', 'Rays turn exactly one ray-width per loop (22.5° for 16 rays), so the loop is seamless. The medal floats, the crown stars bob out of step, sparkles flash at different times, and a glint sweeps the face once per loop, its length following the face so it never spills over.', [
    tr(raysSpin, 'transform.rotation', [[0, 0, 'linear'], [4, 22.5]]),
    tr(float, 'transform.y', [[0, fy], [2, r.dy(float, -12)], [4, fy]]),
    ...crown.map(({ g }, i) => tr(g, 'transform.y', [[0, g.transform.y], [0.6 + i * 0.5, g.transform.y], [1.4 + i * 0.5, r.dy(g, -8)], [2.2 + i * 0.5, g.transform.y], [4, g.transform.y]])),
    ...twinkles.map((t, i) => tr(t, 'transform.scale', [[0, 1], [0.4 + i * 0.85, 1, 'easeInOut'], [0.7 + i * 0.85, 0.25, 'easeInOut'], [1.0 + i * 0.85, 1], [4, 1]])),
    tr(glint, 'transform.x', [[0, idleGlint.x[0][1]], ...idleGlint.x, [4, idleGlint.x[0][1]]]),
    tr(glint, 'transform.scaleY', [[0, 0.05], ...idleGlint.h, [4, 0.05]]),
    tr(glint, 'opacity', [[0, 0], ...idleGlint.o, [4, 0]]),
  ]);
  const fast = sweep(0.75, 0.45);
  const celebrate = anim('Celebrate', 2.2, 'once', 'Anticipation (it ducks and tilts back), then the coin flip: squeezing the width to almost nothing and back reads as a turn in 2D, and the face flashes as it goes edge-on. It pops past full size and settles. The crown stars pop in one after another, the ribbon unfurls with overshoot, the rays flare, a fast glint crosses the face, confetti arcs up and falls with gravity, and the title bounces in last.', [
    tr(medal, 'transform.scale', [[0, 1, 'easeOut'], [0.15, 0.88, 'easeIn'], [0.3, 1, 'easeOut'], [0.76, 1.16, 'easeInOut'], [1.0, 0.97, 'easeInOut'], [1.2, 1]]),
    tr(medal, 'transform.rotation', [[0, 0, 'easeOut'], [0.15, -9, 'easeInOut'], [0.35, 0]]),
    tr(medal, 'transform.scaleX', [[0.2, 1, 'easeIn'], [0.32, 0.04, 'easeOut'], [0.44, 1, 'easeIn'], [0.56, 0.04, 'easeOut'], [0.7, 1]]),
    tr(face, 'props.fill.color', [[0.2, FACE_HI, 'step'], [0.32, '#d6bfff', 'step'], [0.44, FACE_HI, 'step'], [0.56, '#d6bfff', 'step'], [0.7, FACE_HI]]),
    ...crown.flatMap(({ g }, i) => [tr(g, 'transform.scale', [[0.55, 1, 'easeIn'], [0.62, 0.01, 'step'], [0.7 + i * 0.1, 0.01, 'backOut'], [0.98 + i * 0.1, 1.25, 'easeInOut'], [1.18 + i * 0.1, 1]])]),
    tr(ribbon, 'transform.scaleX', [[0.6, 1, 'easeIn'], [0.7, 0.5, 'backOut'], [1.05, 1.08, 'easeInOut'], [1.3, 1]]),
    tr(raysOuter, 'transform.scale', [[0.68, 1, 'expoOut'], [0.98, 1.24, 'easeInOut'], [1.9, 1]]),
    tr(glint, 'transform.x', fast.x), tr(glint, 'transform.scaleY', fast.h), tr(glint, 'opacity', fast.o),
    ...confetti.flatMap(({ l, peak, land }, i) => {
      const t0 = 0.72 + (i % 5) * 0.03;
      return [
        tr(l, 'opacity', after(t0, [[0, 0], [0.03, 1], [0.95, 1], [1.25, 0]])),
        tr(l, 'transform.x', after(t0, [[0, l.transform.x, 'easeOut'], [0.45, peak.x / r.W, 'linear'], [1.25, land.x / r.W]])),
        tr(l, 'transform.y', after(t0, [[0, l.transform.y, 'easeOut'], [0.45, peak.y / r.H, 'easeIn'], [1.25, land.y / r.H]])),
        tr(l, 'transform.rotation', after(t0, [[0, l.transform.rotation, 'linear'], [1.25, l.transform.rotation + (i % 2 ? 420 : -380)]])),
      ];
    }),
    tr(title, 'transform.scale', [[0.9, 1, 'easeIn'], [1.0, 0.72, 'backOut'], [1.3, 1.1, 'easeInOut'], [1.55, 1]]),
  ]);

  const go = input('Celebrate', 'trigger', false);
  return finish(r, {
    name: 'Reward badge', category: 'Celebrations', background: BG, duration: 4,
    description: 'A collectible gold-and-violet medal that ducks, flips like a tossed coin, pops its stars in one by one and showers confetti when you earn it.',
    tags: ['reward', 'badge', 'medal', 'confetti', 'trigger', 'gamification'],
    exposed: [
      param('number', 'Number', 'The big number on the medal.', 'text', [[number, 'props.text'], [r.layers.find((l) => l.name === 'Number depth')!, 'props.text']], '7', 'Content'),
      param('title', 'Title', 'The words under the medal.', 'text', [[title, 'props.text']], 'Level up!', 'Content'),
      param('ribbonText', 'Ribbon', 'The words on the ribbon.', 'text', [[label, 'props.text']], 'LEVEL UP', 'Content'),
      param('face', 'Face colour', 'The gem in the middle of the medal.', 'color', [[face, 'props.fill.color']], FACE_HI),
      param('ribbon', 'Ribbon colour', 'The banner across the bottom.', 'color', [[banner, 'props.fill.color']], RIB),
      param('stars', 'Star colour', 'The crown of stars.', 'color', crown.map(({ s }) => [s, 'props.fill.color2'] as [Layer, string]), STAR),
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
