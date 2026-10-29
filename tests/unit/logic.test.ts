import { describe, it, expect } from 'vitest';
import { MotionRuntime } from '../../shared/motion/runtime';
import { conditionToExpression, parseExpression, summaryText, logicSummary } from '../../shared/motion/logic';
import { createLayer, createScene } from '../../shared/scene/defaults';
import { deserializeScene, serializeScene } from '../../shared/scene/serialize';
import type { Animation, Input, Rule, SceneDocument } from '../../shared/scene/schema';

/** A button with Idle/Hover/Spin states and the spec's coin example: coins, a spinning flag, a sequence. */
function machine(): SceneDocument {
  const d = createScene();
  const btn = createLayer('shape', { id: 'btn', name: 'Button' });
  const badge = createLayer('shape', { id: 'badge', name: 'Badge' });
  d.layers = [btn, badge];
  const mv = (id: string, duration: number, to: number, loop: Animation['loop'] = 'once'): Animation => ({ id, name: id[0].toUpperCase() + id.slice(1), duration, loop, tracks: [{ id: `t_${id}`, layerId: 'btn', path: 'transform.scale', keyframes: [{ id: `k1_${id}`, t: 0, value: 1, easing: 'linear' }, { id: `k2_${id}`, t: duration, value: to, easing: 'linear' }] }] });
  const vars: Input[] = [
    { id: 'coins', name: 'Coins', type: 'number', default: 2, min: 0, max: 99 },
    { id: 'spinning', name: 'IsSpinning', type: 'boolean', default: false },
    { id: 'mode', name: 'Mode', type: 'enum', default: 'easy', options: ['easy', 'hard'] },
    { id: 'name', name: 'Player name', type: 'string', default: 'Ana', maxLength: 10 },
    { id: 'aim', name: 'Aim', type: 'vector2', default: { x: 0, y: 0 }, min: -1, max: 1 },
    { id: 'tint', name: 'Tint', type: 'color', default: '#ff0000' },
    { id: 'wins', name: 'Wins', type: 'number', default: 0 },
  ];
  d.machine = {
    inputs: vars,
    animations: [mv('idle', 1, 1, 'loop'), mv('hover', 0.4, 1.2), mv('anticipation', 0.3, 0.9), mv('spin', 0.6, 2), mv('win', 0.5, 1.5)],
    states: [{ id: 'sIdle', name: 'Idle', animationId: 'idle', x: 0, y: 0 }, { id: 'sHover', name: 'Hover', animationId: 'hover', x: 200, y: 0 }],
    initialState: 'sIdle',
    bindings: [],
    rules: [
      { id: 'toHover', when: { type: 'pointer', event: 'enter', layerId: 'btn' }, only: [], do: [], from: 'sIdle', to: 'sHover', transition: { duration: 0.2, priority: 'normal' } },
      { id: 'toIdle', when: { type: 'pointer', event: 'leave', layerId: 'btn' }, only: [], do: [], from: 'sHover', to: 'sIdle' },
      {
        id: 'spinRule', name: 'Spin', when: { type: 'pointer', event: 'click', layerId: 'btn' },
        only: [{ type: 'number', inputId: 'coins', op: '>=', value: 1 }, { type: 'boolean', inputId: 'spinning', value: false }],
        do: [
          { type: 'setBoolean', inputId: 'spinning', value: 'on' },
          { type: 'setNumber', inputId: 'coins', mode: 'add', value: -1 },
          { type: 'play', animationId: 'anticipation', direction: 'forward', from: 'start' },
          { type: 'waitFor', animationId: 'anticipation' },
          { type: 'parallel', actions: [{ type: 'play', animationId: 'spin', direction: 'forward', from: 'start' }, { type: 'visibility', layerId: 'badge', visible: 'hide' }] },
          { type: 'waitFor', animationId: 'spin' },
          { type: 'branch', if: { type: 'group', op: 'all', items: [{ type: 'number', inputId: 'coins', op: '<=', value: 0 }] }, then: [{ type: 'emit', name: 'broke' }], else: [{ type: 'play', animationId: 'win', direction: 'forward', from: 'start' }] },
          { type: 'setBoolean', inputId: 'spinning', value: 'off' },
        ],
      },
      { id: 'onBroke', when: { type: 'event', name: 'broke' }, only: [], do: [{ type: 'setNumber', inputId: 'wins', mode: 'set', value: -1 }] },
      { id: 'enterKey', when: { type: 'key', key: 'any' }, only: [{ type: 'event', field: 'key', op: 'is', value: 'Enter' }], do: [{ type: 'setNumber', inputId: 'wins', mode: 'add', value: 10 }] },
    ],
  };
  return d;
}
const run = (rt: MotionRuntime, s: number) => { for (let t = 0; t < s - 1e-9; t += 0.01) rt.step(0.01); };
const scale = (rt: MotionRuntime) => rt.layers().find((l) => l.id === 'btn')!.transform.scale;

describe('states and connections', () => {
  it('starts in the initial state and moves between states only from the right one', () => {
    const doc = deserializeScene(serializeScene(machine()));
    const rt = new MotionRuntime(doc);
    expect(rt.state).toBe('sIdle');
    rt.pointer('leave', 'btn'); // only works from Hover
    expect(rt.state).toBe('sIdle');
    expect(rt.trace.at(-1)!.rules[0]).toMatchObject({ outcome: 'wrongState' });
    rt.pointer('enter', 'btn');
    expect(rt.state).toBe('sHover');
    run(rt, 0.5);
    expect(scale(rt)).toBeCloseTo(1.2, 3); // the Hover state's move played
    rt.pointer('leave', 'btn');
    expect(rt.state).toBe('sIdle');
  });
  it('only one connection changes the state per event — the highest priority wins', () => {
    const d = machine();
    d.machine.states!.push({ id: 'sAlt', name: 'Alt', animationId: null, x: 0, y: 0 });
    d.machine.rules.push({ id: 'alt', when: { type: 'pointer', event: 'enter', layerId: 'btn' }, only: [], do: [], from: 'sIdle', to: 'sAlt', transition: { priority: 'high' } });
    const rt = new MotionRuntime(deserializeScene(d));
    rt.pointer('enter', 'btn');
    expect(rt.state).toBe('sAlt');
    expect(rt.trace.at(-1)!.rules.map((r) => r.outcome)).toEqual(['ran', 'outranked']);
  });
});

describe('ordered and parallel steps', () => {
  it('runs the coin-spin sequence step by step: waits for moves, runs parallel steps, then branches', () => {
    const rt = new MotionRuntime(deserializeScene(machine()));
    rt.pointer('click', 'btn');
    expect(rt.values).toMatchObject({ spinning: true, coins: 1 });
    expect(rt.isPlaying('anticipation')).toBe(true);
    expect(rt.isPlaying('spin')).toBe(false); // waiting for the anticipation
    rt.pointer('click', 'btn'); // blocked: already spinning
    expect(rt.values.coins).toBe(1);
    expect(rt.trace.at(-1)!.rules[0].why![0]).toBe('IsSpinning is on, but it needs to be off.');
    run(rt, 0.35);
    expect(rt.isPlaying('spin')).toBe(true);
    expect(rt.layers().find((l) => l.id === 'badge')!.visible).toBe(false); // ran in parallel
    run(rt, 0.7);
    expect(rt.isPlaying('win')).toBe(true); // 1 coin left → the "else" branch
    expect(rt.values.spinning).toBe(false);
    const job = rt.debugJobs().at(-1)!;
    expect(job.steps.map((s) => s.text)).toContain('If Coins <= 0 → no');
    // Second spin: 0 coins left → the branch emits "broke", which another rule hears.
    rt.pointer('click', 'btn');
    run(rt, 1.2);
    expect(rt.values.wins).toBe(-1);
    // No coins: the rule doesn't run, and the debugger says why in plain words.
    rt.pointer('click', 'btn');
    expect(rt.trace.at(-1)!.rules[0].why).toEqual(['Coins is 0. It needs to be at least 1.']);
  });
  it('event payloads: a key rule only fires for Enter', () => {
    const rt = new MotionRuntime(deserializeScene(machine()));
    rt.key('a');
    expect(rt.values.wins).toBe(0);
    rt.key('Enter');
    expect(rt.values.wins).toBe(10);
  });
});

describe('transitions', () => {
  const one = (t: Rule['transition'], extra: Partial<Rule> = {}) => {
    const d = machine();
    d.machine.rules = [{ id: 'r', when: { type: 'trigger', inputId: 'go' }, only: [], do: [{ type: 'play', animationId: 'spin', direction: 'forward', from: 'start' }], transition: t, ...extra }];
    d.machine.inputs.push({ id: 'go', name: 'Go', type: 'trigger', default: false });
    return new MotionRuntime(deserializeScene(d));
  };
  it('delay waits before starting; ignore drops events while running; queue runs them afterwards', () => {
    const delayed = one({ delay: 0.5 });
    delayed.fire('go');
    run(delayed, 0.3);
    expect(delayed.isPlaying('spin')).toBe(false);
    run(delayed, 0.3);
    expect(delayed.isPlaying('spin')).toBe(true);

    const ignoring = one({ interruption: 'ignore' }, { do: [{ type: 'play', animationId: 'spin', direction: 'forward', from: 'start' }, { type: 'waitFor', animationId: 'spin' }, { type: 'setNumber', inputId: 'wins', mode: 'add', value: 1 }] });
    ignoring.fire('go'); ignoring.fire('go');
    expect(ignoring.trace.at(-1)!.rules[0].outcome).toBe('ignored');
    run(ignoring, 1.5);
    expect(ignoring.values.wins).toBe(1);

    const queued = one({ interruption: 'queue' }, { do: [{ type: 'play', animationId: 'spin', direction: 'forward', from: 'start' }, { type: 'waitFor', animationId: 'spin' }, { type: 'setNumber', inputId: 'wins', mode: 'add', value: 1 }] });
    queued.fire('go'); queued.fire('go');
    expect(queued.trace.at(-1)!.rules[0].outcome).toBe('queued');
    run(queued, 2);
    expect(queued.values.wins).toBe(2);
  });
  it('replace stops other moves on the same properties; additive adds on top; loop and reverse playback apply', () => {
    const d = machine();
    d.machine.inputs.push({ id: 'go', name: 'Go', type: 'trigger', default: false }, { id: 'go2', name: 'Go2', type: 'trigger', default: false });
    d.machine.rules = [
      { id: 'a', when: { type: 'trigger', inputId: 'go' }, only: [], do: [{ type: 'play', animationId: 'idle', direction: 'forward', from: 'start' }] },
      { id: 'b', when: { type: 'trigger', inputId: 'go2' }, only: [], do: [{ type: 'play', animationId: 'spin', direction: 'forward', from: 'start', loop: 'loop' }], transition: { blend: 'replace' } },
    ];
    const rt = new MotionRuntime(deserializeScene(d));
    rt.fire('go'); rt.fire('go2');
    expect(rt.isPlaying('idle')).toBe(false);
    run(rt, 1.3);
    expect(rt.isPlaying('spin')).toBe(true); // looping, though the move itself plays once

    d.machine.rules[1].transition = { blend: 'additive' };
    d.machine.animations.find((a) => a.id === 'hover')!.tracks[0].keyframes[1].value = 1.5;
    d.machine.rules[0].do = [{ type: 'play', animationId: 'hover', direction: 'forward', from: 'start' }];
    d.machine.rules[1].do = [{ type: 'play', animationId: 'win', direction: 'forward', from: 'start' }];
    const add = new MotionRuntime(deserializeScene(d));
    add.fire('go'); run(add, 0.5); add.fire('go2'); run(add, 0.6);
    expect(scale(add)).toBeCloseTo(1.5 + 0.5, 2); // hover's 1.5 plus win's +0.5
  });
  it('a lower-priority connection can’t interrupt a running higher-priority transition', () => {
    const d = machine();
    d.machine.states!.push({ id: 'sSpin', name: 'Spin', animationId: 'spin', x: 0, y: 0 });
    d.machine.rules = [
      { id: 'big', when: { type: 'pointer', event: 'click', layerId: 'btn' }, only: [], do: [], to: 'sSpin', transition: { priority: 'high' } },
      { id: 'small', when: { type: 'pointer', event: 'enter', layerId: 'btn' }, only: [], do: [], to: 'sHover', transition: { priority: 'low' } },
    ];
    const rt = new MotionRuntime(deserializeScene(d));
    rt.pointer('click', 'btn');
    rt.pointer('enter', 'btn');
    expect(rt.state).toBe('sSpin');
    expect(rt.trace.at(-1)!.rules[0].outcome).toBe('blocked');
    run(rt, 0.7);
    rt.pointer('enter', 'btn');
    expect(rt.state).toBe('sHover');
  });
});

describe('variables', () => {
  it('keeps every type within its limits', () => {
    const rt = new MotionRuntime(deserializeScene(machine()));
    rt.setVar('mode', 'impossible');
    expect(rt.values.mode).toBe('easy');
    rt.setVar('mode', 'hard');
    expect(rt.values.mode).toBe('hard');
    rt.setVar('name', 'A very long name indeed');
    expect(rt.values.name).toBe('A very lon');
    rt.setVar('aim', { x: 5, y: -0.5 });
    expect(rt.values.aim).toEqual({ x: 1, y: -0.5 });
    rt.setVar('tint', 'red');
    expect(rt.values.tint).toBe('#ff0000');
    expect(() => deserializeScene({ ...machine(), machine: { ...machine().machine, rules: [], inputs: [{ id: 'x', name: 'X', type: 'enum', default: 'nope', options: ['a'] }] } })).toThrow(/doesn’t fit/);
  });
});

describe('expressions', () => {
  const doc = machine();
  it('parses readable conditions into nested groups and prints them back', () => {
    const r = parseExpression('Coins >= 5 and not IsSpinning and (Mode is "hard" or event.key = "Enter") and Wins in 1..3', doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.group.op).toBe('all');
    expect(r.group.items).toHaveLength(4);
    expect(r.group.items[1]).toEqual({ type: 'group', op: 'none', items: [{ type: 'boolean', inputId: 'spinning', value: true }] });
    expect(r.group.items[2]).toMatchObject({ type: 'group', op: 'any' });
    const text = conditionToExpression(r.group, doc);
    const again = parseExpression(text, doc);
    expect(again.ok && again.group).toEqual(r.group);
    expect(parseExpression('[Player name] starts with "A" and state is Hover and Hover is playing', doc).ok).toBe(true);
  });
  it('explains mistakes instead of running anything', () => {
    expect(parseExpression('Gold > 1', doc)).toMatchObject({ ok: false, error: 'There’s no variable called “Gold”' });
    expect(parseExpression('Coins > "lots"', doc)).toMatchObject({ ok: false, error: 'Coins is a number, so compare it with a number' });
    expect(parseExpression('Mode is "medium"', doc)).toMatchObject({ ok: false });
    expect(parseExpression('alert(1)', doc).ok).toBe(false);
    expect(parseExpression('Coins > 1; process.exit()', doc).ok).toBe(false);
  });
  it('summarises advanced logic without flattening it', () => {
    const rule = machine().machine.rules.find((r) => r.id === 'spinRule')!;
    expect(logicSummary(rule).simple).toBe(false);
    expect(summaryText(rule)).toBe('Advanced logic · 3 conditions · 10 actions · 1 branch · 1 parallel group');
  });
});

describe('library: the slot bird runs the coin example', () => {
  it('spins in order, ignores clicks while spinning, hits the jackpot on the third spin and explains an empty purse', async () => {
    const { MOTION_PRESETS } = await import('../../shared/motion/presets');
    const doc = deserializeScene(serializeScene(MOTION_PRESETS.find((p) => p.key === 'slot-bird')!.build()));
    const v = (n: string) => doc.machine.inputs.find((i) => i.name === n)!.id;
    const a = (n: string) => doc.machine.animations.find((x) => x.name === n)!.id;
    const rt = new MotionRuntime(doc);
    rt.setNumber(v('Coins'), 3);
    rt.fire(v('Spin'));
    expect(rt.values[v('IsSpinning')]).toBe(true);
    rt.fire(v('Spin')); // ignored: already spinning
    expect(rt.values[v('Coins')]).toBe(2);
    run(rt, 0.3);
    expect(rt.isPlaying(a('Spin · miss'))).toBe(false); // still crouching
    run(rt, 0.2);
    expect(rt.isPlaying(a('Spin · miss'))).toBe(true);
    run(rt, 3);
    expect(rt.values[v('IsSpinning')]).toBe(false);
    rt.key('Enter'); run(rt, 3.5);
    rt.fire(v('Spin')); run(rt, 2.5);
    expect(rt.isPlaying(a('Jackpot!'))).toBe(true);
    run(rt, 2);
    expect(rt.values).toMatchObject({ [v('Coins')]: 0, [v('Spins')]: 0, [v('IsSpinning')]: false });
    rt.fire(v('Spin'));
    expect(rt.trace.at(-1)!.rules[0].why).toEqual(['Coins is 0. It needs to be at least 1.']);
  });
});
