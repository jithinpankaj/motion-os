import { describe, it, expect } from 'vitest';
import { applyOperations, describeFileForAssistant, AssistantReplySchema, type AssistantOperation } from '../../shared/motion/assistant';
import { MOTION_PRESETS } from '../../shared/motion/presets';
import { MotionRuntime } from '../../shared/motion/runtime';
import { deserializeScene, serializeScene } from '../../shared/scene/serialize';
import { resolveHierarchy } from '../../src/engine/renderer';

const blank: Omit<AssistantOperation, 'kind'> = { interaction: null, when: null, on: null, amount: null, only_if: null, steps: null, switch_to_state: null, layer: null, move: null, name: null, property: null, value: null, variable_type: null, options: null };
const op = (o: Partial<AssistantOperation> & Pick<AssistantOperation, 'kind'>): AssistantOperation => ({ ...blank, ...o });
const headline = () => MOTION_PRESETS.find((p) => p.key === 'bouncy-headline')!.build();

describe('Ask Claude: applying operations', () => {
  it('builds “click → bounce, only if there’s a coin” from a variable, a move and an interaction in one reply', () => {
    const doc = headline();
    const r = applyOperations(doc, [
      op({ kind: 'add_variable', name: 'Coins', variable_type: 'number', value: '2' }),
      op({ kind: 'add_move', layer: 'H', move: 'bounce' }),
      op({ kind: 'add_interaction', when: 'click', on: 'anywhere', only_if: 'Coins >= 1', steps: [{ do: 'decrease', target: 'Coins', value: '1' }, { do: 'play', target: 'H · Bounce', value: null }, { do: 'sound', target: 'pop', value: null }] }),
    ]);
    expect(r.problems).toEqual([]);
    expect(r.changes).toHaveLength(3);
    expect(r.changes[2]).toBe('Added: When someone clicks the canvas (only if Coins >= 1) → decrease coins by 1, play h · bounce, play sound pop');
    // It really works: two clicks spend two coins, the third is refused with a reason.
    const rt = new MotionRuntime(deserializeScene(serializeScene(r.doc)));
    const coins = r.doc.machine.inputs.find((i) => i.name === 'Coins')!.id;
    rt.pointer('click', null); rt.pointer('click', null); rt.pointer('click', null);
    expect(rt.values[coins]).toBe(0);
    expect(rt.trace.at(-1)!.rules.find((x) => x.outcome === 'conditions')!.why).toEqual(['Coins is 0. It needs to be at least 1.']);
  });
  it('skips what doesn’t fit the file and says why, keeping the rest', () => {
    const r = applyOperations(headline(), [
      op({ kind: 'add_interaction', when: 'click', on: 'Rocket', steps: [{ do: 'play', target: 'Jump', value: null }] }),
      op({ kind: 'add_interaction', when: 'click', on: 'anywhere', only_if: 'Gold > 2', steps: [] }),
      op({ kind: 'set_property', layer: 'Underline', property: 'colour', value: '#ff0000' }),
      op({ kind: 'delete_interaction', interaction: 42 }),
    ]);
    expect(r.problems).toEqual([
      'Step 1 skipped: there’s no layer called “Rocket”.',
      'Step 2 skipped: I couldn’t use the condition “Gold > 2”: There’s no variable called “Gold”.',
      'Step 4 skipped: there’s no interaction 42.',
    ]);
    expect(r.changes).toEqual(['Set Underline’s colour to #ff0000']);
    expect(r.doc.layers.find((l) => l.name === 'Underline' && l.type === 'shape')!.type).toBe('shape');
  });
  it('changes and deletes interactions by number, and edits layer properties in pixels', () => {
    const doc = headline();
    const before = doc.machine.rules.length;
    const r = applyOperations(doc, [
      op({ kind: 'change_interaction', interaction: 2, when: 'key', on: 'Space' }),
      op({ kind: 'delete_interaction', interaction: 3 }),
      op({ kind: 'set_property', layer: 'Underline', property: 'x', value: '540' }),
    ]);
    expect(r.problems).toEqual([]);
    expect(r.doc.machine.rules).toHaveLength(before - 1);
    expect(r.doc.machine.rules[1].when).toEqual({ type: 'key', key: ' ' });
    // 540 px on the canvas, even though the underline sits inside a group.
    expect(resolveHierarchy(r.doc.layers).find((l) => l.name === 'Underline' && l.type === 'shape')!.transform.x * 1080).toBeCloseTo(540, 1);
  });
  it('describes the file in plain words, with numbered interactions Claude can refer to', () => {
    const text = describeFileForAssistant(MOTION_PRESETS.find((p) => p.key === 'slot-bird')!.build());
    expect(text).toContain('Variables: Spin (trigger');
    expect(text).toMatch(/\n\d+\. When Spin is pressed only if Coins >= 1 and IsSpinning = off →/);
  });
  it('the reply schema accepts Claude’s structured answer', () => {
    expect(AssistantReplySchema.safeParse({ reply: 'Done!', operations: [op({ kind: 'add_state', name: 'Hover' })] }).success).toBe(true);
    expect(AssistantReplySchema.safeParse({ reply: 'Done!', operations: [{ kind: 'rm -rf' }] }).success).toBe(false);
  });
});
