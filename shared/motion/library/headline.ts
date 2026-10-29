import type { Layer, SceneDocument } from '../../scene/schema';
import { Rig, after, anim, finish, onPointer, param, play, rule, sound, tr } from './rig';

/**
 * Bouncy headline. Every letter is its own text layer inside two groups: the outer one carries the
 * idle wave, the inner one carries jumps and hover pops — so they add up instead of fighting.
 * Hover a letter and it pops; click and the whole word jumps in a wave with squash and stretch.
 */
export function bouncyHeadline(): SceneDocument {
  const r = new Rig(1080, 1080);
  const INK = '#2b1d3a';
  const COLORS = ['#ff5d5d', '#ffb000', '#2bb673', '#2d9cdb', '#9b51e0', '#ff5d5d'];
  // Centres measured from Oi's glyph widths at 136 px with a 12 px gap between letters.
  const LETTERS: [string, number][] = [['H', 262], ['e', 414], ['l', 531], ['l', 622], ['o', 738], ['!', 855]];
  const BASE = 600;

  const touch = r.shape('Touch area', 'rect', { x: 560, y: 520 }, { w: 760, h: 340, color: INK, fill: 'none', locked: true });
  const swoosh = r.group('Underline', { x: 190, y: 652 });
  r.shape('Underline', 'rect', { x: 540, y: 652 }, { w: 700, h: 18, radius: 10, color: INK, parent: swoosh });

  const letters = LETTERS.map(([ch, x], i) => {
    const wave = r.group(`Letter ${i + 1} · wave`, { x, y: BASE });
    const jump = r.group(`Letter ${i + 1}`, { x, y: BASE }, wave);
    const shadow = r.text(`${ch} shadow`, ch, { x: x + 6, y: 536 + 6 }, { size: 136, color: INK, weight: 400, font: 'Oi', parent: jump });
    const t = r.text(`${ch}`, ch, { x, y: 536 }, { size: 136, color: COLORS[i], weight: 400, font: 'Oi', parent: jump });
    return { wave, jump, t, shadow };
  });

  const idle = anim('Wave', 2.4, 'loop', 'A gentle wave: each letter rises 10 px, 0.1 s after the one before it. Offsetting the same motion in time is the simplest way to make a row of things feel alive.', [
    ...letters.map((l, i) => tr(l.wave, 'transform.y', [[0, l.wave.transform.y], ...after(i * 0.1, [[0, l.wave.transform.y, 'easeInOut'], [0.5, r.dy(l.wave, -10), 'easeInOut'], [1, l.wave.transform.y]]), [2.4, l.wave.transform.y]])),
  ]);
  const jump = anim('Jump', 1.3, 'once', 'Each letter squashes (anticipation), stretches as it leaps, squashes again when it lands and settles. Letters start 0.07 s apart, so the jump travels across the word. The underline dips under the impact.', [
    ...letters.flatMap((l, i) => {
      const y = l.jump.transform.y, up = r.dy(l.jump, -96);
      return [
        tr(l.jump, 'transform.y', after(i * 0.07, [[0, y], [0.1, y, 'easeOut'], [0.3, up, 'easeIn'], [0.5, y], [0.7, y]])),
        tr(l.jump, 'transform.scaleY', after(i * 0.07, [[0, 1, 'easeOut'], [0.1, 0.78, 'easeOut'], [0.22, 1.16, 'easeInOut'], [0.46, 1, 'easeOut'], [0.52, 0.84, 'easeOut'], [0.68, 1.04, 'easeInOut'], [0.8, 1]])),
        tr(l.jump, 'transform.scaleX', after(i * 0.07, [[0, 1, 'easeOut'], [0.1, 1.16, 'easeOut'], [0.22, 0.9, 'easeInOut'], [0.46, 1, 'easeOut'], [0.52, 1.12, 'easeOut'], [0.68, 0.98, 'easeInOut'], [0.8, 1]])),
        tr(l.jump, 'transform.rotation', after(i * 0.07, [[0.1, 0, 'easeOut'], [0.3, i % 2 ? 8 : -8, 'easeIn'], [0.5, 0]])),
      ];
    }),
    tr(swoosh, 'transform.scaleY', [[0.45, 1, 'easeOut'], [0.55, 0.5, 'easeInOut'], [0.8, 1.2, 'easeInOut'], [1, 1]]),
  ]);
  const pops = letters.map((l, i) => anim(`Pop ${LETTERS[i][0]} (${i + 1})`, 0.6, 'once', 'Hovering a letter makes just that letter pop and wobble — each letter has its own little move.', [
    tr(l.jump, 'transform.scale', [[0, 1, 'easeOut'], [0.12, 1.2, 'easeInOut'], [0.3, 0.95, 'easeInOut'], [0.45, 1]]),
    tr(l.jump, 'transform.rotation', [[0, 0, 'easeOut'], [0.12, i % 2 ? -10 : 10, 'easeInOut'], [0.3, i % 2 ? 5 : -5, 'easeInOut'], [0.5, 0]]),
  ]));

  return finish(r, {
    name: 'Bouncy headline', category: 'Typography', background: '#fff4e0', duration: 2.4,
    description: 'A word whose letters wave, pop when you hover them and jump in a wave when you click.',
    tags: ['typography', 'text', 'stagger', 'squash-and-stretch'],
    exposed: [
      ...letters.map((l, i) => param(`letter${i + 1}`, `Letter ${i + 1} colour`, `Colour of “${LETTERS[i][0]}”.`, 'color', [[l.t, 'props.color']], COLORS[i])),
      param('shadow', 'Shadow & underline', 'The offset letter shadows and the underline.', 'color', [...letters.map((l) => [l.shadow, 'props.color'] as [Layer, string]), [r.layers.find((x) => x.name === 'Underline' && x.type === 'shape')!, 'props.fill.color']], INK),
    ],
    machine: {
      inputs: [], animations: [idle, jump, ...pops], bindings: [],
      rules: [
        rule({ type: 'start' }, [], play(idle)),
        rule(onPointer('click', touch), [], play(jump), sound('boing', 0.45)),
        ...letters.map((l, i) => rule(onPointer('enter', l.t), [], play(pops[i]), sound('blip', 0.25))),
      ],
    },
  });
}
