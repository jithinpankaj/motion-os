import type { Animation, Layer, SceneDocument } from '../../scene/schema';
import { Rig, anim, fire, finish, follower, input, link, numIs, onPointer, param, play, playBack, playOn, rule, setNum, sound, tr, type Key } from './rig';

/**
 * 03 · The little slot bird. A round bird with one big eye and a slot machine in its belly. Pull the
 * lever (or click the machine): it crouches, the reels spin and stop one by one while the eye follows
 * them, and — on the third try — it hits 7-7-7 and jumps for joy. The order of results is a small
 * state machine driven by a "Spins" counter, so it is predictable and easy to change.
 */
export function slotBird(): SceneDocument {
  const r = new Rig(1080, 1080);
  const INK = '#22163a', BODY = '#6d5cff', WING = '#5546e6', CREAM = '#fff6e8', BEAK = '#ffb12b', PINK = '#ff7a9a', GOLD = '#ffcc3d', RED = '#ff4d5e', LEAF = '#3fae6a';

  const shadow = r.shape('Ground shadow', 'ellipse', { x: 540, y: 872 }, { w: 420, h: 44, color: INK, opacity: 0.12 });
  const bird = r.group('Bird', { x: 540, y: 866 });
  for (const x of [500, 580]) {
    r.shape('Leg', 'rect', { x, y: 828 }, { w: 14, h: 74, radius: 7, color: INK, parent: bird });
    r.shape('Foot', 'ellipse', { x: x + (x < 540 ? -8 : 8), y: 862 }, { w: 54, h: 18, color: INK, parent: bird });
  }
  const body = r.group('Body', { x: 540, y: 812 }, bird);
  // Tail feathers behind the body.
  [-18, -38, -58].forEach((rot, i) => r.shape(`Tail feather ${i + 1}`, 'rect', { x: 250 - i * 10, y: 540 + i * 44 }, { w: 130, h: 46, radius: 22, color: i === 1 ? PINK : WING, stroke: INK, strokeW: 9, rotation: rot + 180, parent: body }));
  // Antennae.
  const ants = ([-1, 1] as const).map((side) => {
    const g = r.group(side < 0 ? 'Antenna left' : 'Antenna right', { x: 540 + side * 40, y: 330 }, body);
    r.shape('Stalk', 'rect', { x: 540 + side * 58, y: 284 }, { w: 10, h: 96, radius: 5, color: INK, rotation: side * 22, parent: g });
    const bulb = r.shape('Bulb', 'ellipse', { x: 540 + side * 76, y: 238 }, { w: 44, h: 44, color: RED, stroke: INK, strokeW: 7, parent: g });
    return { g, bulb };
  });
  const bodyShape = r.shape('Body', 'ellipse', { x: 540, y: 568 }, { w: 520, h: 500, color: BODY, stroke: INK, strokeW: 12, parent: body });
  r.shape('Body shine', 'ellipse', { x: 380, y: 420 }, { w: 70, h: 40, color: CREAM, opacity: 0.35, rotation: -40, parent: body });
  const belly = r.shape('Belly', 'ellipse', { x: 540, y: 668 }, { w: 380, h: 270, color: CREAM, parent: body });
  const cheeks = [-1, 1].map((side) => r.shape(side < 0 ? 'Cheek left' : 'Cheek right', 'ellipse', { x: 540 + side * 112, y: 520 }, { w: 54, h: 28, color: PINK, opacity: 0.8, parent: body }));

  // The big eye.
  const eye = r.group('Eye', { x: 540, y: 430 }, body);
  const white = r.shape('Eye white', 'ellipse', { x: 540, y: 430 }, { w: 196, h: 184, color: CREAM, stroke: INK, strokeW: 10, parent: eye });
  const pupil = r.shape('Pupil', 'ellipse', { x: 540, y: 440 }, { w: 92, h: 96, color: INK, parent: eye });
  const glint = r.shape('Glint', 'ellipse', { x: 562, y: 418 }, { w: 28, h: 28, color: CREAM, parent: eye });
  const glint2 = r.shape('Small glint', 'ellipse', { x: 520, y: 466 }, { w: 12, h: 12, color: CREAM, parent: eye });
  const beak = r.shape('Beak', 'polygon', { x: 540, y: 538 }, { w: 64, h: 52, sides: 3, color: BEAK, stroke: INK, strokeW: 8, rotation: 180, parent: body });

  // Wings, on top at the sides; each turns around its shoulder.
  const wings = ([-1, 1] as const).map((side) => {
    const g = r.group(side < 0 ? 'Wing left' : 'Wing right', { x: 540 + side * 230, y: 560 }, body);
    r.shape('Wing', 'ellipse', { x: 540 + side * 268, y: 610 }, { w: 120, h: 170, color: WING, stroke: INK, strokeW: 10, rotation: side * -24, parent: g });
    return g;
  });

  // Slot machine in the belly.
  const machine = r.group('Slot machine', { x: 540, y: 690 }, body);
  const panel = r.shape('Panel', 'rect', { x: 540, y: 690 }, { w: 330, h: 150, radius: 28, color: GOLD, stroke: INK, strokeW: 10, parent: machine });
  const lights = [460, 500, 540, 580, 620].map((x, i) => r.shape(`Light ${i + 1}`, 'ellipse', { x, y: 630 }, { w: 14, h: 14, color: CREAM, opacity: i % 2 ? 0.5 : 1, parent: machine }));
  const SYMBOLS = ['Seven', 'Star', 'Cherry'] as const;
  const reels = [446, 540, 634].map((x, i) => {
    r.shape(`Window ${i + 1}`, 'rect', { x, y: 696 }, { w: 82, h: 100, radius: 14, color: CREAM, stroke: INK, strokeW: 6, parent: machine });
    const g = r.group(`Reel ${i + 1}`, { x, y: 696 }, machine);
    const start = [1, 0, 2][i];
    const seven = r.text('Seven', '7', { x, y: 698 }, { size: 78, color: RED, weight: 400, font: 'Bungee', parent: g });
    const star = r.shape('Star', 'star', { x, y: 698 }, { w: 64, h: 64, sides: 5, inner: 0.48, color: GOLD, stroke: INK, strokeW: 5, parent: g });
    const cherry = r.group('Cherry', { x, y: 698 }, g);
    r.shape('Stem', 'rect', { x: x + 4, y: 676 }, { w: 6, h: 38, radius: 3, color: LEAF, rotation: 20, parent: cherry });
    r.shape('Cherry left', 'ellipse', { x: x - 13, y: 708 }, { w: 30, h: 30, color: RED, stroke: INK, strokeW: 4, parent: cherry });
    r.shape('Cherry right', 'ellipse', { x: x + 14, y: 712 }, { w: 30, h: 30, color: RED, stroke: INK, strokeW: 4, parent: cherry });
    const syms = [seven, star, cherry];
    syms.forEach((l, k) => { l.opacity = k === start ? 1 : 0; });
    return { g, syms, start };
  });
  const lever = r.group('Lever', { x: 716, y: 712 }, machine);
  r.shape('Lever arm', 'rect', { x: 736, y: 660 }, { w: 14, h: 112, radius: 7, color: INK, rotation: 22, parent: lever });
  const knob = r.shape('Lever knob', 'ellipse', { x: 758, y: 606 }, { w: 46, h: 46, color: RED, stroke: INK, strokeW: 7, parent: lever });

  // ---------- moves ----------
  const ys = (l: Layer, px: number) => r.dy(l, px), xs = (l: Layer, px: number) => r.dx(l, px);
  const idle = anim('Idle', 3, 'loop', 'Breathing (the body swells 2 % from its feet), a blink, antennae swaying out of step, and the machine’s lights chasing — enough life to feel awake while it waits.', [
    tr(body, 'transform.scaleY', [[0, 1], [1.5, 1.02], [3, 1]]),
    tr(eye, 'transform.scaleY', [[0, 1, 'linear'], [2.1, 1, 'easeIn'], [2.18, 0.06, 'easeOut'], [2.3, 1, 'linear'], [3, 1]]),
    tr(ants[0].g, 'transform.rotation', [[0, -4], [1.5, 5], [3, -4]]),
    tr(ants[1].g, 'transform.rotation', [[0, 5], [1.5, -4], [3, 5]]),
    ...lights.map((l, i) => tr(l, 'opacity', [0, 0.6, 1.2, 1.8, 2.4, 3].map((t, k): Key => [t, (k + i) % 2 ? 0.45 : 1, 'step']))),
  ]);
  const perk = anim('Perk up', 0.45, 'once', 'On hover the wings lift and the antenna bulbs swell — the bird notices you.', [
    tr(wings[0], 'transform.rotation', [[0, 0, 'backOut'], [0.4, 16]]),
    tr(wings[1], 'transform.rotation', [[0, 0, 'backOut'], [0.4, -16]]),
    ...ants.map((a) => tr(a.bulb, 'transform.scale', [[0, 1, 'backOut'], [0.4, 1.2]])),
  ]);
  const crouch = anim('Pull the lever', 0.42, 'once', 'Anticipation: before the reels go, the bird squashes down and the lever is yanked. A big action reads better when the character “winds up” first.', [
    tr(bird, 'transform.scaleY', [[0, 1, 'easeOut'], [0.14, 0.9, 'easeInOut'], [0.32, 1.04, 'easeInOut'], [0.42, 1]]),
    tr(bird, 'transform.scaleX', [[0, 1, 'easeOut'], [0.14, 1.07, 'easeInOut'], [0.32, 0.97, 'easeInOut'], [0.42, 1]]),
    tr(lever, 'transform.rotation', [[0, 0, 'easeIn'], [0.12, 58, 'backOut'], [0.42, 0]]),
  ]);

  // Reel spins: each reel cycles its symbols (a hard cut every 0.07 s), stretched while it blurs past,
  // then lands with a bump. Reels stop 0.3 s apart and the eye follows each one.
  const spinMove = (name: string, result: [number, number, number], note: string): Animation => {
    const tracks = reels.flatMap((reel, i) => {
      const stopAt = 0.75 + i * 0.32;
      const steps = Math.round(stopAt / 0.07);
      const shownAt = (k: number) => (reel.start + k + 1) % 3;
      // Make the last cycled symbol land on the result.
      const offset = (result[i] - shownAt(steps) + 3) % 3;
      const pick = (k: number) => (k >= steps ? result[i] : (shownAt(k) + offset) % 3);
      const symTracks = reel.syms.map((l, s) => tr(l, 'opacity', [...Array.from({ length: steps + 1 }, (_, k): Key => [+(k * 0.07).toFixed(3), pick(k) === s ? 1 : 0, 'step']), [1.9, result[i] === s ? 1 : 0, 'step']]));
      return [...symTracks, tr(reel.g, 'transform.scaleY', [[0, 1, 'easeOut'], [0.1, 1.28], [stopAt, 1.28, 'easeOut'], [stopAt + 0.08, 0.84, 'easeOut'], [stopAt + 0.24, 1]])];
    });
    const p = pupil.transform, g1 = glint.transform, g2 = glint2.transform;
    const look = (base: { x: number; y: number }, l: Layer): ReturnType<typeof tr>[] => [
      tr(l, 'transform.y', [[0, base.y, 'easeOut'], [0.2, ys(l, 22)], [1.6, ys(l, 22), 'easeInOut'], [1.9, base.y]]),
      tr(l, 'transform.x', [[0, base.x, 'easeInOut'], [0.2, xs(l, -20), 'easeInOut'], [0.85, xs(l, -20), 'easeInOut'], [0.95, base.x, 'easeInOut'], [1.17, base.x, 'easeInOut'], [1.27, xs(l, 20), 'easeInOut'], [1.6, xs(l, 20), 'easeInOut'], [1.9, base.x]]),
    ];
    return anim(name, 1.9, 'once', note, [...tracks, ...look(p, pupil), ...look(g1, glint), ...look(g2, glint2)]);
  };
  const miss = spinMove('Spin · miss', [1, 2, 0], 'The reels cycle with hard “step” cuts (not smooth easing) so symbols snap like a real machine, stretch while they blur past, and land one after another with a bump. The eye glances at each reel as it stops — the character watches the result.');
  const near = spinMove('Spin · so close', [0, 0, 2], 'Same reel timing, landing on 7-7-cherry: a near miss builds suspense for the next try.');
  const jackpot = spinMove('Spin · jackpot', [0, 0, 0], 'Same reel timing, landing on 7-7-7.');

  const by = bird.transform.y, bpx = (px: number) => +(by + px / r.H).toFixed(5);
  const lightFlash = lights.map((l, i) => tr(l, 'opacity', [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.4].map((t, k): Key => [t, (k + i) % 2 ? 0.3 : 1, 'step'])));
  const celebrate = anim('Jackpot!', 1.4, 'once', 'Squash before the jump (anticipation), stretch on the way up, squash again on landing, then settle — the classic jump. The wings spread and flap twice, the eye squints with joy, and the lights flash.', [
    tr(bird, 'transform.y', [[0, by, 'easeOut'], [0.12, by, 'expoOut'], [0.42, bpx(-150), 'easeIn'], [0.7, by, 'easeOut'], [1.4, by]]),
    tr(bird, 'transform.scaleY', [[0, 1, 'easeOut'], [0.12, 0.84, 'easeOut'], [0.26, 1.12, 'easeInOut'], [0.6, 1, 'easeIn'], [0.72, 0.86, 'easeOut'], [0.9, 1.04, 'easeInOut'], [1.05, 1]]),
    tr(bird, 'transform.scaleX', [[0, 1, 'easeOut'], [0.12, 1.12, 'easeOut'], [0.26, 0.92, 'easeInOut'], [0.6, 1, 'easeIn'], [0.72, 1.1, 'easeOut'], [0.9, 0.98, 'easeInOut'], [1.05, 1]]),
    tr(wings[0], 'transform.rotation', [[0.1, 0, 'easeOut'], [0.3, 70, 'easeInOut'], [0.45, 30, 'easeInOut'], [0.6, 70, 'easeInOut'], [0.8, 20, 'easeInOut'], [1.1, 0]]),
    tr(wings[1], 'transform.rotation', [[0.1, 0, 'easeOut'], [0.3, -70, 'easeInOut'], [0.45, -30, 'easeInOut'], [0.6, -70, 'easeInOut'], [0.8, -20, 'easeInOut'], [1.1, 0]]),
    tr(white, 'transform.scaleY', [[0.1, 1, 'easeOut'], [0.2, 0.45, 'easeInOut'], [1.0, 0.45, 'easeInOut'], [1.25, 1]]),
    ...cheeks.map((c) => tr(c, 'transform.scale', [[0.1, 1, 'backOut'], [0.3, 1.4, 'easeInOut'], [1.2, 1]])),
    ...ants.map((a, i) => tr(a.bulb, 'transform.scale', [[0.3 + i * 0.05, 1, 'backOut'], [0.5 + i * 0.05, 1.5, 'easeInOut'], [1.2, 1]])),
    ...lightFlash,
    tr(shadow, 'transform.scale', [[0.12, 1, 'expoOut'], [0.42, 0.6, 'easeIn'], [0.7, 1.05, 'easeOut'], [0.9, 1]]),
  ]);
  const shrug = anim('Aww', 0.9, 'once', 'A small disappointment: the eye half-closes, the wings droop and the body sinks a little, then it perks back up. Small reactions keep the character honest between big moments.', [
    tr(white, 'transform.scaleY', [[0, 1, 'easeOut'], [0.2, 0.7, 'easeInOut'], [0.65, 0.7, 'easeInOut'], [0.9, 1]]),
    tr(wings[0], 'transform.rotation', [[0, 0, 'easeOut'], [0.25, -14, 'easeInOut'], [0.65, -14, 'easeInOut'], [0.9, 0]]),
    tr(wings[1], 'transform.rotation', [[0, 0, 'easeOut'], [0.25, 14, 'easeInOut'], [0.65, 14, 'easeInOut'], [0.9, 0]]),
    tr(bird, 'transform.y', [[0, by, 'easeOut'], [0.25, bpx(10), 'easeInOut'], [0.65, bpx(10), 'easeInOut'], [0.9, by]]),
  ]);

  const spinIn = input('Spin', 'trigger', false);
  const spins = { ...input('Spins', 'number', 0), min: 0, max: 4 };
  const lookX = follower('Look X', 'pointerX', { smoothing: 0.7 }), lookY = follower('Look Y', 'pointerY', { smoothing: 0.7 });
  const W = r.W, H = r.H;
  const eyeLinks = [pupil, glint, glint2].flatMap((l) => [link(lookX, l, 'transform.x', [-1, 1], [-30 / W, 30 / W]), link(lookY, l, 'transform.y', [-1, 1], [-24 / H, 24 / H])]);

  return finish(r, {
    name: 'Slot bird', category: 'Characters', background: '#fbeee0', duration: 3,
    description: 'A round bird with a slot machine in its belly. Pull the lever: it crouches, the reels spin and stop one by one while it watches — and on the third try it hits the jackpot.',
    tags: ['character', 'slot-machine', 'state-machine', 'trigger'],
    exposed: [
      param('bodyColour', 'Body colour', 'The bird’s body.', 'color', [[bodyShape, 'props.fill.color']], BODY),
      param('wingColour', 'Wing colour', 'Both wings.', 'color', r.layers.filter((l) => l.name === 'Wing').map((l) => [l, 'props.fill.color'] as [Layer, string]), WING),
      param('machineColour', 'Machine colour', 'The slot machine panel.', 'color', [[panel, 'props.fill.color']], GOLD),
      param('bellyColour', 'Belly colour', 'The belly patch and eye.', 'color', [[belly, 'props.fill.color'], [white, 'props.fill.color']], CREAM),
    ],
    machine: {
      inputs: [spinIn, spins, lookX, lookY],
      animations: [idle, perk, crouch, miss, near, jackpot, celebrate, shrug],
      bindings: [...eyeLinks, link(lookX, body, 'transform.rotation', [-1, 1], [-5, 5])],
      rules: [
        rule({ type: 'start' }, [], play(idle)),
        rule(onPointer('enter', bodyShape), [], playOn(perk)),
        rule(onPointer('leave', bodyShape), [], playBack(perk)),
        rule(onPointer('click', panel), [], fire(spinIn)),
        rule(onPointer('click', knob), [], fire(spinIn)),
        rule({ type: 'trigger', inputId: spinIn.id }, [], play(crouch), sound('click', 0.6), setNum(spins, 1, 'add')),
        // Which result comes up depends on how many times it has been spun.
        rule(numIs(spins, '=', 1), [], play(miss), sound('spin', 0.5)),
        rule(numIs(spins, '=', 2), [], play(near), sound('spin', 0.5)),
        rule(numIs(spins, '=', 3), [], play(jackpot), sound('spin', 0.5)),
        rule(numIs(spins, '>', 3), [], setNum(spins, 1)),
        rule({ type: 'finished', animationId: miss.id }, [], play(shrug)),
        rule({ type: 'finished', animationId: near.id }, [], play(shrug), sound('bonk', 0.4)),
        rule({ type: 'finished', animationId: jackpot.id }, [], play(celebrate), sound('success', 0.6), setNum(spins, 0)),
      ],
    },
  });
}
