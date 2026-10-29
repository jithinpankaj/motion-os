import type { Action, Condition, ConditionGroup, Input, LeafCondition, Rule, SceneDocument, Transition, VarValue, When } from '../scene/schema';

/**
 * The shared logic layer for interactions: evaluating condition trees, describing everything in plain
 * language, explaining why a condition failed, a small safe expression language (parsed, never run as
 * code), and the defaults new connections start with. The runtime, the inspector, the Logic Canvas and
 * the debugger all use these, so they always agree.
 */

export type EventPayload = { kind: 'start' | 'pointer' | 'key' | 'event' | 'input' | 'finished' | 'state' | 'manual'; label: string; key?: string; name?: string; value?: string | number; x?: number; y?: number; layerId?: string | null };
export type EvalCtx = { values: Record<string, VarValue>; state: string | null; playing: (animationId: string) => boolean; event: EventPayload | null };
export type CondTrace = { cond: Condition; pass: boolean; children?: CondTrace[] };

// ---------- defaults ----------

export const DEFAULT_TRANSITION: Required<Transition> = {
  duration: 0.18, delay: 0, easing: 'easeOut', playback: 'restart', loop: 'default', interruption: 'allow', priority: 'normal', blend: 'crossfade', playStateMove: true,
};
/** Smart defaults written onto a new connection (visible and editable — never hidden). */
export function smartTransition(when: When, machineDefaults?: Transition): Transition {
  const base: Transition = when.type === 'pointer' && (when.event === 'enter' || when.event === 'leave')
    ? { duration: 0.2, easing: 'easeOut', priority: 'normal', interruption: 'allow' }
    : when.type === 'pointer' ? { duration: 0.12, easing: 'easeOut', priority: 'normal', interruption: 'allow' }
    : { duration: 0.2, easing: 'easeInOut', priority: 'normal', interruption: 'allow' };
  return { ...base, ...(machineDefaults ?? {}) };
}
export const resolveTransition = (r: Pick<Rule, 'transition'>): Required<Transition> => ({ ...DEFAULT_TRANSITION, ...(r.transition ?? {}) });
export const PRIORITY_RANK = { low: 0, normal: 1, high: 2, critical: 3 } as const;

// ---------- walking ----------

export const ruleGroup = (r: Pick<Rule, 'only' | 'match'>): ConditionGroup => ({ type: 'group', op: r.match ?? 'all', items: r.only });
export function forEachCondition(c: Condition, fn: (leaf: LeafCondition) => void) {
  if (c.type === 'group') c.items.forEach((x) => forEachCondition(x, fn)); else fn(c);
}
export function forEachAction(list: Action[], fn: (a: Action) => void) {
  for (const a of list) {
    fn(a);
    if (a.type === 'parallel') forEachAction(a.actions, fn);
    if (a.type === 'branch') { forEachCondition(a.if, () => {}); forEachAction(a.then, fn); forEachAction(a.else, fn); }
  }
}
/** Every leaf condition in a rule, including the ones inside branch steps. */
export function ruleConditions(r: Rule): LeafCondition[] {
  const out: LeafCondition[] = [];
  forEachCondition(ruleGroup(r), (l) => out.push(l));
  forEachAction([...r.do, ...(r.exit ?? [])], (a) => { if (a.type === 'branch') forEachCondition(a.if, (l) => out.push(l)); });
  return out;
}
export function mapActions(list: Action[], fn: (a: Action) => Action | null): Action[] {
  const out: Action[] = [];
  for (const a0 of list) {
    let a: Action | null = a0;
    if (a.type === 'parallel') a = { ...a, actions: mapActions(a.actions, fn) };
    else if (a.type === 'branch') a = { ...a, then: mapActions(a.then, fn), else: mapActions(a.else, fn) };
    a = fn(a);
    if (a) out.push(a);
  }
  return out;
}
export function mapConditions(c: ConditionGroup, fn: (l: LeafCondition) => LeafCondition | null): ConditionGroup {
  return { ...c, items: c.items.flatMap((x): Condition[] => { if (x.type === 'group') return [mapConditions(x, fn)]; const y = fn(x); return y ? [y] : []; }) };
}

/** Counts for the "Advanced logic · …" summary, and whether the compact view can show the rule as-is. */
export function logicSummary(r: Rule) {
  let conditions = 0, groups = 0, actions = 0, branches = 0, parallels = 0, waits = 0;
  const g = (c: Condition, depth: number) => { if (c.type === 'group') { if (depth > 0) groups++; c.items.forEach((x) => g(x, depth + 1)); } else conditions++; };
  g(ruleGroup(r), 0);
  forEachAction([...r.do, ...(r.exit ?? [])], (a) => {
    if (a.type === 'branch') { branches++; g(a.if, 1); } else if (a.type === 'parallel') parallels++; else { actions++; if (a.type === 'wait' || a.type === 'waitFor') waits++; }
  });
  const simple = groups === 0 && branches === 0 && parallels === 0 && waits === 0 && (r.match ?? 'all') === 'all';
  return { conditions, groups, actions, branches, parallels, waits, simple };
}
export function summaryText(r: Rule) {
  const s = logicSummary(r);
  const bits = [`${s.conditions} condition${s.conditions === 1 ? '' : 's'}`, `${s.actions} action${s.actions === 1 ? '' : 's'}`];
  if (s.branches) bits.push(`${s.branches} branch${s.branches === 1 ? '' : 'es'}`);
  if (s.parallels) bits.push(`${s.parallels} parallel group${s.parallels === 1 ? '' : 's'}`);
  return `Advanced logic · ${bits.join(' · ')}`;
}

// ---------- evaluation ----------

const cmp = (op: string, a: number, b: number) => op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b : op === '!=' ? Math.abs(a - b) > 1e-9 : Math.abs(a - b) < 1e-9;
const textCmp = (op: string, a: string, b: string) => op === 'is' || op === '=' ? a === b : op === 'isNot' || op === '!=' ? a !== b : op === 'contains' ? a.includes(b) : op === 'startsWith' ? a.startsWith(b) : false;
const asNum = (v: VarValue | undefined) => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' ? Number(v) || 0 : 0);
const asText = (v: VarValue | undefined) => (typeof v === 'object' && v ? `${v.x},${v.y}` : String(v ?? ''));

export function evalLeaf(c: LeafCondition, ctx: EvalCtx): boolean {
  switch (c.type) {
    case 'boolean': return !!ctx.values[c.inputId] === c.value;
    case 'number': return cmp(c.op, asNum(ctx.values[c.inputId]), c.value);
    case 'text': return textCmp(c.op, asText(ctx.values[c.inputId]), c.value);
    case 'range': { const v = asNum(ctx.values[c.inputId]); return v >= Math.min(c.min, c.max) && v <= Math.max(c.min, c.max); }
    case 'compare': return cmp(c.op, asNum(ctx.values[c.inputId]), asNum(ctx.values[c.otherId]));
    case 'vector': { const v = ctx.values[c.inputId]; return typeof v === 'object' && !!v && cmp(c.op, v[c.axis], c.value); }
    case 'state': return (ctx.state === c.stateId) === c.is;
    case 'playing': return ctx.playing(c.animationId) === c.is;
    case 'event': {
      const e = ctx.event; if (!e) return false;
      const v = e[c.field];
      if (v === undefined || v === null) return false;
      if (typeof c.value === 'number' || (typeof v === 'number' && !(TEXT_ONLY as readonly string[]).includes(c.op))) return cmp(c.op, Number(v), Number(c.value));
      return textCmp(c.op, String(v), String(c.value));
    }
  }
}
const TEXT_ONLY = ['is', 'isNot', 'contains', 'startsWith'] as const;
export function traceCondition(c: Condition, ctx: EvalCtx): CondTrace {
  if (c.type !== 'group') return { cond: c, pass: evalLeaf(c, ctx) };
  const children = c.items.map((x) => traceCondition(x, ctx));
  const n = children.filter((x) => x.pass).length;
  const pass = c.op === 'all' ? n === children.length : c.op === 'any' ? n > 0 || children.length === 0 : n === 0;
  return { cond: c, pass, children };
}
export const evalCondition = (c: Condition, ctx: EvalCtx) => traceCondition(c, ctx).pass;

// ---------- plain language ----------

const OP_WORDS: Record<string, string> = { '>': 'is more than', '<': 'is less than', '>=': 'is at least', '<=': 'is at most', '=': 'is', '!=': 'is not', is: 'is', isNot: 'is not', contains: 'contains', startsWith: 'starts with' };
const OP_SYMBOL: Record<string, string> = { '>': '>', '<': '<', '>=': '≥', '<=': '≤', '=': '=', '!=': '≠' };
export const opSymbol = (op: string) => OP_SYMBOL[op] ?? OP_WORDS[op] ?? op;
const nameOf = (doc: SceneDocument, id: string) => doc.machine.inputs.find((i) => i.id === id)?.name ?? 'a missing variable';
const stateName = (doc: SceneDocument, id: string) => doc.machine.states?.find((s) => s.id === id)?.name ?? 'a missing state';
const animName = (doc: SceneDocument, id: string) => doc.machine.animations.find((a) => a.id === id)?.name ?? 'a missing move';
const layerName = (doc: SceneDocument, id?: string | null) => (id ? doc.layers.find((l) => l.id === id)?.name ?? 'a missing layer' : 'the canvas');
export const fmtValue = (v: VarValue | undefined, input?: Input) => {
  if (v === undefined) return '—';
  if (typeof v === 'boolean') return input?.type === 'boolean' || !input ? (v ? 'on' : 'off') : String(v);
  if (typeof v === 'number') return String(+v.toFixed(3));
  if (typeof v === 'object') return `(${+v.x.toFixed(2)}, ${+v.y.toFixed(2)})`;
  return `“${v}”`;
};

export function describeCondition(c: Condition, doc: SceneDocument): string {
  if (c.type === 'group') return `${c.op === 'all' ? 'all' : c.op === 'any' ? 'any' : 'none'} of ${c.items.length}`;
  switch (c.type) {
    case 'boolean': return `${nameOf(doc, c.inputId)} is ${c.value ? 'on' : 'off'}`;
    case 'number': return `${nameOf(doc, c.inputId)} ${opSymbol(c.op)} ${c.value}`;
    case 'text': return `${nameOf(doc, c.inputId)} ${OP_WORDS[c.op]} “${c.value}”`;
    case 'range': return `${nameOf(doc, c.inputId)} is between ${c.min} and ${c.max}`;
    case 'compare': return `${nameOf(doc, c.inputId)} ${opSymbol(c.op)} ${nameOf(doc, c.otherId)}`;
    case 'vector': return `${nameOf(doc, c.inputId)}.${c.axis} ${opSymbol(c.op)} ${c.value}`;
    case 'state': return `state ${c.is ? 'is' : 'is not'} ${stateName(doc, c.stateId)}`;
    case 'playing': return `${animName(doc, c.animationId)} ${c.is ? 'is playing' : 'is not playing'}`;
    case 'event': return `the event’s ${c.field} ${OP_WORDS[c.op] ?? c.op} ${typeof c.value === 'string' ? `“${c.value}”` : c.value}`;
  }
}

/** Why a single condition failed, in a sentence. */
export function explainLeaf(c: LeafCondition, doc: SceneDocument, ctx: EvalCtx): string {
  const input = 'inputId' in c ? doc.machine.inputs.find((i) => i.id === c.inputId) : undefined;
  const now = 'inputId' in c ? fmtValue(ctx.values[c.inputId], input) : '';
  const n = 'inputId' in c ? nameOf(doc, c.inputId) : '';
  switch (c.type) {
    case 'boolean': return `${n} is ${now}, but it needs to be ${c.value ? 'on' : 'off'}.`;
    case 'number': return `${n} is ${now}. It needs to be ${c.op === '>=' ? `at least ${c.value}` : c.op === '<=' ? `at most ${c.value}` : c.op === '>' ? `more than ${c.value}` : c.op === '<' ? `less than ${c.value}` : c.op === '!=' ? `anything but ${c.value}` : `exactly ${c.value}`}.`;
    case 'text': return `${n} is ${now}, but it needs to ${c.op === 'is' ? 'be' : c.op === 'isNot' ? 'not be' : c.op === 'contains' ? 'contain' : 'start with'} “${c.value}”.`;
    case 'range': return `${n} is ${now}. It needs to be between ${c.min} and ${c.max}.`;
    case 'compare': return `${n} is ${now} and ${nameOf(doc, c.otherId)} is ${fmtValue(ctx.values[c.otherId])}; it needs ${n} ${opSymbol(c.op)} ${nameOf(doc, c.otherId)}.`;
    case 'vector': { const v = ctx.values[c.inputId]; return `${n}.${c.axis} is ${typeof v === 'object' && v ? +v[c.axis].toFixed(2) : '—'}. It needs to be ${opSymbol(c.op)} ${c.value}.`; }
    case 'state': return `The state is ${ctx.state ? stateName(doc, ctx.state) : 'not set'}; this needs it ${c.is ? 'to be' : 'not to be'} ${stateName(doc, c.stateId)}.`;
    case 'playing': return `${animName(doc, c.animationId)} ${ctx.playing(c.animationId) ? 'is' : 'isn’t'} playing; this needs it ${c.is ? 'playing' : 'stopped'}.`;
    case 'event': return `The event’s ${c.field} was ${ctx.event?.[c.field] ?? 'empty'}; this needs it ${OP_WORDS[c.op] ?? c.op} ${c.value}.`;
  }
}
/** Sentences explaining why a condition tree failed (only the parts that decided it). */
export function explainTrace(t: CondTrace, doc: SceneDocument, ctx: EvalCtx): string[] {
  if (t.pass) return [];
  if (t.cond.type !== 'group') return [explainLeaf(t.cond, doc, ctx)];
  const kids = t.children ?? [];
  if (t.cond.op === 'all') return kids.flatMap((k) => explainTrace(k, doc, ctx));
  if (t.cond.op === 'any') { const why = kids.flatMap((k) => explainTrace(k, doc, ctx)); return why.length > 1 ? [`None of the alternatives held: ${why.join(' ')}`] : why; }
  return kids.filter((k) => k.pass).map((k) => `This must not be true, but it is: ${describeCondition(k.cond, doc)}.`);
}

export function describeWhen(w: When, doc: SceneDocument): string {
  switch (w.type) {
    case 'start': return 'it starts';
    case 'trigger': return `${nameOf(doc, w.inputId)} is pressed`;
    case 'boolean': return `${nameOf(doc, w.inputId)} turns ${w.value ? 'on' : 'off'}`;
    case 'number': return `${nameOf(doc, w.inputId)} ${opSymbol(w.op)} ${w.value}`;
    case 'pointer': return `${{ click: 'someone clicks', enter: 'the pointer enters', leave: 'the pointer leaves', down: 'someone presses on', up: 'someone lets go of' }[w.event]} ${layerName(doc, w.layerId)}`;
    case 'finished': return `${animName(doc, w.animationId)} finishes`;
    case 'key': return w.key === 'any' ? 'any key is pressed' : `the ${w.key === ' ' ? 'Space' : w.key} key is pressed`;
    case 'event': return `the event “${w.name}” happens`;
    case 'stateEnter': return `the state becomes ${stateName(doc, w.stateId)}`;
    case 'changed': return `${nameOf(doc, w.inputId)} changes`;
  }
}
export function describeAction(a: Action, doc: SceneDocument): string {
  switch (a.type) {
    case 'play': return `${a.direction === 'reverse' ? 'Play backwards' : 'Play'} ${animName(doc, a.animationId)}${a.from === 'current' ? ' (from where it is)' : ''}`;
    case 'stop': return `Stop ${animName(doc, a.animationId)}`;
    case 'pause': return `Pause ${animName(doc, a.animationId)}`;
    case 'setBoolean': return a.value === 'toggle' ? `Flip ${nameOf(doc, a.inputId)}` : `Set ${nameOf(doc, a.inputId)} ${a.value}`;
    case 'fire': return `Press ${nameOf(doc, a.inputId)}`;
    case 'setNumber': return a.mode === 'set' ? `Set ${nameOf(doc, a.inputId)} = ${a.value}` : a.value >= 0 ? `Increase ${nameOf(doc, a.inputId)} by ${a.value}` : `Decrease ${nameOf(doc, a.inputId)} by ${-a.value}`;
    case 'setVar': return `Set ${nameOf(doc, a.inputId)} = ${fmtValue(a.value)}`;
    case 'sound': return `Play sound ${a.assetId ? '(uploaded)' : a.sound}`;
    case 'setState': return `Go to state ${stateName(doc, a.stateId)}`;
    case 'visibility': return `${a.visible === 'show' ? 'Show' : a.visible === 'hide' ? 'Hide' : 'Show/hide'} ${layerName(doc, a.layerId)}`;
    case 'emit': return `Send event “${a.name}”${a.value !== undefined ? ` (${a.value})` : ''}`;
    case 'wait': return `Wait ${a.seconds} s`;
    case 'waitFor': return `Wait for ${animName(doc, a.animationId)} to finish`;
    case 'parallel': return `At the same time (${a.actions.length})`;
    case 'branch': return `If ${conditionToExpression(a.if, doc)}`;
  }
}
export const ruleLabel = (r: Rule, doc: SceneDocument) => r.name?.trim() || (r.to ? `→ ${stateName(doc, r.to)}` : `When ${describeWhen(r.when, doc)}`);

// ---------- expressions: a small, safe condition language ----------
// Grammar: or := and ("or" and)* ; and := not ("and" not)* ; not := "not" not | "(" or ")" | comparison
// comparison := name [op value] | name "in" n ".." n | name "." ("x"|"y") op n | "state" ("is"|"is not") name
//             | name "is" ["not"] "playing" | "event" "." field op value
// Names with spaces are written in [square brackets]. Nothing is ever evaluated as JavaScript.

type Tok = { k: 'name' | 'num' | 'str' | 'op' | 'punct' | 'end'; v: string; at: number };
const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'state', 'playing', 'event', 'true', 'false', 'on', 'off', 'contains', 'starts', 'with']);
function lex(src: string): Tok[] | { error: string; at: number } {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '[') { const j = src.indexOf(']', i); if (j < 0) return { error: 'A name in [brackets] is missing its closing ]', at: i }; out.push({ k: 'name', v: src.slice(i + 1, j).trim(), at: i }); i = j + 1; continue; }
    if (ch === '"' || ch === '“' || ch === '”' || ch === "'") { const close = ch === '“' ? '”' : ch; const j = src.indexOf(close, i + 1); if (j < 0) return { error: 'A text value is missing its closing quote', at: i }; out.push({ k: 'str', v: src.slice(i + 1, j), at: i }); i = j + 1; continue; }
    const two = src.slice(i, i + 2);
    if (['>=', '<=', '!=', '..', '==', '≥', '≤', '≠'].includes(two) || ['≥', '≤', '≠'].includes(ch)) {
      const v = ch === '≥' ? '>=' : ch === '≤' ? '<=' : ch === '≠' ? '!=' : two === '==' ? '=' : two;
      out.push({ k: two === '..' ? 'punct' : 'op', v, at: i }); i += ['≥', '≤', '≠'].includes(ch) ? 1 : 2; continue;
    }
    if ('<>='.includes(ch)) { out.push({ k: 'op', v: ch, at: i }); i++; continue; }
    if ('().'.includes(ch)) { out.push({ k: 'punct', v: ch, at: i }); i++; continue; }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num && (ch !== '-' || /[\d]/.test(src[i + 1] ?? ''))) { out.push({ k: 'num', v: num[0], at: i }); i += num[0].length; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (word) { out.push({ k: 'name', v: word[0], at: i }); i += word[0].length; continue; }
    return { error: `Unexpected “${ch}”`, at: i };
  }
  out.push({ k: 'end', v: '', at: src.length });
  return out;
}

export type ParseResult = { ok: true; group: ConditionGroup } | { ok: false; error: string; at: number };
export function parseExpression(src: string, doc: SceneDocument): ParseResult {
  const toks = lex(src);
  if (!Array.isArray(toks)) return { ok: false, ...toks };
  if (toks.length === 1) return { ok: true, group: { type: 'group', op: 'all', items: [] } };
  let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const isWord = (w: string) => peek().k === 'name' && peek().v.toLowerCase() === w;
  class Fail extends Error { constructor(msg: string, public at: number) { super(msg); } }
  const findVar = (t: Tok) => {
    const v = doc.machine.inputs.find((x) => x.name.toLowerCase() === t.v.toLowerCase());
    if (!v) throw new Fail(`There’s no variable called “${t.v}”`, t.at);
    return v;
  };
  const value = (): { kind: 'num' | 'str' | 'bool' | 'var'; v: any; at: number } => {
    const t = next();
    if (t.k === 'num') return { kind: 'num', v: Number(t.v), at: t.at };
    if (t.k === 'str') return { kind: 'str', v: t.v, at: t.at };
    if (t.k === 'name' && ['true', 'on'].includes(t.v.toLowerCase())) return { kind: 'bool', v: true, at: t.at };
    if (t.k === 'name' && ['false', 'off'].includes(t.v.toLowerCase())) return { kind: 'bool', v: false, at: t.at };
    if (t.k === 'name') return { kind: 'var', v: findVar(t), at: t.at };
    throw new Fail('Expected a value here', t.at);
  };
  const op = (): string => {
    const t = peek();
    if (t.k === 'op') { p++; return t.v; }
    if (isWord('is')) { p++; if (isWord('not')) { p++; return 'isNot'; } return 'is'; }
    if (isWord('contains')) { p++; return 'contains'; }
    if (isWord('starts')) { p++; if (!isWord('with')) throw new Fail('Did you mean “starts with”?', peek().at); p++; return 'startsWith'; }
    throw new Fail('Expected a comparison like =, ≥, <, is or contains', t.at);
  };
  const comparison = (): Condition => {
    const t = peek();
    if (t.k !== 'name') throw new Fail('Expected a variable, “state” or “event”', t.at);
    if (t.v.toLowerCase() === 'state' && !doc.machine.inputs.some((i) => i.name.toLowerCase() === 'state')) {
      p++;
      if (!isWord('is')) throw new Fail('Write “state is …” or “state is not …”', peek().at);
      p++; let is = true; if (isWord('not')) { p++; is = false; }
      const s = next(); const st = doc.machine.states?.find((x) => x.name.toLowerCase() === s.v.toLowerCase());
      if (!st) throw new Fail(`There’s no state called “${s.v}”`, s.at);
      return { type: 'state', stateId: st.id, is };
    }
    if (t.v.toLowerCase() === 'event' && peek().k === 'name') {
      p++;
      if (peek().v !== '.') throw new Fail('Write event.key, event.name, event.value, event.x or event.y', peek().at);
      p++; const f = next();
      if (!['key', 'name', 'value', 'x', 'y'].includes(f.v)) throw new Fail('Events have key, name, value, x and y', f.at);
      const o = op(); const v = value();
      if (v.kind === 'var' || v.kind === 'bool') throw new Fail('Compare event fields with a number or a “text”', v.at);
      return { type: 'event', field: f.v as any, op: (o === '=' && v.kind === 'str' ? 'is' : o === '!=' && v.kind === 'str' ? 'isNot' : o) as any, value: v.v };
    }
    const anim = doc.machine.animations.find((a) => a.name.toLowerCase() === t.v.toLowerCase());
    const variable = doc.machine.inputs.find((x) => x.name.toLowerCase() === t.v.toLowerCase());
    if (anim && !variable) {
      p++;
      if (!isWord('is')) throw new Fail(`Write “${anim.name} is playing” or “${anim.name} is not playing”`, peek().at);
      p++; let is = true; if (isWord('not')) { p++; is = false; }
      if (!isWord('playing')) throw new Fail('Expected “playing”', peek().at);
      p++; return { type: 'playing', animationId: anim.id, is };
    }
    const v = findVar(next());
    if (peek().k === 'punct' && peek().v === '.') {
      p++; const ax = next();
      if (ax.v !== 'x' && ax.v !== 'y') throw new Fail('Vectors have .x and .y', ax.at);
      const o = op(); const val = value(); if (val.kind !== 'num') throw new Fail('Compare with a number', val.at);
      return { type: 'vector', inputId: v.id, axis: ax.v, op: o as any, value: val.v };
    }
    if (isWord('in')) {
      p++; const a = value(); if (peek().v !== '..') throw new Fail('Write a range like 5..10', peek().at); p++; const b = value();
      if (a.kind !== 'num' || b.kind !== 'num') throw new Fail('A range needs two numbers', a.at);
      return { type: 'range', inputId: v.id, min: a.v, max: b.v };
    }
    // A bare boolean variable means "is on".
    const t2 = peek();
    if (t2.k === 'end' || (t2.k === 'name' && ['and', 'or'].includes(t2.v.toLowerCase())) || (t2.k === 'punct' && t2.v === ')')) {
      if (v.type !== 'boolean') throw new Fail(`${v.name} isn’t on/off — compare it with a value`, t2.at);
      return { type: 'boolean', inputId: v.id, value: true };
    }
    const o = op(); const val = value();
    if (val.kind === 'var') {
      if (!['>', '<', '=', '>=', '<=', '!='].includes(o)) throw new Fail('Compare two variables with =, ≠, <, >, ≤ or ≥', val.at);
      return { type: 'compare', inputId: v.id, op: o as any, otherId: val.v.id };
    }
    if (v.type === 'boolean') {
      if (val.kind !== 'bool') throw new Fail(`${v.name} is on/off — compare it with on or off`, val.at);
      return { type: 'boolean', inputId: v.id, value: o === '!=' || o === 'isNot' ? !val.v : val.v };
    }
    if (v.type === 'number' || v.type === 'trigger') {
      if (val.kind !== 'num') throw new Fail(`${v.name} is a number — compare it with a number`, val.at);
      return { type: 'number', inputId: v.id, op: (o === 'is' ? '=' : o === 'isNot' ? '!=' : o) as any, value: val.v };
    }
    if (val.kind !== 'str') throw new Fail(`${v.name} holds text — compare it with “text in quotes”`, val.at);
    if (v.type === 'enum' && v.options && (o === 'is' || o === 'isNot' || o === '=' || o === '!=') && !v.options.includes(val.v)) throw new Fail(`${v.name} can only be ${v.options.map((x) => `“${x}”`).join(', ')}`, val.at);
    return { type: 'text', inputId: v.id, op: (o === '=' ? 'is' : o === '!=' ? 'isNot' : o) as any, value: val.v };
  };
  const unary = (): Condition => {
    if (isWord('not')) { p++; const x = unary(); return { type: 'group', op: 'none', items: [x] }; }
    if (peek().k === 'punct' && peek().v === '(') { p++; const x = orExpr(); if (peek().v !== ')') throw new Fail('Missing )', peek().at); p++; return x; }
    return comparison();
  };
  const chain = (op: 'all' | 'any', word: string, sub: () => Condition): Condition => {
    const items = [sub()];
    while (isWord(word)) { p++; items.push(sub()); }
    if (items.length === 1) return items[0];
    return { type: 'group', op, items: items.flatMap((x) => (x.type === 'group' && x.op === op ? x.items : [x])) };
  };
  const andExpr = () => chain('all', 'and', unary);
  const orExpr = (): Condition => chain('any', 'or', andExpr);
  try {
    const root = orExpr();
    if (peek().k !== 'end') throw new Fail('Expected “and”, “or” or the end', peek().at);
    return { ok: true, group: root.type === 'group' ? root : { type: 'group', op: 'all', items: [root] } };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: e.message, at: e.at };
    throw e;
  }
}

const quote = (n: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !KEYWORDS.has(n.toLowerCase()) ? n : `[${n}]`);
const lit = (v: string | number) => (typeof v === 'number' ? String(v) : `"${v}"`);
export function conditionToExpression(c: Condition, doc: SceneDocument, top = true): string {
  if (c.type === 'group') {
    if (!c.items.length) return c.op === 'none' ? 'not ()' : '';
    const parts = c.items.map((x) => conditionToExpression(x, doc, false));
    if (c.op === 'none') return c.items.length === 1 ? `not ${wrap(c.items[0], parts[0])}` : `not (${parts.join(' or ')})`;
    const s = parts.map((p, i) => (c.items[i].type === 'group' && (c.items[i] as ConditionGroup).op !== 'none' ? `(${p})` : p)).join(c.op === 'all' ? ' and ' : ' or ');
    return top ? s : s;
  }
  const v = (id: string) => quote(nameOf(doc, id));
  switch (c.type) {
    case 'boolean': return c.value ? v(c.inputId) : `${v(c.inputId)} = off`;
    case 'number': return `${v(c.inputId)} ${c.op} ${c.value}`;
    case 'text': return `${v(c.inputId)} ${c.op === 'isNot' ? 'is not' : c.op === 'startsWith' ? 'starts with' : c.op} ${lit(c.value)}`;
    case 'range': return `${v(c.inputId)} in ${c.min}..${c.max}`;
    case 'compare': return `${v(c.inputId)} ${c.op} ${v(c.otherId)}`;
    case 'vector': return `${v(c.inputId)}.${c.axis} ${c.op} ${c.value}`;
    case 'state': return `state ${c.is ? 'is' : 'is not'} ${quote(stateName(doc, c.stateId))}`;
    case 'playing': return `${quote(animName(doc, c.animationId))} is ${c.is ? '' : 'not '}playing`;
    case 'event': return `event.${c.field} ${c.op === 'isNot' ? 'is not' : c.op === 'startsWith' ? 'starts with' : c.op} ${lit(c.value)}`;
  }
}
const wrap = (c: Condition, s: string) => (c.type === 'group' ? `(${s})` : s);

/** Autocomplete for the expression editor: names and keywords that start with the word being typed. */
export function expressionSuggestions(prefix: string, doc: SceneDocument): string[] {
  const p = prefix.toLowerCase().replace(/^\[/, '');
  const names = [
    ...doc.machine.inputs.map((i) => quote(i.name)),
    ...doc.machine.animations.map((a) => `${quote(a.name)} is playing`),
    ...(doc.machine.states ?? []).map((s) => `state is ${quote(s.name)}`),
    'event.key', 'event.name', 'event.value', 'and', 'or', 'not',
  ];
  return [...new Set(names)].filter((n) => n.toLowerCase().replace(/^\[/, '').startsWith(p)).slice(0, 8);
}

// ---------- variables ----------

export const VAR_LABEL: Record<Input['type'], string> = { boolean: 'Toggle', trigger: 'Button', number: 'Number', string: 'Text', enum: 'Choice', vector2: 'Vector', color: 'Colour' };
export function defaultValueFor(type: Input['type']): VarValue {
  return type === 'boolean' || type === 'trigger' ? false : type === 'number' ? 0 : type === 'vector2' ? { x: 0, y: 0 } : type === 'color' ? '#ff5a36' : type === 'enum' ? 'One' : '';
}
/** Bring a value within a variable's type and limits (used by the runtime and by overrides). */
export function coerceValue(input: Input, v: VarValue): VarValue {
  switch (input.type) {
    case 'boolean': case 'trigger': return !!v;
    case 'number': { const n = typeof v === 'number' ? v : Number(v) || 0; return Math.min(input.max ?? Infinity, Math.max(input.min ?? -Infinity, n)); }
    case 'string': return String(typeof v === 'object' ? '' : v).slice(0, input.maxLength ?? 200);
    case 'enum': { const s = String(v); return input.options?.includes(s) ? s : (input.options?.[0] ?? s); }
    case 'color': { const s = String(v); return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : String(input.default); }
    case 'vector2': { const o = typeof v === 'object' && v ? v : { x: 0, y: 0 }; const c = (n: number) => Math.min(input.max ?? Infinity, Math.max(input.min ?? -Infinity, n)); return { x: c(o.x), y: c(o.y) }; }
  }
}
