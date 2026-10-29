import type { SceneDocument } from '../scene/schema';
import { LIBRARY_CATEGORIES, categoryTag, type LibraryCategory } from './library/categories';
import { livingButton } from './library/button';
import { wanderingCreature } from './library/creature';
import { slotBird } from './library/slotbird';
import { mochi } from './library/mochi';
import { bloomingFlower } from './library/flower';
import { dayNightSwitch } from './library/daynight';
import { taskCheckbox } from './library/checkbox';
import { bouncyHeadline } from './library/headline';
import { likeBurst } from './library/like';
import { morningCoffee } from './library/coffee';
import { rewardBadge } from './library/badge';
import { inchwormLoader } from './library/inchworm';

/**
 * The component library: finished, fully editable motion files built only from the editor's own
 * shapes, groups, moves and rules. Each one is published to the Community to open, play with and remix.
 */
export { LIBRARY_CATEGORIES, categoryTag, type LibraryCategory };
export type MotionPreset = { key: string; name: string; category: LibraryCategory; description: string; tip: string; tags: string[]; build: () => SceneDocument };

export const MOTION_PRESETS: MotionPreset[] = [
  {
    key: 'living-button', name: 'Living button', category: 'Interactive UI',
    description: 'An illustrated button with a face: hover lifts it, pressing squashes it into its base, letting go springs it back.',
    tip: 'Hover over the button, then press and hold it, then let go. In the editor, open Animate to read each move’s note.',
    tags: [categoryTag('Interactive UI'), 'button', 'hover', 'press', 'squash-and-stretch'], build: livingButton,
  },
  {
    key: 'wandering-creature', name: 'Wandering creature', category: 'Characters',
    description: 'A winding, segmented creature whose eyes follow your pointer. Click it and a wiggle travels from its head to its tail.',
    tip: 'Move your pointer around, then click the creature.',
    tags: [categoryTag('Characters'), 'character', 'follow', 'pointer', 'overlapping-action'], build: wanderingCreature,
  },
  {
    key: 'slot-bird', name: 'Slot bird', category: 'Characters',
    description: 'A round bird with a slot machine in its belly. Pull the lever: it crouches, the reels stop one by one while it watches — and the third spin hits the jackpot.',
    tip: 'Click the lever or the machine three times. Hover the bird to make it perk up.',
    tags: [categoryTag('Characters'), 'character', 'slot-machine', 'state-machine', 'trigger'], build: slotBird,
  },
  {
    key: 'mochi', name: 'Mochi', category: 'Characters',
    description: 'A squishy character you can grab and stretch. Let go and it springs back, wobbles and settles — its sprout settles last.',
    tip: 'Press on Mochi and drag in any direction, then let go.',
    tags: [categoryTag('Characters'), 'character', 'drag', 'elastic', 'spring', 'squash-and-stretch'], build: mochi,
  },
  {
    key: 'blooming-flower', name: 'Blooming flower', category: 'Illustrations',
    description: 'A flat, editorial flower that sways, turns toward your pointer and blooms petal by petal when clicked.',
    tip: 'Move your pointer around it, hover it, then click to bloom (click again to close).',
    tags: [categoryTag('Illustrations'), 'illustration', 'flower', 'stagger', 'toggle'], build: bloomingFlower,
  },
  {
    key: 'day-night-switch', name: 'Day & night switch', category: 'Interactive UI',
    description: 'A toggle where the sun becomes the moon: the knob stretches across, the rays fold away, clouds drift out and stars pop in.',
    tip: 'Click the switch to change day into night, and again to go back.',
    tags: [categoryTag('Interactive UI'), 'toggle', 'switch', 'ui', 'dark-mode'], build: dayNightSwitch,
  },
  {
    key: 'task-checkbox', name: 'Task checkbox', category: 'Interactive UI',
    description: 'A to-do item that draws its tick stroke by stroke, strikes itself through and pops a little confetti.',
    tip: 'Click the task to tick it off, and again to undo.',
    tags: [categoryTag('Interactive UI'), 'checkbox', 'toggle', 'ui', 'todo'], build: taskCheckbox,
  },
  {
    key: 'bouncy-headline', name: 'Bouncy headline', category: 'Typography',
    description: 'A word whose letters wave, pop when you hover them and jump in a wave when you click.',
    tip: 'Run your pointer across the letters, then click the word.',
    tags: [categoryTag('Typography'), 'typography', 'text', 'stagger', 'squash-and-stretch'], build: bouncyHeadline,
  },
  {
    key: 'like-burst', name: 'Like burst', category: 'Celebrations',
    description: 'A heart that squashes, pops, bursts into sparks and rolls its counter up when you like it.',
    tip: 'Click the heart to like it, and again to unlike.',
    tags: [categoryTag('Celebrations'), 'like', 'heart', 'toggle', 'burst', 'counter'], build: likeBurst,
  },
  {
    key: 'morning-coffee', name: 'Morning coffee', category: 'Illustrations',
    description: 'A warm still life: steam curls up and drifts toward your pointer; click to stir — the spoon rocks and the latte heart swirls.',
    tip: 'Move your pointer left and right to blow the steam, then click the mug.',
    tags: [categoryTag('Illustrations'), 'illustration', 'still-life', 'loop', 'cosy'], build: morningCoffee,
  },
  {
    key: 'reward-badge', name: 'Reward badge', category: 'Celebrations',
    description: 'A medal that ducks, flips like a tossed coin, pops and showers confetti when it is earned.',
    tip: 'Click the medal, or press “Celebrate”.',
    tags: [categoryTag('Celebrations'), 'reward', 'badge', 'confetti', 'trigger', 'gamification'], build: rewardBadge,
  },
  {
    key: 'inchworm-loader', name: 'Inchworm loader', category: 'Loaders',
    description: 'A progress bar with an inchworm riding its leading edge. Drive the Progress slider; at 100 it jumps for joy.',
    tip: 'Drag the Progress slider all the way to 100.',
    tags: [categoryTag('Loaders'), 'loader', 'progress', 'slider', 'character'], build: inchwormLoader,
  },
];
