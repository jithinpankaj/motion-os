import { createScene } from '../../scene/defaults';
import type { Animation, Layer, MachineState, Rule, SceneDocument, When } from '../../scene/schema';
import { uid } from '../../util/random';
import { Rig, anim, param, play, rule, sound, tr } from './rig';
import { categoryTag } from './categories';

// ---------- 01 · The living button ----------

/**
 * A chunky, illustrated keycap with a face. The top ("Cap") sits on a darker base; hover lifts it,
 * press squashes it into the base, release springs it back. Decorations ride on the cap in their own
 * groups so the idle loop, hover and press can each move them without fighting.
 */
export function livingButton(): SceneDocument {
  const W = 1080, H = 1080;
  const r = new Rig(W, H);
  const INK = '#2a1a12', ORANGE = '#ff7a2f', CREAM = '#fff1dc', SUN = '#ffc63a', CORAL = '#ff6b8b';

  // Invisible touch target, bottom of the stack and locked so it never gets in the way while editing.
  const touch = r.shape('Touch area', 'rect', { x: 540, y: 590 }, { w: 700, h: 330, radius: 160, color: ORANGE, fill: 'none', locked: true });
  const shadow = r.shape('Ground shadow', 'ellipse', { x: 540, y: 716 }, { w: 620, h: 52, color: INK, opacity: 0.16 });

  const body = r.group('Button', { x: 540, y: 702 });
  const base = r.shape('Base', 'rect', { x: 540, y: 612 }, { w: 612, h: 180, radius: 90, color: ORANGE, stroke: INK, strokeW: 12, parent: body });
  r.shape('Base shade', 'rect', { x: 540, y: 612 }, { w: 606, h: 174, radius: 87, color: INK, opacity: 0.3, parent: body });

  const cap = r.group('Cap', { x: 540, y: 672 }, body);
  const top = r.shape('Top', 'rect', { x: 540, y: 582 }, { w: 600, h: 180, radius: 90, color: ORANGE, stroke: INK, strokeW: 12, parent: cap });
  const shine = r.shape('Shine', 'rect', { x: 428, y: 523 }, { w: 210, h: 22, radius: 11, color: CREAM, opacity: 0.85, parent: cap });
  const shineDot = r.shape('Shine dot', 'ellipse', { x: 562, y: 523 }, { w: 22, h: 22, color: CREAM, opacity: 0.85, parent: cap });

  const ticksG = r.group('Excitement lines', { x: 258, y: 496 }, cap);
  const ticks = [200, 232, 264].map((deg, i) => {
    const a = (deg * Math.PI) / 180;
    return r.shape(`Line ${i + 1}`, 'rect', { x: 258 + Math.cos(a) * 64, y: 496 + Math.sin(a) * 64 }, { w: 42, h: 13, radius: 6.5, color: INK, rotation: deg, parent: ticksG });
  });

  const face = r.group('Face', { x: 360, y: 588 }, cap);
  const cheeks = [318, 402].map((x, i) => r.shape(i ? 'Cheek right' : 'Cheek left', 'ellipse', { x, y: 618 }, { w: 36, h: 20, color: CORAL, opacity: 0.75, parent: face }));
  const eyesG = r.group('Eyes', { x: 360, y: 582 }, face);
  const eyes = [336, 384].map((x, i) => r.shape(i ? 'Eye right' : 'Eye left', 'ellipse', { x, y: 582 }, { w: 22, h: 36, color: INK, parent: eyesG }));
  const glints = [340, 388].map((x, i) => r.shape(i ? 'Glint right' : 'Glint left', 'ellipse', { x, y: 573 }, { w: 8, h: 8, color: CREAM, parent: eyesG }));

  const label = r.text('Label', 'Let’s go!', { x: 616, y: 584 }, { size: 74, color: INK, weight: 800, font: 'Bricolage Grotesque', tracking: -0.03, parent: cap });

  const spark = r.group('Sparkles', { x: 842, y: 486 }, cap);
  const starBig = r.shape('Sparkle', 'star', { x: 842, y: 478 }, { w: 124, h: 124, sides: 4, inner: 0.36, color: SUN, stroke: INK, strokeW: 9, rotation: 12, parent: spark });
  const starSmall = r.shape('Little sparkle', 'star', { x: 914, y: 424 }, { w: 52, h: 52, sides: 4, inner: 0.4, color: SUN, stroke: INK, strokeW: 7, parent: spark });
  const dot = r.shape('Dot', 'ellipse', { x: 906, y: 528 }, { w: 18, h: 18, color: CORAL, parent: spark });

  // Resting values the moves start from and return to.
  const capY = cap.transform.y, faceY = face.transform.y, eyesX = eyesG.transform.x, dotY = dot.transform.y;
  const up = (px: number) => +(capY + px / H).toFixed(5);
  const fy = (px: number) => +(faceY + px / H).toFixed(5);

  const idle = anim('Idle', 5, 'loop',
    'Plays all the time. Only small things move — the sparkle twinkles, the eyes glance around and blink — so the button feels alive without shouting. The blinks are uneven on purpose (one, then a double): perfectly regular timing looks mechanical.', [
      tr(starBig, 'transform.rotation', [[0, 12], [1.25, 24], [2.5, 12], [3.75, 24], [5, 12]]),
      tr(starBig, 'transform.scale', [[0, 1], [1.25, 1.1], [2.5, 1], [3.75, 1.1], [5, 1]]),
      tr(starSmall, 'transform.scale', [[0, 1], [0.6, 0.55], [1.6, 1], [3.1, 1], [3.7, 0.55], [4.6, 1], [5, 1]]),
      tr(starSmall, 'transform.rotation', [[0, 0], [2.5, -20], [5, 0]]),
      tr(dot, 'transform.y', [[0, dotY], [2.5, r.dy(dot, -7)], [5, dotY]]),
      tr(eyesG, 'transform.scaleY', [[0, 1, 'linear'], [1.4, 1, 'easeIn'], [1.48, 0.08, 'easeOut'], [1.6, 1, 'linear'], [4.1, 1, 'easeIn'], [4.18, 0.08, 'easeOut'], [4.28, 1, 'linear'], [4.4, 1, 'easeIn'], [4.47, 0.08, 'easeOut'], [4.58, 1, 'linear'], [5, 1]]),
      tr(eyesG, 'transform.x', [[0, eyesX], [2, eyesX, 'easeInOut'], [2.22, r.dx(eyesG, -5)], [3.2, r.dx(eyesG, -5), 'easeInOut'], [3.42, r.dx(eyesG, 4)], [3.9, r.dx(eyesG, 4), 'easeInOut'], [4.12, eyesX], [5, eyesX]]),
      tr(ticksG, 'transform.rotation', [[0, 0], [2.5, -5], [5, 0]]),
    ]);

  const hover = anim('Hover', 0.5, 'once',
    'The top lifts 12 px off its base, so the side looks taller, and stretches for a moment as it rises (squash & stretch). The face and decorations start a few hundredths of a second later — overlapping action makes it read as one soft object rather than a stiff block.', [
      tr(cap, 'transform.y', [[0, capY, 'backOut'], [0.42, up(-12)]]),
      tr(cap, 'transform.scaleY', [[0, 1, 'easeOut'], [0.14, 1.05], [0.42, 1]]),
      tr(cap, 'transform.scaleX', [[0, 1, 'easeOut'], [0.14, 0.97], [0.42, 1]]),
      tr(face, 'transform.y', [[0.04, faceY, 'backOut'], [0.4, fy(-5)]]),
      tr(spark, 'transform.rotation', [[0.06, 0, 'backOut'], [0.5, 18]]),
      tr(spark, 'transform.scale', [[0.06, 1, 'backOut'], [0.5, 1.18]]),
      tr(ticksG, 'transform.scale', [[0.08, 0.7, 'backOut'], [0.5, 1]]),
      tr(shadow, 'props.width', [[0, 620, 'easeOut'], [0.4, 560]]),
      tr(shadow, 'opacity', [[0, 0.16, 'easeOut'], [0.4, 0.1]]),
      tr(shine, 'opacity', [[0, 0.85], [0.3, 1]]),
    ]);

  const unhover = anim('Unhover', 0.55, 'once',
    'The top settles back onto its base with a soft spring and a tiny landing squash, then the decorations relax.', [
      tr(cap, 'transform.y', [[0, up(-12), 'spring'], [0.55, capY]]),
      tr(cap, 'transform.scaleY', [[0, 1, 'easeOut'], [0.14, 0.98], [0.4, 1]]),
      tr(cap, 'transform.scaleX', [[0, 1, 'easeOut'], [0.14, 1.01], [0.4, 1]]),
      tr(face, 'transform.y', [[0.05, fy(-5)], [0.4, faceY]]),
      tr(spark, 'transform.rotation', [[0, 18], [0.5, 0]]),
      tr(spark, 'transform.scale', [[0, 1.18], [0.5, 1]]),
      tr(ticksG, 'transform.scale', [[0, 1], [0.45, 0.7]]),
      tr(shadow, 'props.width', [[0, 560], [0.45, 620]]),
      tr(shadow, 'opacity', [[0, 0.1], [0.45, 0.16]]),
      tr(shine, 'opacity', [[0, 1], [0.4, 0.85]]),
    ]);

  const press = anim('Press', 0.24, 'once',
    'Fast (0.12 s) because a press should feel instant. The top squashes into the base and gets wider so it keeps its volume, the whole button sinks a little, and the eyes squeeze shut. The sparkle and lines follow a beat later.', [
      tr(cap, 'transform.y', [[0, up(-12), 'expoOut'], [0.12, up(22)]]),
      tr(cap, 'transform.scaleY', [[0, 1, 'expoOut'], [0.12, 0.88]]),
      tr(cap, 'transform.scaleX', [[0, 1, 'expoOut'], [0.12, 1.05]]),
      tr(body, 'transform.scaleY', [[0, 1, 'expoOut'], [0.12, 0.97]]),
      tr(body, 'transform.scaleX', [[0, 1, 'expoOut'], [0.12, 1.015]]),
      ...eyes.flatMap((e) => [tr(e, 'props.height', [[0, 36, 'expoOut'], [0.1, 6]]), tr(e, 'props.width', [[0, 22, 'expoOut'], [0.1, 30]])]),
      ...glints.map((g) => tr(g, 'opacity', [[0, 1], [0.06, 0]])),
      ...cheeks.flatMap((c) => [tr(c, 'transform.scale', [[0, 1, 'backOut'], [0.16, 1.25]]), tr(c, 'opacity', [[0, 0.75], [0.12, 1]])]),
      tr(face, 'transform.y', [[0, fy(-5), 'expoOut'], [0.12, fy(3)]]),
      tr(spark, 'transform.scale', [[0.03, 1.18, 'easeOut'], [0.2, 0.82]]),
      tr(spark, 'transform.rotation', [[0.03, 18, 'easeOut'], [0.2, 6]]),
      tr(ticksG, 'transform.scale', [[0.04, 1, 'easeOut'], [0.22, 0.45]]),
      tr(shadow, 'props.width', [[0, 560, 'expoOut'], [0.12, 650]]),
      tr(shadow, 'opacity', [[0, 0.1], [0.12, 0.22]]),
      tr(shine, 'opacity', [[0, 1], [0.12, 0.55]]),
    ]);

  const release = anim('Release', 0.85, 'once',
    'The payoff. The top springs past its resting height, squashes on the way back down and settles (follow-through). The eyes pop open wider than normal. The sparkle starts 0.07 s later and the lines 0.1 s later, one after another, so the energy ripples outward and settles last.', [
      tr(cap, 'transform.y', [[0, up(22), 'easeOut'], [0.14, up(-24)], [0.32, up(-8)], [0.48, up(-14)], [0.64, up(-12)]]),
      tr(cap, 'transform.scaleY', [[0, 0.88, 'easeOut'], [0.12, 1.08], [0.28, 0.96], [0.44, 1.015], [0.6, 1]]),
      tr(cap, 'transform.scaleX', [[0, 1.05, 'easeOut'], [0.12, 0.95], [0.28, 1.025], [0.44, 0.995], [0.6, 1]]),
      tr(body, 'transform.scaleY', [[0, 0.97, 'easeOut'], [0.12, 1.01], [0.3, 1]]),
      tr(body, 'transform.scaleX', [[0, 1.015, 'easeOut'], [0.12, 0.995], [0.3, 1]]),
      ...eyes.flatMap((e) => [tr(e, 'props.height', [[0.02, 6, 'backOut'], [0.18, 44], [0.42, 36]]), tr(e, 'props.width', [[0.02, 30, 'backOut'], [0.18, 20], [0.42, 22]])]),
      ...glints.map((g) => tr(g, 'opacity', [[0.1, 0], [0.2, 1]])),
      ...cheeks.flatMap((c) => [tr(c, 'transform.scale', [[0, 1.25], [0.5, 1]]), tr(c, 'opacity', [[0.1, 1], [0.6, 0.75]])]),
      tr(face, 'transform.y', [[0.03, fy(3), 'easeOut'], [0.2, fy(-11)], [0.42, fy(-3)], [0.58, fy(-5)]]),
      tr(spark, 'transform.scale', [[0.07, 0.82, 'backOut'], [0.3, 1.36], [0.62, 1.18]]),
      tr(spark, 'transform.rotation', [[0.07, 6, 'expoOut'], [0.45, 42], [0.8, 18]]),
      tr(ticksG, 'transform.scale', [[0.1, 0.45, 'backOut'], [0.34, 1.2], [0.7, 1]]),
      ...ticks.map((t, i) => tr(t, 'props.width', [[0.1 + i * 0.04, 42, 'easeOut'], [0.26 + i * 0.04, 54], [0.55 + i * 0.05, 42]])),
      tr(dot, 'transform.scale', [[0.12, 1, 'backOut'], [0.3, 1.45], [0.62, 1]]),
      tr(shadow, 'props.width', [[0, 650, 'easeOut'], [0.14, 530], [0.4, 570], [0.6, 560]]),
      tr(shadow, 'opacity', [[0, 0.22, 'easeOut'], [0.14, 0.08], [0.5, 0.1]]),
      tr(shine, 'opacity', [[0, 0.55, 'easeOut'], [0.12, 1]]),
    ]);

  // The state machine is two toggles the pointer flips. You can flip them yourself in Try it.
  // The state machine: Rest, Hover and Pressed, joined by connections (the arrows on the Interaction Canvas).
  const st = (id: string, name: string, a: Animation, x: number, y: number): MachineState => ({ id: uid(id), name, animationId: a.id, x, y });
  const rest = st('st', 'Rest', unhover, 150, 120), hov = st('st', 'Hover', hover, 400, 40), pressed = st('st', 'Pressed', press, 660, 120);
  const on = (event: 'enter' | 'leave' | 'down' | 'up'): When => ({ type: 'pointer', event, layerId: touch.id });
  const conn = (name: string, when: When, from: MachineState, to: MachineState, transition: Rule['transition'], ...actions: Rule['do']): Rule => ({ id: uid('ru'), name, when, only: [], do: actions, from: from.id, to: to.id, transition });
  const hoverT = { duration: 0.2, easing: 'easeOut' as const, priority: 'normal' as const, interruption: 'allow' as const };
  const clickT = { duration: 0.12, easing: 'easeOut' as const, priority: 'high' as const, interruption: 'allow' as const };

  const d = createScene({ meta: { name: 'Living button', description: 'An illustrated button with a face. Hover lifts it, pressing squashes it into its base, letting go springs it back — and it blinks and twinkles while it waits.', tags: [categoryTag('Interactive UI'), 'button', 'hover', 'press', 'squash-and-stretch'], category: 'Interactive UI' } });
  d.canvas = { ...d.canvas, width: W, height: H, background: '#f4e9d8', duration: 5, loop: true };
  d.layers = r.layers;
  d.fallback = { staticFrame: 0, reducedMotion: 'static' };
  d.export = { posterTime: 0 };
  d.exposed = [
    param('buttonColour', 'Button colour', 'The top and the base. The base gets its darker side from a see-through “Base shade” layer, so any colour keeps its depth.', 'color', [[top, 'props.fill.color'], [base, 'props.fill.color']], ORANGE),
    param('inkColour', 'Ink colour', 'Outlines, eyes, lines and the label.', 'color', [[top, 'props.stroke.color'], [base, 'props.stroke.color'], [starBig, 'props.stroke.color'], [starSmall, 'props.stroke.color'], ...eyes.map((e) => [e, 'props.fill.color'] as [Layer, string]), ...ticks.map((t) => [t, 'props.fill.color'] as [Layer, string]), [label, 'props.color']], INK),
    param('sparkleColour', 'Sparkle colour', 'Both sparkles.', 'color', [[starBig, 'props.fill.color'], [starSmall, 'props.fill.color']], SUN),
    param('cheekColour', 'Cheek colour', 'The cheeks and the little dot.', 'color', [...cheeks.map((c) => [c, 'props.fill.color'] as [Layer, string]), [dot, 'props.fill.color']], CORAL),
    param('shineColour', 'Shine colour', 'The highlight on the top and the glints in the eyes.', 'color', [[shine, 'props.fill.color'], [shineDot, 'props.fill.color'], ...glints.map((g) => [g, 'props.fill.color'] as [Layer, string])], CREAM),
    param('label', 'Label', 'The words on the button.', 'text', [[label, 'props.text']], 'Let’s go!', 'Content'),
  ];
  d.machine = {
    inputs: [], animations: [idle, hover, unhover, press, release], bindings: [],
    states: [rest, hov, pressed], initialState: rest.id,
    rules: [
      rule({ type: 'start' }, [], play(idle)),
      conn('Pointer enters', on('enter'), rest, hov, hoverT),
      conn('Pointer leaves', on('leave'), hov, rest, hoverT),
      conn('Pressed', on('down'), hov, pressed, clickT, sound('tap', 0.7)),
      // Touch screens have no hover: pressing goes straight from Rest to Pressed.
      conn('Pressed (touch)', on('down'), rest, pressed, clickT, sound('tap', 0.7)),
      // Letting go plays Release instead of Hover's own move: the spring-back is the payoff.
      conn('Released', on('up'), pressed, hov, { ...clickT, playStateMove: false }, play(release), sound('pop', 0.5)),
      conn('Dragged off', on('leave'), pressed, rest, { ...hoverT, priority: 'high' }),
    ],
  };
  return d;
}

