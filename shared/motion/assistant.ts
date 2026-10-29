import { z } from 'zod';
import type { Action, Animation, Input, Layer, Rule, SceneDocument, VarValue, When } from '../scene/schema';
import { BUILTIN_SOUNDS } from '../scene/schema';
import { validateScene } from '../scene/serialize';
import { MOVES, buildMove, colorPath, type MoveKey } from './moves';
import { describeAction, describeWhen, parseExpression, conditionToExpression, ruleGroup, smartTransition, coerceValue } from './logic';
import { setIn } from '../util/paths';
import { uid } from '../util/random';

/**
 * "Ask Claude": the operations Claude may perform on a file, the description of the file it reads,
 * and the code that applies its operations. Claude never edits the file directly — it returns a
 * short reply plus a list of these operations (validated against a schema), and this module applies
 * them one by one, checking every name and condition, then validates the whole file. Anything it
 * can't apply is reported back in plain words instead of being half-done.
 */

export const WHEN_WORDS = ['hover', 'leave', 'click', 'press', 'release', 'key', 'start', 'move_finishes', 'switch_on', 'switch_off', 'button_pressed', 'number_reaches', 'message', 'state_entered'] as const;
export const STEP_WORDS = ['play', 'play_backwards', 'stop', 'pause', 'wait', 'wait_for', 'sound', 'set', 'increase', 'decrease', 'flip', 'turn_on', 'turn_off', 'show', 'hide', 'go_to_state', 'send_message', 'press_button'] as const;
export const PROPERTY_WORDS = ['colour', 'outline_colour', 'outline_width', 'opacity', 'x', 'y', 'rotation', 'scale', 'width', 'height', 'corner_radius', 'text', 'text_size'] as const;
export const MOVE_WORDS = MOVES.map((m) => m.key) as [MoveKey, ...MoveKey[]];

const Step = z.object({
  do: z.enum(STEP_WORDS),
  target: z.string().nullable().describe('What the step acts on: a move, layer, variable, state, sound or message name'),
  value: z.string().nullable().describe('A number of seconds for wait, an amount for set/increase/decrease, a value for send_message'),
});
const Operation = z.object({
  kind: z.enum(['add_interaction', 'change_interaction', 'delete_interaction', 'add_move', 'set_property', 'add_variable', 'add_state']),
  interaction: z.number().int().nullable().describe('For change_interaction / delete_interaction: the interaction number shown in the file description'),
  when: z.enum(WHEN_WORDS).nullable(),
  on: z.string().nullable().describe('For hover/leave/click/press/release: a layer name or "anywhere". For key: Enter, Space, Escape, ArrowUp… For move_finishes: a move name. For switch_on/switch_off/button_pressed/number_reaches: a variable name. For message: the message name. For state_entered: a state name'),
  amount: z.number().nullable().describe('For number_reaches: the value'),
  only_if: z.string().nullable().describe('Conditions in the expression language, e.g. Coins >= 1 and not IsSpinning'),
  steps: z.array(Step).nullable(),
  switch_to_state: z.string().nullable(),
  layer: z.string().nullable(),
  move: z.enum(MOVE_WORDS).nullable(),
  name: z.string().nullable(),
  property: z.enum(PROPERTY_WORDS).nullable(),
  value: z.string().nullable(),
  variable_type: z.enum(['switch', 'button', 'number', 'text', 'choice', 'colour']).nullable(),
  options: z.array(z.string()).nullable(),
});
export const AssistantReplySchema = z.object({
  reply: z.string().describe('A short, friendly answer in plain words: what you changed, or a question if the request is unclear'),
  operations: z.array(Operation),
});
export type AssistantReply = z.infer<typeof AssistantReplySchema>;
export type AssistantOperation = z.infer<typeof Operation>;

export const ASSISTANT_SYSTEM = `You are the animation helper inside Twylo, a motion design tool for beginners (some are 15 years old). People describe what they want in everyday words; you change their file by returning operations. Be warm and brief.

How the file works
- Layers are the things on the canvas (shapes, text, images, groups). "Touch area" layers are invisible hit areas — usually the best target for hover/click on a component.
- Moves are short animations (keyframes on layers). add_move creates one from a preset on a layer: ${MOVES.map((m) => `${m.key} (${m.hint.toLowerCase()})`).join(', ')}. Use value for the target colour of colorTo (#rrggbb).
- Interactions are "When … (only if …) → steps" sentences. Steps run in order.
- Variables (switches, buttons, numbers, text, choices, colours) remember things. States are optional named poses (Rest, Hover…); switch_to_state moves to one.

Operations
- add_interaction: when + on (+ amount), optional only_if, steps, optional switch_to_state.
- change_interaction: interaction number + only the fields to change (others null). steps replaces all steps.
- delete_interaction: interaction number.
- add_move: layer + move (+ name, + value for colorTo). Create the move first, then refer to it by name in a later operation of the same reply. The default name is "<Layer> · <Move name>".
- set_property: layer + property + value (colours #rrggbb, sizes and positions in pixels, rotation in degrees, opacity and scale as numbers like 0.5 or 1.2).
- add_variable: name + variable_type (+ value as the starting value, + options for a choice).
- add_state: name (+ value = the name of the move it plays).

Steps: play, play_backwards, stop, pause, wait_for (target = move); wait (value = seconds); sound (target = one of ${BUILTIN_SOUNDS.join(', ')}); set / increase / decrease (target = variable, value = amount); flip / turn_on / turn_off (target = switch); show / hide (target = layer); go_to_state (target = state); send_message (target = message name, value optional); press_button (target = button).

Conditions (only_if) use this language: Coins >= 1, not IsSpinning, Mode is "hard", [Stars collected] in 1..5, state is Hover, [Move name] is playing, event.key = "Enter"; combine with and / or / not and brackets. Names with spaces go in [square brackets].

Rules
- Only use layers, moves, variables and states that exist in the file description, or that you create earlier in the same reply. Use the exact names.
- If something the person asks for needs a variable that doesn't exist (like a coin counter), create it with add_variable first.
- For hover effects, also add the matching "leave" interaction that undoes it (play_backwards, or stop for looping moves), unless they ask otherwise.
- If the request is unclear or impossible with these operations, return no operations and ask one short question, or say plainly what you can't do.
- Never claim to have done something you didn't return an operation for. Your reply describes the change in one or two plain sentences.`;

// ---------- describing a file to Claude ----------

export function describeFileForAssistant(doc: SceneDocument): string {
  const m = doc.machine;
  const lines: string[] = [`Canvas: ${doc.canvas.width}×${doc.canvas.height}px, background ${doc.canvas.background}. File name: ${doc.meta.name}.`];
  lines.push('', 'Layers (top of the list is drawn on top):');
  const byId = new Map(doc.layers.map((l) => [l.id, l]));
  for (const l of [...doc.layers].reverse()) {
    const parent = l.parentId ? ` in “${byId.get(l.parentId)?.name}”` : '';
    const extra = l.type === 'shape' ? ` ${l.props.kind} ${Math.round(l.props.width)}×${Math.round(l.props.height)} ${l.props.fill.type !== 'none' ? l.props.fill.color : 'no fill'}` : l.type === 'text' ? ` “${l.props.text.slice(0, 40)}”` : l.type === 'drawing' ? ` freehand drawing, ${l.props.strokes.length} strokes (props.reveal 0–1 is how much is drawn)` : '';
    lines.push(`- ${l.name} (${l.type}${extra})${parent}${l.locked ? ' [locked]' : ''}`);
  }
  lines.push('', `Moves: ${m.animations.length ? m.animations.map((a) => `${a.name} (${a.duration}s, ${a.loop})`).join('; ') : 'none yet'}`);
  lines.push(`Variables: ${m.inputs.length ? m.inputs.map((i) => `${i.name} (${i.type}${i.type === 'enum' ? `: ${i.options?.join('/')}` : ''}, starts ${JSON.stringify(i.default)})`).join('; ') : 'none'}`);
  if (m.states?.length) lines.push(`States: ${m.states.map((s) => `${s.name}${s.id === m.initialState ? ' (start)' : ''} plays ${m.animations.find((a) => a.id === s.animationId)?.name ?? 'nothing'}`).join('; ')}`);
  lines.push('', 'Interactions:');
  if (!m.rules.length) lines.push('none yet');
  m.rules.forEach((r, i) => {
    const only = r.only.length ? ` only if ${conditionToExpression(ruleGroup(r), doc)}` : '';
    const from = r.from ? ` (while in ${m.states?.find((s) => s.id === r.from)?.name})` : '';
    const to = r.to ? `switch to ${m.states?.find((s) => s.id === r.to)?.name}; ` : '';
    lines.push(`${i + 1}. When ${describeWhen(r.when, doc)}${from}${only} → ${to}${r.do.map((a) => describeAction(a, doc)).join('; ') || 'nothing'}${r.enabled === false ? ' [switched off]' : ''}`);
  });
  return lines.join('\n');
}

// ---------- applying operations ----------

export type ApplyResult = { doc: SceneDocument; changes: string[]; problems: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[“”"’']/g, '').replace(/\s+/g, ' ').trim();
function findByName<T extends { name: string }>(list: T[], name: string | null | undefined): T | undefined {
  if (!name) return undefined;
  const n = norm(name);
  return list.find((x) => norm(x.name) === n) ?? list.find((x) => norm(x.name).startsWith(n)) ?? list.find((x) => norm(x.name).includes(n));
}

class Problem extends Error {}
const need = <T>(v: T | undefined | null, msg: string): T => { if (v === undefined || v === null) throw new Problem(msg); return v; };

export function applyOperations(doc0: SceneDocument, ops: AssistantOperation[]): ApplyResult {
  let doc = structuredClone(doc0);
  const changes: string[] = [];
  const problems: string[] = [];
  // Real layers win over groups with the same name ("Underline" the group vs "Underline" the shape).
  const layer = (name: string | null) => need(findByName(doc.layers.filter((l) => l.type !== 'group'), name) ?? findByName(doc.layers, name), `there’s no layer called “${name ?? ''}”`);
  const move = (name: string | null) => need(findByName(doc.machine.animations, name), `there’s no move called “${name ?? ''}”`);
  const variable = (name: string | null, types?: Input['type'][]) => {
    const v = need(findByName(doc.machine.inputs, name), `there’s no switch or value called “${name ?? ''}”`);
    if (types && !types.includes(v.type)) throw new Problem(`“${v.name}” isn’t a ${types.map((t) => ({ boolean: 'switch', trigger: 'button', number: 'number' } as Record<string, string>)[t] ?? t).join(' or ')}`);
    return v;
  };
  const state = (name: string | null) => need(findByName(doc.machine.states ?? [], name), `there’s no state called “${name ?? ''}”`);

  const toWhen = (op: AssistantOperation): When => {
    const w = need(op.when, 'it needs to say when it happens');
    if (w === 'hover' || w === 'leave' || w === 'click' || w === 'press' || w === 'release') {
      const event = ({ hover: 'enter', leave: 'leave', click: 'click', press: 'down', release: 'up' } as const)[w];
      const anywhere = !op.on || /^(anywhere|canvas|the canvas|everywhere)$/i.test(op.on.trim());
      return { type: 'pointer', event, ...(anywhere ? {} : { layerId: layer(op.on).id }) };
    }
    if (w === 'key') { const k = (op.on ?? 'Enter').trim(); return { type: 'key', key: /^space$/i.test(k) ? ' ' : /^any/i.test(k) ? 'any' : k.length === 1 ? k.toLowerCase() : k.replace(/^./, (c) => c.toUpperCase()) }; }
    if (w === 'start') return { type: 'start' };
    if (w === 'move_finishes') return { type: 'finished', animationId: move(op.on).id };
    if (w === 'switch_on' || w === 'switch_off') return { type: 'boolean', inputId: variable(op.on, ['boolean']).id, value: w === 'switch_on' };
    if (w === 'button_pressed') return { type: 'trigger', inputId: variable(op.on, ['trigger']).id };
    if (w === 'number_reaches') return { type: 'number', inputId: variable(op.on, ['number']).id, op: '>=', value: need(op.amount, 'it needs the number to reach') };
    if (w === 'message') return { type: 'event', name: need(op.on, 'it needs the message name').trim().slice(0, 40) };
    return { type: 'stateEnter', stateId: state(op.on).id };
  };
  const toStep = (s: AssistantOperation['steps'] extends (infer U)[] | null ? U : never): Action => {
    const num = (v: string | null, d: number) => { const n = Number(v); return v === null || Number.isNaN(n) ? d : n; };
    switch (s.do) {
      case 'play': return { type: 'play', animationId: move(s.target).id, direction: 'forward', from: 'start' };
      case 'play_backwards': return { type: 'play', animationId: move(s.target).id, direction: 'reverse', from: 'current' };
      case 'stop': return { type: 'stop', animationId: move(s.target).id };
      case 'pause': return { type: 'pause', animationId: move(s.target).id };
      case 'wait_for': return { type: 'waitFor', animationId: move(s.target).id };
      case 'wait': return { type: 'wait', seconds: Math.max(0, Math.min(60, num(s.value ?? s.target, 0.5))) };
      case 'sound': {
        const k = norm(s.target ?? 'pop').replace(/\s+/g, '');
        const sound = (BUILTIN_SOUNDS as readonly string[]).find((x) => x === k) ?? BUILTIN_SOUNDS.find((x) => k.includes(x)) ?? 'pop';
        return { type: 'sound', sound: sound as (typeof BUILTIN_SOUNDS)[number], assetId: null, volume: 0.7 };
      }
      case 'set': {
        const v = variable(s.target);
        if (v.type === 'number') return { type: 'setNumber', inputId: v.id, mode: 'set', value: num(s.value, 0) };
        if (v.type === 'boolean') return { type: 'setBoolean', inputId: v.id, value: /^(on|true|yes|1)$/i.test(s.value ?? '') ? 'on' : 'off' };
        if (v.type === 'trigger') return { type: 'fire', inputId: v.id };
        return { type: 'setVar', inputId: v.id, value: coerceValue(v, parseValue(v, s.value)) };
      }
      case 'increase': case 'decrease': { const v = variable(s.target, ['number']); const n = Math.abs(num(s.value, 1)); return { type: 'setNumber', inputId: v.id, mode: 'add', value: s.do === 'increase' ? n : -n }; }
      case 'flip': case 'turn_on': case 'turn_off': return { type: 'setBoolean', inputId: variable(s.target, ['boolean']).id, value: s.do === 'flip' ? 'toggle' : s.do === 'turn_on' ? 'on' : 'off' };
      case 'show': case 'hide': return { type: 'visibility', layerId: layer(s.target).id, visible: s.do };
      case 'go_to_state': return { type: 'setState', stateId: state(s.target).id };
      case 'send_message': return { type: 'emit', name: need(s.target, 'a message needs a name').slice(0, 40), ...(s.value ? { value: Number.isNaN(Number(s.value)) ? s.value : Number(s.value) } : {}) };
      case 'press_button': return { type: 'fire', inputId: variable(s.target, ['trigger']).id };
    }
  };
  const conditions = (text: string | null): Pick<Rule, 'only' | 'match'> => {
    if (!text?.trim()) return { only: [] };
    const r = parseExpression(text, doc);
    if (!r.ok) throw new Problem(`I couldn’t use the condition “${text}”: ${r.error}`);
    return { only: r.group.items, match: r.group.op === 'all' ? undefined : r.group.op };
  };

  ops.forEach((op, n) => {
    const before = doc;
    try {
      switch (op.kind) {
        case 'add_interaction': {
          const when = toWhen(op);
          const rule: Rule = { id: uid('ru'), when, ...conditions(op.only_if), do: (op.steps ?? []).map(toStep), transition: smartTransition(when, doc.machine.defaults), ...(op.switch_to_state ? { to: state(op.switch_to_state).id } : {}) };
          doc = { ...doc, machine: { ...doc.machine, rules: [...doc.machine.rules, rule] } };
          changes.push(`Added: When ${describeWhen(when, doc)}${op.only_if ? ` (only if ${op.only_if})` : ''} → ${[rule.to ? `switch to ${op.switch_to_state}` : '', ...rule.do.map((a) => describeAction(a, doc).toLowerCase())].filter(Boolean).join(', ') || 'nothing yet'}`);
          break;
        }
        case 'change_interaction': {
          const i = need(op.interaction, 'it needs the interaction number') - 1;
          const r = need(doc.machine.rules[i], `there’s no interaction ${i + 1}`);
          const next: Rule = { ...r };
          if (op.when) { next.when = toWhen(op); next.transition = r.transition ?? smartTransition(next.when, doc.machine.defaults); }
          if (op.only_if !== null) Object.assign(next, conditions(op.only_if));
          if (op.steps) next.do = op.steps.map(toStep);
          if (op.switch_to_state) next.to = state(op.switch_to_state).id;
          doc = { ...doc, machine: { ...doc.machine, rules: doc.machine.rules.map((x, j) => (j === i ? next : x)) } };
          changes.push(`Changed interaction ${i + 1}: When ${describeWhen(next.when, doc)} → ${next.do.map((a) => describeAction(a, doc).toLowerCase()).join(', ') || (next.to ? 'switch state' : 'nothing yet')}`);
          break;
        }
        case 'delete_interaction': {
          const i = need(op.interaction, 'it needs the interaction number') - 1;
          const r = need(doc.machine.rules[i], `there’s no interaction ${i + 1}`);
          doc = { ...doc, machine: { ...doc.machine, rules: doc.machine.rules.filter((_, j) => j !== i) } };
          changes.push(`Removed interaction ${i + 1} (When ${describeWhen(r.when, doc0)})`);
          break;
        }
        case 'add_move': {
          const l = layer(op.layer);
          const key = need(op.move, 'it needs to say which kind of move');
          if (key === 'colorTo' && !colorPath(l)) throw new Problem(`“${l.name}” can’t change colour`);
          const built = buildMove(key, l, doc, { color: op.value && /^#[0-9a-f]{6}$/i.test(op.value) ? op.value : undefined });
          const def = MOVES.find((x) => x.key === key)!;
          const name = uniqueName((op.name?.trim() || `${l.name} · ${def.name}`).slice(0, 60), doc.machine.animations.map((a) => a.name));
          const anim: Animation = { id: uid('an'), name, duration: built.duration, loop: built.loop, tracks: built.tracks };
          doc = { ...doc, machine: { ...doc.machine, animations: [...doc.machine.animations, anim] } };
          changes.push(`Made a move “${name}” (${def.hint.toLowerCase()})`);
          break;
        }
        case 'set_property': {
          const l = layer(op.layer);
          const prop = need(op.property, 'it needs the property to change');
          const raw = need(op.value, 'it needs the new value');
          const { path, value } = propertyEdit(l, prop, raw, doc);
          doc = { ...doc, layers: doc.layers.map((x) => (x.id === l.id ? setIn(x, path, value) : x)) };
          changes.push(`Set ${l.name}’s ${prop.replace('_', ' ')} to ${raw}`);
          break;
        }
        case 'add_variable': {
          const name = need(op.name?.trim(), 'a switch or value needs a name').slice(0, 40);
          if (findByName(doc.machine.inputs, name) && norm(findByName(doc.machine.inputs, name)!.name) === norm(name)) throw new Problem(`there’s already something called “${name}”`);
          const type = ({ switch: 'boolean', button: 'trigger', number: 'number', text: 'string', choice: 'enum', colour: 'color' } as const)[need(op.variable_type, 'it needs to say what kind of value')];
          const options = type === 'enum' ? (op.options?.filter(Boolean).slice(0, 32) ?? ['One', 'Two']) : undefined;
          const input: Input = { id: uid('in'), name, type, default: false, ...(options ? { options } : {}), ...(type === 'number' ? { min: 0, max: 100 } : {}) };
          input.default = type === 'trigger' ? false : coerceValue(input, op.value !== null ? parseValue(input, op.value) : type === 'enum' ? options![0] : type === 'color' ? '#ff5a36' : type === 'string' ? '' : type === 'number' ? 0 : false);
          if (type === 'number' && typeof input.default === 'number' && input.default > 100) input.max = Math.max(100, input.default * 2);
          doc = { ...doc, machine: { ...doc.machine, inputs: [...doc.machine.inputs, input] } };
          changes.push(`Added ${({ boolean: 'a switch', trigger: 'a button', number: 'a number', string: 'a text value', enum: 'a choice', color: 'a colour', vector2: 'a vector' } as const)[type]} “${name}”${type !== 'trigger' ? ` starting at ${JSON.stringify(input.default)}` : ''}`);
          break;
        }
        case 'add_state': {
          const name = need(op.name?.trim(), 'a state needs a name').slice(0, 40);
          const anim = op.value ? move(op.value) : null;
          const states = doc.machine.states ?? [];
          const st = { id: uid('st'), name: uniqueName(name, states.map((s) => s.name)), animationId: anim?.id ?? null, x: 80 + states.length * 190, y: 80 };
          doc = { ...doc, machine: { ...doc.machine, states: [...states, st], initialState: doc.machine.initialState ?? st.id } };
          changes.push(`Added a state “${st.name}”${anim ? ` that plays ${anim.name}` : ''}`);
          break;
        }
      }
    } catch (e) {
      doc = before;
      if (e instanceof Problem) problems.push(`Step ${n + 1} skipped: ${e.message}.`);
      else throw e;
    }
  });
  const v = validateScene(doc);
  if (!v.ok) return { doc: doc0, changes: [], problems: [...problems, `I couldn’t make these changes safely (${v.issues[0]?.message ?? 'the file didn’t check out'}), so nothing was changed.`] };
  return { doc: v.scene, changes, problems };
}

function parseValue(v: Input, raw: string | null): VarValue {
  if (raw === null) return v.default;
  if (v.type === 'number') return Number(raw) || 0;
  if (v.type === 'boolean') return /^(on|true|yes|1)$/i.test(raw);
  if (v.type === 'vector2') { const [x, y] = raw.split(/[ ,]+/).map(Number); return { x: x || 0, y: y || 0 }; }
  return raw;
}

function propertyEdit(l: Layer, prop: (typeof PROPERTY_WORDS)[number], raw: string, doc: SceneDocument): { path: string; value: number | string } {
  const n = Number(raw.replace(/px|°|%$/g, ''));
  const isNum = !Number.isNaN(n);
  const color = /^#[0-9a-f]{6}$/i.test(raw.trim()) ? raw.trim().toLowerCase() : null;
  const num = () => { if (!isNum) throw new Problem(`“${raw}” isn’t a number`); return n; };
  switch (prop) {
    case 'colour': { const p = colorPath(l); if (!p || !color) throw new Problem(!p ? `“${l.name}” has no colour to change` : `“${raw}” isn’t a colour like #ff8800`); return { path: p, value: color }; }
    case 'outline_colour': if (l.type !== 'shape' || !color) throw new Problem(`can’t set the outline colour of “${l.name}”`); return { path: 'props.stroke.color', value: color };
    case 'outline_width': if (l.type !== 'shape') throw new Problem(`“${l.name}” has no outline`); return { path: 'props.stroke.width', value: Math.max(0, num()) };
    case 'opacity': return { path: 'opacity', value: Math.min(1, Math.max(0, num() > 1 ? num() / 100 : num())) };
    case 'x': return { path: 'transform.x', value: toLocal(l, doc, 'x', num() / doc.canvas.width) };
    case 'y': return { path: 'transform.y', value: toLocal(l, doc, 'y', num() / doc.canvas.height) };
    case 'rotation': return { path: 'transform.rotation', value: num() };
    case 'scale': return { path: 'transform.scale', value: Math.max(0.01, num() > 10 ? num() / 100 : num()) };
    case 'width': case 'height': if (l.type !== 'shape') throw new Problem(`“${l.name}” isn’t a shape, so its ${prop} can’t be set directly. Try scale`); return { path: `props.${prop}`, value: Math.max(1, num()) };
    case 'corner_radius': if (l.type !== 'shape') throw new Problem(`“${l.name}” has no corners`); return { path: 'props.radius', value: Math.max(0, num()) };
    case 'text': if (l.type !== 'text') throw new Problem(`“${l.name}” isn’t a text layer`); return { path: 'props.text', value: raw.slice(0, 2000) };
    case 'text_size': if (l.type !== 'text') throw new Problem(`“${l.name}” isn’t a text layer`); return { path: 'props.size', value: Math.max(0.005, num() / Math.min(doc.canvas.width, doc.canvas.height)) };
  }
}

function uniqueName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

/** Canvas position (fraction) → the layer's own position inside its groups (groups act as pivots). */
function toLocal(l: Layer, doc: SceneDocument, axis: 'x' | 'y', world: number): number {
  const chain: Layer[] = [];
  for (let p = l.parentId ? doc.layers.find((x) => x.id === l.parentId) : undefined; p && chain.length < 32; p = p.parentId ? doc.layers.find((x) => x.id === p!.parentId) : undefined) chain.unshift(p);
  let v = world;
  for (const g of chain) {
    // Outermost first: undo each group's placement (rotation inside groups isn't accounted for).
    const k = g.transform.scale * (axis === 'x' ? g.transform.scaleX : g.transform.scaleY);
    v = 0.5 + (v - g.transform[axis]) / (k || 1);
  }
  return v;
}
