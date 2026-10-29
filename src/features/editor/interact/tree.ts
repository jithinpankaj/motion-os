import type { Action, Condition, ConditionGroup, LeafCondition, Rule, SceneDocument } from '../../../../shared/scene/schema';

/**
 * Immutable edits on a rule's nested logic, addressed by paths. The compact inspector, the condition
 * editor and the Logic Canvas all edit through these, so every view changes the same model.
 *
 *  - A condition path is a list of item indexes from the rule's root group.
 *  - A step list is addressed by a ListPath: which root list (do / exit), then (index, key) pairs
 *    stepping into parallel ("actions") or branch ("then" / "else") containers.
 */
export type CondPath = number[];
export type Root = 'do' | 'exit';
export type ListPath = { root: Root; steps: { i: number; key: 'actions' | 'then' | 'else' }[] };
export type StepPath = { list: ListPath; i: number };

// ---------- conditions ----------

export const rootGroup = (r: Rule): ConditionGroup => ({ type: 'group', op: r.match ?? 'all', items: r.only });
export const fromRootGroup = (g: ConditionGroup): Partial<Rule> => ({ only: g.items, match: g.op === 'all' ? undefined : g.op });

export function condAt(g: ConditionGroup, path: CondPath): Condition {
  let c: Condition = g;
  for (const i of path) c = (c as ConditionGroup).items[i];
  return c;
}
/** Replace (or remove, with null) the condition at a path. */
export function setCond(g: ConditionGroup, path: CondPath, next: Condition | null): ConditionGroup {
  if (!path.length) return (next as ConditionGroup) ?? { ...g, items: [] };
  const [i, ...rest] = path;
  const items = [...g.items];
  if (!rest.length) { if (next) items[i] = next; else items.splice(i, 1); }
  else items[i] = setCond(items[i] as ConditionGroup, rest, next);
  return { ...g, items };
}
export function insertCond(g: ConditionGroup, groupPath: CondPath, index: number, c: Condition): ConditionGroup {
  const target = condAt(g, groupPath) as ConditionGroup;
  const items = [...target.items];
  items.splice(Math.max(0, Math.min(index, items.length)), 0, c);
  return groupPath.length ? setCond(g, groupPath, { ...target, items }) : { ...g, items };
}
/** Move a condition (or group) to another group/position. Refuses to move a group into itself. */
export function moveCond(g: ConditionGroup, from: CondPath, toGroup: CondPath, toIndex: number): ConditionGroup {
  if (toGroup.length >= from.length && from.every((v, k) => toGroup[k] === v)) return g;
  const item = condAt(g, from);
  let out = setCond(g, from, null);
  // Removing an earlier sibling shifts later indexes in the same group (or in groups after it).
  const adj = [...toGroup];
  const parent = from.slice(0, -1), fi = from[from.length - 1];
  if (adj.length > parent.length && parent.every((v, k) => adj[k] === v) && adj[parent.length] > fi) adj[parent.length]--;
  let idx = toIndex;
  if (adj.length === parent.length && parent.every((v, k) => adj[k] === v) && toIndex > fi) idx--;
  out = insertCond(out, adj, idx, item);
  return out;
}

export function newLeaf(doc: SceneDocument): LeafCondition {
  const v = doc.machine.inputs.find((i) => i.type !== 'trigger');
  if (!v) return doc.machine.states?.[0] ? { type: 'state', stateId: doc.machine.states[0].id, is: true } : { type: 'event', field: 'key', op: 'is', value: 'Enter' };
  return leafFor(v.id, doc);
}
/** A sensible condition for a variable, by its type. */
export function leafFor(inputId: string, doc: SceneDocument): LeafCondition {
  const v = doc.machine.inputs.find((i) => i.id === inputId)!;
  switch (v.type) {
    case 'boolean': return { type: 'boolean', inputId, value: true };
    case 'number': case 'trigger': return { type: 'number', inputId, op: '>=', value: typeof v.default === 'number' ? v.default : 0 };
    case 'vector2': return { type: 'vector', inputId, axis: 'x', op: '>', value: 0 };
    case 'enum': return { type: 'text', inputId, op: 'is', value: v.options?.[0] ?? '' };
    default: return { type: 'text', inputId, op: 'is', value: String(v.default ?? '') };
  }
}

// ---------- steps ----------

const rootList = (r: Rule, root: Root) => (root === 'do' ? r.do : r.exit ?? []);
export function listAt(r: Rule, lp: ListPath): Action[] {
  let list = rootList(r, lp.root);
  for (const s of lp.steps) { const c = list[s.i] as any; list = c?.[s.key] ?? []; }
  return list;
}
function setList(r: Rule, lp: ListPath, next: Action[]): Partial<Rule> {
  const rec = (list: Action[], steps: ListPath['steps']): Action[] => {
    if (!steps.length) return next;
    const [s, ...rest] = steps;
    const out = [...list];
    const c = out[s.i] as any;
    out[s.i] = { ...c, [s.key]: rec(c[s.key], rest) };
    return out;
  };
  const updated = rec(rootList(r, lp.root), lp.steps);
  return lp.root === 'do' ? { do: updated } : { exit: updated };
}
export const stepAt = (r: Rule, p: StepPath) => listAt(r, p.list)[p.i];
export function setStep(r: Rule, p: StepPath, a: Action | null): Partial<Rule> {
  const list = [...listAt(r, p.list)];
  if (a) list[p.i] = a; else list.splice(p.i, 1);
  return setList(r, p.list, list);
}
export function insertStep(r: Rule, lp: ListPath, index: number, a: Action): Partial<Rule> {
  const list = [...listAt(r, lp)];
  list.splice(Math.max(0, Math.min(index, list.length)), 0, a);
  return setList(r, lp, list);
}
const sameList = (a: ListPath, b: ListPath) => a.root === b.root && a.steps.length === b.steps.length && a.steps.every((s, k) => s.i === b.steps[k].i && s.key === b.steps[k].key);
/** Is list `inner` inside the step at `p` (so moving p there would put it inside itself)? */
const inside = (inner: ListPath, p: StepPath) => inner.root === p.list.root && inner.steps.length > p.list.steps.length
  && p.list.steps.every((s, k) => inner.steps[k].i === s.i && inner.steps[k].key === s.key) && inner.steps[p.list.steps.length].i === p.i;
export function moveStep(r: Rule, from: StepPath, to: ListPath, index: number): Partial<Rule> {
  if (inside(to, from)) return {};
  const item = stepAt(r, from);
  // Apply the removal, then the insertion, on a working copy of the rule.
  let work: Rule = { ...r, ...setStep(r, from, null) };
  const adj: ListPath = { root: to.root, steps: to.steps.map((s) => ({ ...s })) };
  const depth = from.list.steps.length;
  if (adj.root === from.list.root && adj.steps.length > depth && from.list.steps.every((s, k) => adj.steps[k].i === s.i && adj.steps[k].key === s.key) && adj.steps[depth].i > from.i) adj.steps[depth].i--;
  let idx = index;
  if (sameList(adj, from.list) && index > from.i) idx--;
  work = { ...work, ...insertStep(work, adj, idx, item) };
  return { do: work.do, ...(work.exit ? { exit: work.exit } : {}) };
}

/** A new step of a kind, filled in with the first sensible targets. */
export function newStep(kind: string, doc: SceneDocument): Action | null {
  const m = doc.machine;
  const anim = m.animations[0]?.id, bool = m.inputs.find((i) => i.type === 'boolean'), num = m.inputs.find((i) => i.type === 'number'), other = m.inputs.find((i) => ['string', 'enum', 'vector2', 'color'].includes(i.type));
  const trig = m.inputs.find((i) => i.type === 'trigger'), layer = doc.layers.filter((l) => l.type !== 'group').at(-1), state = m.states?.[0];
  switch (kind) {
    case 'play': return anim ? { type: 'play', animationId: anim, direction: 'forward', from: 'start' } : null;
    case 'stop': return anim ? { type: 'stop', animationId: anim } : null;
    case 'pause': return anim ? { type: 'pause', animationId: anim } : null;
    case 'waitFor': return anim ? { type: 'waitFor', animationId: anim } : null;
    case 'wait': return { type: 'wait', seconds: 0.5 };
    case 'toggle': return bool ? { type: 'setBoolean', inputId: bool.id, value: 'toggle' } : null;
    case 'setBool': return bool ? { type: 'setBoolean', inputId: bool.id, value: 'on' } : null;
    case 'setNumber': return num ? { type: 'setNumber', inputId: num.id, mode: 'set', value: 0 } : null;
    case 'increase': return num ? { type: 'setNumber', inputId: num.id, mode: 'add', value: 1 } : null;
    case 'decrease': return num ? { type: 'setNumber', inputId: num.id, mode: 'add', value: -1 } : null;
    case 'setVar': return other ? { type: 'setVar', inputId: other.id, value: other.default } : null;
    case 'fire': return trig ? { type: 'fire', inputId: trig.id } : null;
    case 'setState': return state ? { type: 'setState', stateId: state.id } : null;
    case 'show': return layer ? { type: 'visibility', layerId: layer.id, visible: 'show' } : null;
    case 'hide': return layer ? { type: 'visibility', layerId: layer.id, visible: 'hide' } : null;
    case 'emit': return { type: 'emit', name: 'done' };
    case 'sound': return { type: 'sound', sound: 'pop', assetId: null, volume: 0.7 };
    case 'parallel': return { type: 'parallel', actions: [] };
    case 'branch': return { type: 'branch', if: { type: 'group', op: 'all', items: [newLeaf(doc)] }, then: [], else: [] };
  }
  return null;
}
export const STEP_KINDS: { group: string; items: { kind: string; label: string }[] }[] = [
  { group: 'Moves', items: [{ kind: 'play', label: 'Play a move' }, { kind: 'stop', label: 'Stop a move' }, { kind: 'pause', label: 'Pause a move' }, { kind: 'waitFor', label: 'Wait for a move to finish' }] },
  { group: 'Variables', items: [{ kind: 'setBool', label: 'Set a toggle' }, { kind: 'toggle', label: 'Flip a toggle' }, { kind: 'setNumber', label: 'Set a number' }, { kind: 'increase', label: 'Increase a number' }, { kind: 'decrease', label: 'Decrease a number' }, { kind: 'setVar', label: 'Set text / choice / vector / colour' }] },
  { group: 'States & layers', items: [{ kind: 'setState', label: 'Change state' }, { kind: 'show', label: 'Show a layer' }, { kind: 'hide', label: 'Hide a layer' }] },
  { group: 'Events & sound', items: [{ kind: 'emit', label: 'Send an event' }, { kind: 'fire', label: 'Press a button' }, { kind: 'sound', label: 'Play a sound' }] },
  { group: 'Timing & logic', items: [{ kind: 'wait', label: 'Wait' }, { kind: 'parallel', label: 'At the same time…' }, { kind: 'branch', label: 'If … otherwise …' }] },
];

/** Drag-and-drop payloads shared by the inspector and the Logic Canvas. */
export type DragItem = { kind: 'cond'; path: CondPath } | { kind: 'step'; path: StepPath } | { kind: 'newStep'; step: string } | { kind: 'newCond'; group: boolean };
export const DND_MIME = 'application/x-motion-logic';
export const readDrag = (e: React.DragEvent): DragItem | null => { try { return JSON.parse(e.dataTransfer.getData(DND_MIME)); } catch { return null; } };
export const startDrag = (e: React.DragEvent, item: DragItem) => { e.dataTransfer.setData(DND_MIME, JSON.stringify(item)); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); };
