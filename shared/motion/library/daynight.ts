import type { Layer, SceneDocument } from '../../scene/schema';
import { Rig, after, anim, finish, input, is, onPointer, param, play, playBack, playOn, ring, rule, sound, toggle, tr } from './rig';

/**
 * Day/night switch. One toggle, one move: "To night" plays forwards to switch on and backwards to
 * switch off. The knob stretches as it travels (squash & stretch), the sun's rays fold away as it
 * becomes the moon, clouds drift out and the stars pop in one after another.
 */
export function dayNightSwitch(): SceneDocument {
  const r = new Rig(1080, 1080);
  const INK = '#1e2240', SKY = '#8fd3ff', NIGHT = '#2a3170', SUN = '#ffd23f', RAY = '#ffb627', MOON = '#f4f1e4', CRATER = '#d8d3c0', CLOUD = '#ffffff', STAR = '#fff6c9';

  const track = r.shape('Track', 'rect', { x: 540, y: 520 }, { w: 580, h: 270, radius: 135, color: SKY, stroke: INK, strokeW: 11 });
  const day = r.group('Day sky', { x: 540, y: 520 });
  const clouds = [{ x: 676, y: 590, s: 1 }, { x: 742, y: 452, s: 0.7 }].map((c, i) => {
    const g = r.group(`Cloud ${i + 1}`, { x: c.x, y: c.y }, day);
    [[-44, 6, 70], [0, -14, 92], [44, 8, 64]].forEach(([dx, dy, d], k) => r.shape(`Puff ${k + 1}`, 'ellipse', { x: c.x + dx * c.s, y: c.y + dy * c.s }, { w: d * c.s, h: d * c.s, color: CLOUD, parent: g }));
    r.shape('Cloud base', 'rect', { x: c.x, y: c.y + 22 * c.s }, { w: 150 * c.s, h: 44 * c.s, radius: 22 * c.s, color: CLOUD, parent: g });
    return g;
  });
  const night = r.group('Night sky', { x: 540, y: 520 });
  night.opacity = 0;
  const stars = [[330, 450, 34], [404, 584, 24], [462, 470, 18], [300, 590, 16], [480, 620, 28], [370, 520, 12]].map(([x, y, d], i) => r.shape(`Star ${i + 1}`, 'star', { x, y }, { w: d, h: d, sides: 4, inner: 0.4, color: STAR, parent: night }));

  const knob = r.group('Knob', { x: 410, y: 520 });
  const rays = r.group('Rays', { x: 410, y: 520 }, knob);
  const raySpin = r.group('Ray spin', { x: 410, y: 520 }, rays);
  ring(410, 520, 106, 8).forEach(([x, y, a], i) => r.shape(`Ray ${i + 1}`, 'rect', { x, y }, { w: 30, h: 14, radius: 7, color: RAY, stroke: INK, strokeW: 6, rotation: a, parent: raySpin }));
  const disc = r.shape('Sun / moon', 'ellipse', { x: 410, y: 520 }, { w: 172, h: 172, color: SUN, stroke: INK, strokeW: 11, parent: knob });
  const craters = [[372, 490, 46], [446, 548, 34], [392, 566, 22]].map(([x, y, d], i) => r.shape(`Crater ${i + 1}`, 'ellipse', { x, y }, { w: d, h: d, color: CRATER, opacity: 0, parent: knob }));
  const shine = r.shape('Shine', 'ellipse', { x: 372, y: 478 }, { w: 40, h: 22, color: '#ffffff', rotation: -35, opacity: 0.7, parent: knob });

  const morning = r.text('Day label', 'Good morning', { x: 540, y: 760 }, { size: 54, color: INK, weight: 700, font: 'Zodiak' });
  const evening = r.text('Night label', 'Good night', { x: 540, y: 760 }, { size: 54, color: INK, weight: 700, font: 'Zodiak' });
  evening.opacity = 0;

  const kx = knob.transform.x, to = r.dx(knob, 260);
  const toNight = anim('To night', 0.8, 'once', 'One move, played forwards to switch on and backwards to switch off. The knob stretches wide while it travels and snaps back round when it arrives (squash & stretch), the rays fold into the sun as it turns into the moon, and the stars appear one after another — staggered, so the sky “fills in”.', [
    tr(knob, 'transform.x', [[0, kx, 'easeInOut'], [0.55, to]]),
    tr(knob, 'transform.scaleX', [[0, 1, 'easeOut'], [0.25, 1.22, 'easeInOut'], [0.5, 0.94, 'easeInOut'], [0.62, 1]]),
    tr(knob, 'transform.scaleY', [[0, 1, 'easeOut'], [0.25, 0.86, 'easeInOut'], [0.5, 1.05, 'easeInOut'], [0.62, 1]]),
    tr(rays, 'transform.scale', [[0, 1, 'easeIn'], [0.3, 0.2]]),
    tr(rays, 'opacity', [[0.15, 1], [0.3, 0]]),
    tr(disc, 'props.fill.color', [[0.1, SUN], [0.45, MOON]]),
    ...craters.map((c, i) => tr(c, 'opacity', after(0.3 + i * 0.06, [[0, 0], [0.2, 1]]))),
    tr(shine, 'opacity', [[0.1, 0.7], [0.4, 0.4]]),
    tr(track, 'props.fill.color', [[0, SKY, 'easeInOut'], [0.6, NIGHT]]),
    tr(day, 'opacity', [[0, 1], [0.35, 0]]),
    tr(day, 'transform.x', [[0, day.transform.x, 'easeIn'], [0.4, r.dx(day, 60)]]),
    tr(night, 'opacity', [[0.2, 0], [0.5, 1]]),
    ...stars.map((s, i) => tr(s, 'transform.scale', after(0.3 + i * 0.06, [[0, 0.01, 'backOut'], [0.25, 1]]))),
    tr(morning, 'opacity', [[0, 1], [0.3, 0]]),
    tr(evening, 'opacity', [[0.35, 0], [0.7, 1]]),
  ]);
  const idle = anim('Idle', 6, 'loop', 'Always running: the rays turn slowly (45°, so the loop is seamless with 8 rays), the clouds drift and the stars twinkle at different moments.', [
    tr(raySpin, 'transform.rotation', [[0, 0, 'linear'], [6, 45]]),
    ...clouds.map((c, i) => tr(c, 'transform.x', [[0, c.transform.x], [3, r.dx(c, i ? -10 : 12)], [6, c.transform.x]])),
    ...stars.map((s, i) => tr(s, 'transform.rotation', [[0, 0], [1 + i * 0.7, 20], [2 + i * 0.7, 0], [6, 0]])),
  ]);
  const hover = anim('Hover', 0.3, 'once', 'On hover the knob grows a touch — a hint that it can be pressed.', [tr(knob, 'transform.scale', [[0, 1, 'backOut'], [0.3, 1.07]])]);

  const isNight = input('Night', 'boolean', false);
  return finish(r, {
    name: 'Day & night switch', category: 'Interactive UI', background: '#f3efe8', duration: 6,
    description: 'A toggle where the sun becomes the moon: the knob stretches across, rays fold away, clouds drift out and stars pop in.',
    tags: ['toggle', 'switch', 'ui', 'dark-mode'],
    exposed: [
      param('ink', 'Outline colour', 'Outlines and labels.', 'color', [[track, 'props.stroke.color'], [disc, 'props.stroke.color'], ...r.layers.filter((l) => l.name.startsWith('Ray ')).map((l) => [l, 'props.stroke.color'] as [Layer, string]), [morning, 'props.color'], [evening, 'props.color']], INK),
      param('rays', 'Ray colour', 'The sun’s rays.', 'color', r.layers.filter((l) => l.name.startsWith('Ray ')).map((l) => [l, 'props.fill.color'] as [Layer, string]), RAY),
      param('dayLabel', 'Day label', 'Text shown in the day.', 'text', [[morning, 'props.text']], 'Good morning', 'Content'),
      param('nightLabel', 'Night label', 'Text shown at night.', 'text', [[evening, 'props.text']], 'Good night', 'Content'),
    ],
    machine: {
      inputs: [isNight], animations: [idle, toNight, hover], bindings: [],
      rules: [
        rule({ type: 'start' }, [], play(idle)),
        rule(onPointer('click', track), [], toggle(isNight), sound('whoosh', 0.4)),
        rule(is(isNight, true), [], playOn(toNight)),
        rule(is(isNight, false), [], playBack(toNight)),
        rule(onPointer('enter', track), [], playOn(hover)),
        rule(onPointer('leave', track), [], playBack(hover)),
      ],
    },
  });
}
