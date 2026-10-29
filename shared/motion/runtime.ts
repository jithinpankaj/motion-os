import type { Action, Animation, Easing, Input, Layer, Rule, SceneDocument, Track, VarValue, When } from '../scene/schema';
import { evaluateTrack } from '../timeline';
import { getIn, setIn } from '../util/paths';
import { isHex, mixHex } from '../util/color';
import { ease } from '../util/easing';
import {
  PRIORITY_RANK, coerceValue, describeAction, describeWhen, evalCondition, explainTrace, resolveTransition, ruleGroup, ruleLabel, traceCondition,
  type CondTrace, type EvalCtx, type EventPayload,
} from './logic';

/**
 * Runs a scene's interactions — one engine for simple rules and advanced logic alike. It holds
 * variable values and the current state, plays moves (newest wins per property, with a cross-blend),
 * fires rules (priority, interruption, delays), runs their steps (in order, in parallel, with waits
 * and branches), applies slider links, and records a trace for the debugger. Pure and deterministic
 * given the same events and time steps — the editor, the community playground and exports all use it.
 */
export type InputValue = VarValue;
type Playing = {
  anim: Animation; time: number; dir: 1 | -1; seq: number; done: boolean; paused: boolean;
  loop: Animation['loop']; mixFrom: Map<string, number | string>; mixElapsed: number; mixDur: number; mixEase: Easing; additive: boolean;
};
export type RuntimeEvent = { kind: 'input' | 'play' | 'stop' | 'finish' | 'rule' | 'sound' | 'emit' | 'state' | 'trace'; id: string; detail?: string; volume?: number; value?: string | number };
export type StepRecord = { text: string; status: 'done' | 'running' | 'waiting'; animId?: string };
export type JobInfo = { id: number; ruleId: string | null; label: string; steps: StepRecord[]; pending: string[]; done: boolean };
export type RuleTrace = {
  ruleId: string; label: string;
  outcome: 'ran' | 'conditions' | 'wrongState' | 'disabled' | 'outranked' | 'blocked' | 'waiting' | 'queued' | 'ignored';
  conditions?: CondTrace; why?: string[];
};
export type TraceEntry = { id: number; t: number; event: EventPayload; rules: RuleTrace[] };

type Frame = { list: Action[]; i: number };
type Job = {
  id: number; ruleId: string | null; label: string; frames: Frame[]; event: EventPayload | null;
  rule: Rule | null; waitUntil?: number; waitAnim?: string; children?: Job[]; done: boolean; steps: StepRecord[];
};

const DEFAULT_MIX = 0.18; // seconds of cross-blend when a move takes over a property mid-flight
const keyOf = (layerId: string, path: string) => `${layerId}|${path}`;
const ENTER = '__enter'; // internal step: enter the rule's target state

export class MotionRuntime {
  private doc: SceneDocument;
  values: Record<string, InputValue> = {};
  /** The state machine's current state (null when the file has no states). */
  state: string | null = null;
  private playing = new Map<string, Playing>();
  private seq = 0;
  private last: Layer[] = [];
  private listeners = new Set<(e: RuntimeEvent) => void>();
  /** Ring of recent events for the "what just happened" panel. */
  log: { t: number; text: string }[] = [];
  /** Recent rule evaluations, for the debugger. */
  trace: TraceEntry[] = [];
  private traceSeq = 0;
  private clock = 0;
  private depth = 0;
  /** Where pointer-following sliders are heading; they ease toward it every step. */
  private targets = new Map<string, number>();
  private vel = new Map<string, number>();
  private dragging = new Set<string>();
  private lastPointer: { fx: number; fy: number } | null = null;
  private jobs: Job[] = [];
  private finishedJobs: Job[] = [];
  private jobSeq = 0;
  private visibility = new Map<string, boolean>();
  /** The state transition in progress (for interruption and priority), and transitions waiting their turn. */
  private active: { ruleId: string; priority: number; animId: string | null; jobId: number; startedAt: number; mixDur: number } | null = null;
  private waiting = new Map<string, { rule: Rule; event: EventPayload }>();
  private queue: { rule: Rule; event: EventPayload }[] = [];
  private lastEnter: { from: string | null; to: string; at: number; dur: number } | null = null;

  constructor(doc: SceneDocument) {
    this.doc = doc;
    this.last = doc.layers;
    this.reset();
  }

  on(fn: (e: RuntimeEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(e: RuntimeEvent, text?: string) {
    if (text) { this.log.push({ t: this.clock, text }); if (this.log.length > 40) this.log.shift(); }
    this.listeners.forEach((f) => f(e));
  }

  /** Swap in an edited document without losing variable values, the current state or what's playing. */
  setDoc(doc: SceneDocument) {
    this.doc = doc;
    const ids = new Set(doc.machine.inputs.map((i) => i.id));
    for (const k of Object.keys(this.values)) if (!ids.has(k)) delete this.values[k];
    for (const i of doc.machine.inputs) if (!(i.id in this.values) && i.type !== 'trigger') this.values[i.id] = coerceValue(i, i.default);
    for (const [id, p] of this.playing) {
      const a = doc.machine.animations.find((x) => x.id === id);
      if (!a) this.playing.delete(id); else p.anim = a;
    }
    if (this.state && !doc.machine.states?.some((s) => s.id === this.state)) this.state = doc.machine.initialState ?? null;
  }

  /** Back to the starting state: defaults, nothing playing, the initial state, then the "when it starts" rules. */
  reset() {
    this.values = {};
    for (const i of this.doc.machine.inputs) if (i.type !== 'trigger') this.values[i.id] = coerceValue(i, i.default);
    this.playing.clear();
    this.last = this.doc.layers;
    this.log = [];
    this.trace = [];
    this.clock = 0;
    this.targets.clear();
    this.vel.clear();
    this.dragging.clear();
    this.jobs = [];
    this.finishedJobs = [];
    this.visibility.clear();
    this.active = null;
    this.waiting.clear();
    this.queue = [];
    this.lastEnter = null;
    this.state = null;
    const initial = this.doc.machine.initialState ?? null;
    if (initial && this.doc.machine.states?.some((s) => s.id === initial)) this.enterState(initial, { settle: true });
    // Rules that describe a resting state (a toggle that starts on, a slider already past a value)
    // are settled instantly so the first frame already looks right.
    this.dispatch({ kind: 'start', label: 'Settling the starting state' }, (w) => (w.type === 'boolean' || w.type === 'number') && this.whenHolds(w), { settle: true, quiet: true });
    this.dispatch({ kind: 'start', label: 'Start' }, (w) => w.type === 'start');
  }

  private input(id: string): Input | undefined { return this.doc.machine.inputs.find((i) => i.id === id); }
  private whenHolds(w: When) {
    if (w.type === 'boolean') return this.values[w.inputId] === w.value;
    if (w.type === 'number') return evalCondition({ type: 'number', inputId: w.inputId, op: w.op, value: w.value }, this.ctx(null));
    return false;
  }
  private ctx(event: EventPayload | null): EvalCtx { return { values: this.values, state: this.state, playing: (id) => this.isPlaying(id), event }; }

  // ---------- events from outside (preview controls, pointer, keyboard, embeds) ----------

  setBoolean(id: string, value: boolean) {
    const inp = this.input(id);
    if (!inp || inp.type !== 'boolean' || this.values[id] === value) return;
    this.values[id] = value;
    const label = `${inp.name} → ${value ? 'on' : 'off'}`;
    this.emit({ kind: 'input', id }, label);
    this.dispatch({ kind: 'input', label, name: inp.name, value: value ? 1 : 0 }, (w) => (w.type === 'boolean' && w.inputId === id && w.value === value) || (w.type === 'changed' && w.inputId === id));
  }
  toggle(id: string) { this.setBoolean(id, !this.values[id]); }

  fire(id: string) {
    const inp = this.input(id);
    if (!inp || inp.type !== 'trigger') return;
    const label = `${inp.name} pressed`;
    this.emit({ kind: 'input', id }, label);
    this.dispatch({ kind: 'input', label, name: inp.name }, (w) => w.type === 'trigger' && w.inputId === id);
  }

  setNumber(id: string, value: number, quiet = false) {
    const inp = this.input(id);
    if (!inp || inp.type !== 'number') return;
    const v = coerceValue(inp, value) as number;
    const before = Number(this.values[id] ?? 0);
    if (before === v) return;
    this.values[id] = v;
    // Pointer-following updates happen every frame; they change values silently (no log, no UI churn).
    if (!quiet) this.emit({ kind: 'input', id }, `${inp.name} = ${+v.toFixed(2)}`);
    // Number rules fire when their condition becomes true (crossing the threshold), not on every change.
    const crossed = (w: When) => {
      if (w.type !== 'number' || w.inputId !== id) return false;
      const was = evalCondition({ type: 'number', inputId: id, op: w.op, value: w.value }, { ...this.ctx(null), values: { ...this.values, [id]: before } });
      return !was && evalCondition({ type: 'number', inputId: id, op: w.op, value: w.value }, this.ctx(null));
    };
    this.dispatch({ kind: 'input', label: `${inp.name} = ${+v.toFixed(2)}`, name: inp.name, value: v }, (w) => crossed(w) || (!quiet && w.type === 'changed' && w.inputId === id), { quiet });
  }

  /** Set any variable (text, choice, vector, colour — or a toggle/number) within its limits. */
  setVar(id: string, value: VarValue) {
    const inp = this.input(id);
    if (!inp) return;
    if (inp.type === 'boolean') return this.setBoolean(id, !!value);
    if (inp.type === 'number') return this.setNumber(id, Number(value));
    if (inp.type === 'trigger') { if (value) this.fire(id); return; }
    const v = coerceValue(inp, value);
    if (JSON.stringify(this.values[id]) === JSON.stringify(v)) return;
    this.values[id] = v;
    const shown = typeof v === 'object' ? `(${v.x}, ${v.y})` : String(v);
    this.emit({ kind: 'input', id }, `${inp.name} = ${shown}`);
    this.dispatch({ kind: 'input', label: `${inp.name} = ${shown}`, name: inp.name, value: shown }, (w) => w.type === 'changed' && w.inputId === id);
  }

  /** A pointer event on a layer, or on the canvas itself when layerId is null. */
  pointer(event: 'click' | 'enter' | 'leave' | 'down' | 'up', layerId: string | null, at?: { x: number; y: number }) {
    if (layerId) {
      // Dragging: sliders tied to this layer start following on press and spring home on release.
      const drags = this.doc.machine.inputs.filter((i) => i.type === 'number' && i.follow && i.dragLayer === layerId);
      if (drags.length && event === 'down') { this.dragging.add(layerId); if (this.lastPointer) this.pointerMove(this.lastPointer.fx, this.lastPointer.fy); }
      if (drags.length && event === 'up' && this.dragging.delete(layerId)) for (const i of drags) this.targets.set(i.id, Number(i.default));
    }
    const where = layerId ? this.doc.layers.find((l) => l.id === layerId)?.name ?? 'a layer' : 'the canvas';
    const verb = { click: 'Click on', enter: 'Pointer entered', leave: 'Pointer left', down: 'Pressed on', up: 'Let go of' }[event];
    this.dispatch({ kind: 'pointer', label: `${verb} ${where}`, name: event, layerId, x: at?.x, y: at?.y }, (w) => w.type === 'pointer' && w.event === event && (w.layerId ?? null) === layerId);
  }

  /** A key pressed while the motion is focused or under the pointer. */
  key(key: string) {
    this.dispatch({ kind: 'key', label: `Key ${key === ' ' ? 'Space' : key}`, key }, (w) => w.type === 'key' && (w.key === 'any' || w.key.toLowerCase() === key.toLowerCase()));
  }

  /** A named event, from an "emit" step or from the page hosting the motion. */
  sendEvent(name: string, value?: string | number) {
    this.dispatch({ kind: 'event', label: `Event “${name}”`, name, value }, (w) => w.type === 'event' && w.name === name);
  }

  /** Does anything follow the pointer? (Players then track it across the whole page.) */
  get follows() { return this.doc.machine.inputs.some((i) => i.type === 'number' && i.follow); }
  /** Does anything listen for keys? */
  get listensForKeys() { return this.doc.machine.rules.some((r) => r.when.type === 'key'); }

  /** Pointer position as fractions of the canvas (may be outside 0–1 when off the canvas). */
  pointerMove(fx: number, fy: number) {
    this.lastPointer = { fx, fy };
    for (const i of this.doc.machine.inputs) {
      if (i.type !== 'number' || !i.follow) continue;
      if (i.dragLayer && !this.dragging.has(i.dragLayer)) continue;
      const f = Math.min(1, Math.max(0, i.follow === 'pointerX' ? fx : fy));
      const lo = i.min ?? 0, hi = i.max ?? 100;
      this.targets.set(i.id, lo + (hi - lo) * f);
    }
  }
  /** The pointer went away: following sliders drift back to where they started. */
  pointerAway() {
    this.dragging.clear();
    for (const i of this.doc.machine.inputs) if (i.type === 'number' && i.follow) this.targets.set(i.id, Number(i.default));
  }
  /** Is someone dragging this layer right now? */
  isDragging(layerId: string) { return this.dragging.has(layerId); }

  /** Layers that react to the pointer (for hit-testing order and the cursor). */
  get pointerLayers() {
    return new Set([
      ...this.doc.machine.rules.flatMap((r) => (r.when.type === 'pointer' && r.when.layerId ? [r.when.layerId] : [])),
      ...this.dragLayers,
    ]);
  }
  /** Does anything react to pointer events on the canvas as a whole? */
  get canvasListens() { return this.doc.machine.rules.some((r) => r.when.type === 'pointer' && !r.when.layerId); }
  /** Layers someone can grab and drag. */
  get dragLayers() { return new Set(this.doc.machine.inputs.flatMap((i) => (i.type === 'number' && i.follow && i.dragLayer ? [i.dragLayer] : []))); }
  isPlaying(animId: string) { const p = this.playing.get(animId); return !!p && !p.done && !p.paused; }

  // ---------- rules: matching, priority, interruption ----------

  private dispatch(event: EventPayload, matches: (w: When) => boolean, opts: { settle?: boolean; quiet?: boolean } = {}) {
    const candidates = this.doc.machine.rules
      .map((r, i) => ({ r, i, p: PRIORITY_RANK[resolveTransition(r).priority] }))
      .filter((x) => matches(x.r.when))
      .sort((a, b) => b.p - a.p || a.i - b.i)
      .map((x) => x.r);
    if (!candidates.length) return;
    if (this.depth > 24) { this.emit({ kind: 'rule', id: 'loop' }, '⚠ Stopped: rules kept triggering each other'); return; }
    this.depth++;
    const entry: TraceEntry = { id: ++this.traceSeq, t: this.clock, event, rules: [] };
    let changedState = false;
    for (const r of candidates) {
      const label = ruleLabel(r, this.doc);
      if (r.enabled === false) { entry.rules.push({ ruleId: r.id, label, outcome: 'disabled' }); continue; }
      if (r.to && changedState) { entry.rules.push({ ruleId: r.id, label, outcome: 'outranked', why: ['Another connection with a higher priority (or earlier in the list) already changed the state for this event.'] }); continue; }
      // Evaluated right before running (earlier rules in this event may have changed things).
      if (r.from && r.from !== this.state) {
        const st = (id: string | null) => (id ? this.doc.machine.states?.find((s) => s.id === id)?.name : null) ?? 'no state';
        entry.rules.push({ ruleId: r.id, label, outcome: 'wrongState', why: [`It only works from ${st(r.from)}, but the current state is ${st(this.state)}.`] });
        continue;
      }
      const trace = traceCondition(ruleGroup(r), this.ctx(event));
      if (!trace.pass) { entry.rules.push({ ruleId: r.id, label, outcome: 'conditions', conditions: trace, why: explainTrace(trace, this.doc, this.ctx(event)) }); continue; }
      const verdict = opts.settle ? 'run' : this.admit(r, event);
      entry.rules.push({ ruleId: r.id, label, outcome: verdict === 'run' ? 'ran' : verdict, conditions: trace, why: verdict === 'blocked' ? ['A higher-priority transition is still running.'] : verdict === 'ignored' ? ['Its interruption setting is “Ignore new events” and it was still running.'] : undefined });
      if (verdict === 'run') this.run(r, event, opts);
      if (r.to && verdict !== 'blocked' && verdict !== 'ignored') changedState = true;
    }
    this.depth--;
    if (!opts.quiet || entry.rules.some((x) => x.outcome === 'ran')) {
      this.trace.push(entry);
      if (this.trace.length > 40) this.trace.shift();
      this.emit({ kind: 'trace', id: String(entry.id) });
    }
  }

  /** Is this rule's transition (or, for a rule without a state change, its own steps) still running? */
  private busy(r: Rule) {
    if (r.to) {
      const a = this.active;
      if (!a) return false;
      const job = this.jobs.find((j) => j.id === a.jobId);
      if (job && !job.done) return true;
      if (!a.animId) return false;
      const p = this.playing.get(a.animId);
      if (!p || p.paused) return false;
      return p.loop === 'once' ? !p.done : p.mixElapsed < p.mixDur;
    }
    return this.jobs.some((j) => j.ruleId === r.id && !j.done);
  }

  private admit(r: Rule, event: EventPayload): 'run' | 'blocked' | 'waiting' | 'queued' | 'ignored' {
    if (!this.busy(r)) return 'run';
    const t = resolveTransition(r);
    if (r.to && this.active && t.priority !== 'critical' && PRIORITY_RANK[t.priority] < this.active.priority) return 'blocked';
    if (t.interruption === 'allow') return 'run';
    if (t.interruption === 'ignore') return 'ignored';
    if (t.interruption === 'wait') { this.waiting.set(r.to ? '__state' : r.id, { rule: r, event }); return 'waiting'; }
    this.queue.push({ rule: r, event });
    return 'queued';
  }

  /** Waiting and queued transitions run once whatever they were waiting for has finished. */
  private releaseWaiting() {
    for (const [key, w] of [...this.waiting]) {
      if (this.busy(w.rule)) continue;
      this.waiting.delete(key);
      this.retry(w.rule, w.event);
    }
    for (let guard = 0; guard < 8 && this.queue.length && !this.busy(this.queue[0].rule); guard++) {
      const q = this.queue.shift()!;
      this.retry(q.rule, q.event);
    }
  }
  private retry(r: Rule, event: EventPayload) {
    const entry: TraceEntry = { id: ++this.traceSeq, t: this.clock, event: { ...event, label: `${event.label} (its turn now)` }, rules: [] };
    const label = ruleLabel(r, this.doc);
    if (r.from && r.from !== this.state) entry.rules.push({ ruleId: r.id, label, outcome: 'wrongState', why: ['By the time it was its turn, the state had changed.'] });
    else {
      const trace = traceCondition(ruleGroup(r), this.ctx(event));
      if (!trace.pass) entry.rules.push({ ruleId: r.id, label, outcome: 'conditions', conditions: trace, why: explainTrace(trace, this.doc, this.ctx(event)) });
      else { entry.rules.push({ ruleId: r.id, label, outcome: 'ran', conditions: trace }); this.run(r, event, {}); }
    }
    this.trace.push(entry);
    if (this.trace.length > 40) this.trace.shift();
    this.emit({ kind: 'trace', id: String(entry.id) });
  }

  // ---------- running a rule: its steps as a job ----------

  private run(rule: Rule, event: EventPayload, opts: { settle?: boolean }) {
    this.emit({ kind: 'rule', id: rule.id });
    const t = resolveTransition(rule);
    const list: Action[] = [];
    if (t.delay > 0 && !opts.settle) list.push({ type: 'wait', seconds: t.delay });
    if (rule.exit?.length) list.push(...rule.exit);
    if (rule.to) list.push({ type: 'setState', stateId: ENTER });
    list.push(...rule.do);
    const job: Job = { id: ++this.jobSeq, ruleId: rule.id, label: ruleLabel(rule, this.doc), frames: [{ list, i: 0 }], event, rule, done: false, steps: [] };
    if (rule.to) this.active = { ruleId: rule.id, priority: PRIORITY_RANK[t.priority], animId: null, jobId: job.id, startedAt: this.clock, mixDur: t.duration };
    this.jobs.push(job);
    this.advance(job, opts.settle);
    this.sweepJobs();
  }

  /** Execute a job's steps until it has to wait (or finishes). Settling runs everything instantly. */
  private advance(job: Job, settle = false) {
    let guard = 0;
    while (!job.done && guard++ < 500) {
      if (job.children) {
        for (const c of job.children) if (!c.done) this.advance(c, settle);
        if (job.children.some((c) => !c.done)) return;
        job.children = undefined;
      }
      if (job.waitUntil !== undefined) { if (!settle && this.clock < job.waitUntil - 1e-9) return; job.waitUntil = undefined; this.markWaitDone(job); }
      if (job.waitAnim) { if (!settle && this.isPlaying(job.waitAnim)) return; job.waitAnim = undefined; this.markWaitDone(job); }
      const f = job.frames[job.frames.length - 1];
      if (!f) { job.done = true; break; }
      if (f.i >= f.list.length) { job.frames.pop(); continue; }
      const a = f.list[f.i++];
      this.step1(job, a, settle);
    }
  }
  private markWaitDone(job: Job) { const s = [...job.steps].reverse().find((x) => x.status === 'waiting'); if (s) s.status = 'done'; }

  private step1(job: Job, a: Action, settle: boolean) {
    const rec = (text: string, status: StepRecord['status'] = 'done', animId?: string) => { job.steps.push({ text, status, animId }); };
    const t = job.rule ? resolveTransition(job.rule) : null;
    switch (a.type) {
      case 'wait':
        if (settle) return;
        job.waitUntil = this.clock + a.seconds; rec(`Wait ${a.seconds} s`, 'waiting'); return;
      case 'waitFor':
        if (settle) return;
        job.waitAnim = a.animationId; rec(describeAction(a, this.doc), 'waiting'); return;
      case 'parallel':
        rec(describeAction(a, this.doc));
        job.children = a.actions.map((x) => ({ id: ++this.jobSeq, ruleId: job.ruleId, label: job.label, frames: [{ list: [x], i: 0 }], event: job.event, rule: job.rule, done: false, steps: job.steps }));
        return;
      case 'branch': {
        const pass = evalCondition(a.if, this.ctx(job.event));
        rec(`${describeAction(a, this.doc)} → ${pass ? 'yes' : 'no'}`);
        job.frames.push({ list: pass ? a.then : a.else, i: 0 });
        return;
      }
      case 'setState':
        if (a.stateId === ENTER) {
          if (!job.rule?.to) return;
          const animId = this.enterState(job.rule.to, { settle, transition: t ?? undefined });
          if (this.active && this.active.jobId === job.id) this.active.animId = animId;
          rec(`Go to ${this.doc.machine.states?.find((s) => s.id === job.rule!.to)?.name ?? 'state'}`, animId ? 'running' : 'done', animId ?? undefined);
        } else { const animId = this.enterState(a.stateId, { settle }); rec(describeAction(a, this.doc), animId ? 'running' : 'done', animId ?? undefined); }
        return;
      case 'play':
        this.play(a.animationId, { direction: a.direction, from: a.from, loop: a.loop, settle, mixDur: t?.duration, mixEase: t?.easing, blend: t?.blend });
        rec(describeAction(a, this.doc), 'running', a.animationId); return;
      default:
        this.act(a, settle);
        rec(describeAction(a, this.doc));
    }
  }

  /** Simple, instant actions. */
  private act(a: Action, settle: boolean) {
    if (a.type === 'stop') {
      if (this.playing.delete(a.animationId)) this.emit({ kind: 'stop', id: a.animationId }, `■ ${this.doc.machine.animations.find((x) => x.id === a.animationId)?.name ?? ''}`);
    } else if (a.type === 'pause') {
      const p = this.playing.get(a.animationId);
      if (p && !p.paused) { p.paused = true; this.emit({ kind: 'stop', id: a.animationId }, `⏸ ${p.anim.name}`); }
    } else if (a.type === 'setBoolean') {
      const cur = !!this.values[a.inputId];
      this.setBoolean(a.inputId, a.value === 'toggle' ? !cur : a.value === 'on');
    } else if (a.type === 'fire') {
      this.fire(a.inputId);
    } else if (a.type === 'setNumber') {
      this.setNumber(a.inputId, a.mode === 'add' ? Number(this.values[a.inputId] ?? 0) + a.value : a.value);
    } else if (a.type === 'setVar') {
      this.setVar(a.inputId, a.value);
    } else if (a.type === 'visibility') {
      const l = this.doc.layers.find((x) => x.id === a.layerId);
      if (!l) return;
      const cur = this.visibility.get(a.layerId) ?? l.visible;
      this.visibility.set(a.layerId, a.visible === 'toggle' ? !cur : a.visible === 'show');
    } else if (a.type === 'emit') {
      this.emit({ kind: 'emit', id: a.name, value: a.value }, `✉ ${a.name}${a.value !== undefined ? ` (${a.value})` : ''}`);
      this.sendEvent(a.name, a.value);
    } else if (a.type === 'sound') {
      // Settling the starting state is silent; players turn this event into audio.
      if (settle) return;
      const id = a.assetId ?? a.sound!;
      this.emit({ kind: 'sound', id, detail: a.assetId ? 'asset' : 'builtin', volume: a.volume }, `♪ ${a.assetId ? 'Your sound' : a.sound}`);
    }
  }

  /** Enter a state and (unless told not to) play its move with the transition's settings. Returns the move played. */
  private enterState(stateId: string, o: { settle?: boolean; transition?: ReturnType<typeof resolveTransition> }): string | null {
    const st = this.doc.machine.states?.find((s) => s.id === stateId);
    if (!st) return null;
    const from = this.state;
    this.state = stateId;
    const t = o.transition;
    let played: string | null = null;
    if (st.animationId && (t?.playStateMove ?? true)) {
      this.play(st.animationId, {
        direction: t?.playback === 'reverse' ? 'reverse' : 'forward', from: t?.playback === 'continue' ? 'current' : 'start',
        loop: t?.loop && t.loop !== 'default' ? t.loop : undefined, settle: o.settle, mixDur: t?.duration, mixEase: t?.easing, blend: t?.blend,
      });
      played = st.animationId;
    }
    this.lastEnter = { from, to: stateId, at: this.clock, dur: t?.duration ?? DEFAULT_MIX };
    if (!o.settle) this.emit({ kind: 'state', id: stateId }, `◆ ${st.name}`);
    this.dispatch({ kind: 'state', label: `Entered ${st.name}`, name: st.name }, (w) => w.type === 'stateEnter' && w.stateId === stateId, { settle: o.settle });
    return played;
  }

  private play(animId: string, o: { direction: 'forward' | 'reverse'; from: 'start' | 'current'; loop?: Animation['loop']; settle?: boolean; mixDur?: number; mixEase?: Easing; blend?: 'crossfade' | 'replace' | 'additive' }) {
    const anim = this.doc.machine.animations.find((x) => x.id === animId);
    if (!anim) return;
    const dir = o.direction === 'reverse' ? -1 : 1;
    const prev = this.playing.get(anim.id);
    // Playing backwards "from where it is" when it has never played: it is already at its start.
    if (dir < 0 && o.from === 'current' && !prev) return;
    const loop = o.loop ?? anim.loop;
    let time = dir > 0 ? 0 : anim.duration;
    if (o.from === 'current' && prev) time = prev.time;
    if (o.settle && loop === 'once') time = dir > 0 ? anim.duration : 0;
    const continuing = o.from === 'current' && !!prev;
    if (o.blend === 'replace' && !o.settle) {
      // Replace: anything else animating the same properties stops, with no blend.
      const keys = new Set(anim.tracks.map((t) => keyOf(t.layerId, t.path)));
      for (const [id, p] of this.playing) if (id !== anim.id && p.anim.tracks.some((t) => keys.has(keyOf(t.layerId, t.path)))) this.playing.delete(id);
    }
    const mixDur = o.blend === 'replace' ? 0 : o.mixDur ?? DEFAULT_MIX;
    this.playing.set(anim.id, {
      anim, time, dir: dir as 1 | -1, seq: ++this.seq, done: !!o.settle && loop === 'once', paused: false, loop,
      mixFrom: continuing || o.settle || mixDur === 0 ? new Map() : this.snapshot(anim.tracks), mixElapsed: 0, mixDur, mixEase: o.mixEase ?? 'easeOut',
      additive: o.blend === 'additive',
    });
    if (!o.settle) this.emit({ kind: 'play', id: anim.id }, `▶ ${anim.name}${dir < 0 ? ' (backwards)' : ''}`);
  }

  private snapshot(tracks: Track[]) {
    const m = new Map<string, number | string>();
    for (const t of tracks) {
      const l = this.last.find((x) => x.id === t.layerId);
      const v = l ? getIn(l, t.path) : undefined;
      if (typeof v === 'number' || typeof v === 'string') m.set(keyOf(t.layerId, t.path), v);
    }
    return m;
  }

  private sweepJobs() {
    const done = this.jobs.filter((j) => j.done);
    if (!done.length) return;
    this.jobs = this.jobs.filter((j) => !j.done);
    this.finishedJobs.push(...done);
    if (this.finishedJobs.length > 6) this.finishedJobs.splice(0, this.finishedJobs.length - 6);
  }

  // ---------- time ----------

  /** Advance every playing move and every running job by dt seconds; fires "when … finishes" rules. */
  step(dt: number) {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.clock += dt;
    for (const [id, target] of this.targets) {
      const inp = this.input(id);
      if (!inp) { this.targets.delete(id); continue; }
      const cur = Number(this.values[id] ?? 0);
      const rate = 2 + (1 - (inp.smoothing ?? 0.6)) * 28; // per second; higher = snappier
      if (inp.bounce) {
        // A damped spring: it overshoots and wobbles before settling (in small sub-steps for stability).
        let x = cur, v = this.vel.get(id) ?? 0;
        const k = rate * rate, c = 2 * rate * (1 - inp.bounce);
        for (let left = dt; left > 1e-9; left -= 1 / 240) { const h = Math.min(1 / 240, left); v += (k * (target - x) - c * v) * h; x += v * h; }
        if (Math.abs(target - x) < 1e-4 && Math.abs(v) < 1e-3) { x = target; v = 0; }
        this.vel.set(id, v);
        this.setNumber(id, x, true);
        continue;
      }
      const next = Math.abs(target - cur) < 1e-3 ? target : cur + (target - cur) * (1 - Math.exp(-rate * dt));
      this.setNumber(id, next, true);
    }
    const finished: string[] = [];
    for (const p of [...this.playing.values()]) {
      p.mixElapsed += dt;
      if (p.done || p.paused) continue;
      const d = p.anim.duration;
      p.time += dt * p.dir;
      if (p.loop === 'loop') { p.time = ((p.time % d) + d) % d; }
      else if (p.loop === 'pingpong') {
        if (p.time > d) { p.time = 2 * d - p.time; p.dir = -1; }
        else if (p.time < 0) { p.time = -p.time; p.dir = 1; }
      } else if (p.time >= d || p.time <= 0) {
        p.time = Math.min(d, Math.max(0, p.time));
        p.done = true;
        finished.push(p.anim.id);
      }
    }
    for (const id of finished) {
      const a = this.doc.machine.animations.find((x) => x.id === id);
      this.emit({ kind: 'finish', id });
      this.dispatch({ kind: 'finished', label: `${a?.name ?? 'A move'} finished`, name: a?.name }, (w) => w.type === 'finished' && w.animationId === id, { quiet: true });
    }
    for (const j of [...this.jobs]) if (!j.done) this.advance(j);
    this.sweepJobs();
    this.releaseWaiting();
    if (this.active && !this.busy({ id: this.active.ruleId, to: 'x' } as Rule)) this.active = null;
  }

  /** The layers to draw now: base design → playing moves (newest wins; additive ones add) → slider links → shown/hidden. */
  layers(): Layer[] {
    let out = this.doc.layers;
    const byId = new Map(out.map((l, i) => [l.id, i]));
    const write = (layerId: string, path: string, v: number | string | boolean) => {
      const i = byId.get(layerId);
      if (i === undefined) return;
      const cur = getIn(out[i], path);
      if (cur === undefined || typeof cur !== typeof v) return;
      if (out === this.doc.layers) out = out.slice();
      out[i] = setIn(out[i], path, v);
    };
    for (const p of [...this.playing.values()].sort((a, b) => a.seq - b.seq)) {
      const k = p.mixElapsed < p.mixDur ? ease(p.mixEase, p.mixElapsed / p.mixDur) : 1;
      for (const t of p.anim.tracks) {
        let v = evaluateTrack(t, p.time);
        if (v === undefined) continue;
        if (p.additive && typeof v === 'number') {
          // Additive: add how far the move has travelled from its first keyframe to whatever is there.
          const first = t.keyframes[0]?.value, i = byId.get(t.layerId);
          const cur = i === undefined ? undefined : getIn(out[i], t.path);
          if (typeof first === 'number' && typeof cur === 'number') write(t.layerId, t.path, cur + (v - first) * k);
          continue;
        }
        const from = k < 1 ? p.mixFrom.get(keyOf(t.layerId, t.path)) : undefined;
        if (from !== undefined) v = blend(from, v, k);
        write(t.layerId, t.path, v);
      }
    }
    for (const b of this.doc.machine.bindings) {
      const x = Number(this.values[b.inputId] ?? 0);
      const span = b.from[1] - b.from[0];
      const u = span === 0 ? 0 : Math.min(1, Math.max(0, (x - b.from[0]) / span));
      const mapped = b.to[0] + (b.to[1] - b.to[0]) * u;
      if (!b.relative) { write(b.layerId, b.path, mapped); continue; }
      // Relative links add to whatever the layer shows now (design + playing moves), so they combine.
      const i = byId.get(b.layerId);
      const cur = i === undefined ? undefined : getIn(out[i], b.path);
      if (typeof cur === 'number') write(b.layerId, b.path, cur + mapped);
    }
    for (const [id, vis] of this.visibility) write(id, 'visible', vis);
    this.last = out;
    return out;
  }

  // ---------- for the debugger ----------

  /** Running jobs (and the last few finished ones) with each step's status and what's still to come. */
  debugJobs(): JobInfo[] {
    const info = (j: Job): JobInfo => ({
      id: j.id, ruleId: j.ruleId, label: j.label, done: j.done,
      steps: j.steps.map((s) => ({ ...s, status: s.status === 'running' && s.animId && !this.isPlaying(s.animId) ? 'done' : s.status })),
      pending: j.frames.flatMap((f) => f.list.slice(f.i)).filter((a) => !(a.type === 'setState' && a.stateId === ENTER)).map((a) => describeAction(a, this.doc)),
    });
    return [...this.finishedJobs.slice(-3), ...this.jobs].map(info);
  }
  /** The latest state change and how far its blend has got (0–1). */
  transitionInfo() {
    if (!this.lastEnter) return null;
    const st = (id: string | null) => (id ? this.doc.machine.states?.find((s) => s.id === id)?.name ?? '?' : 'start');
    const progress = this.lastEnter.dur <= 0 ? 1 : Math.min(1, (this.clock - this.lastEnter.at) / this.lastEnter.dur);
    return { from: st(this.lastEnter.from), to: st(this.lastEnter.to), progress };
  }
  get now() { return this.clock; }
  /** Describe what a rule's trigger is, for labels. */
  describeTrigger(r: Rule) { return describeWhen(r.when, this.doc); }
}

function blend(a: number | string, b: number | string, k: number): number | string {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * k;
  if (typeof a === 'string' && typeof b === 'string' && isHex(a) && isHex(b)) return mixHex(a, b, k);
  return k < 0.5 ? a : b;
}

/** A plain timeline document for one move — used to export it as video or a still. */
export function docForAnimation(doc: SceneDocument, animationId: string): SceneDocument {
  const a = doc.machine.animations.find((x) => x.id === animationId);
  if (!a) return doc;
  return { ...doc, tracks: a.tracks, canvas: { ...doc.canvas, duration: a.duration, loop: a.loop !== 'once' } };
}

/**
 * A looping approximation of how a file looks when it starts (its "when it starts" moves and its
 * initial state's move), for thumbnails and cards that render without the interactive runtime.
 */
export function previewDoc(doc: SceneDocument): SceneDocument {
  const ids = new Set(doc.machine.rules.filter((r) => r.when.type === 'start').flatMap((r) => r.do.flatMap((a) => (a.type === 'play' && a.direction === 'forward' ? [a.animationId] : []))));
  const initial = doc.machine.states?.find((s) => s.id === doc.machine.initialState);
  if (initial?.animationId && doc.machine.animations.find((a) => a.id === initial.animationId)?.loop !== 'once') ids.add(initial.animationId);
  if (!doc.machine.rules.length && !ids.size) return doc;
  const anims = doc.machine.animations.filter((a) => ids.has(a.id));
  if (!anims.length) return { ...doc, tracks: [] };
  const duration = Math.max(...anims.map((a) => a.duration));
  return { ...doc, tracks: anims.flatMap((a) => a.tracks), canvas: { ...doc.canvas, duration, loop: true } };
}
