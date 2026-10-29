import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Action, Rule, SceneDocument, When } from '../../../../shared/scene/schema';
import { BUILTIN_SOUNDS } from '../../../../shared/scene/schema';
import { describeAction, logicSummary, resolveTransition, smartTransition, summaryText } from '../../../../shared/motion/logic';
import { SOUND_LABELS } from '../../../lib/sound';
import { Modal, Popover, Switch } from '../../../ui/controls';
import { Icon } from '../../../ui/Icon';
import { addRule, commit, deleteRule, updateRule } from '../store';
import { uid } from '../../../../shared/util/random';
import { StepList } from './Actions';
import { ConditionTree } from './Conditions';
import { EasingField } from './Easing';
import { fromRootGroup, newLeaf, rootGroup } from './tree';

/**
 * Interactions as plain sentences: "When someone hovers over Button → play Hover". Every bold word
 * can be clicked to change it. Extra conditions, timing and expert settings stay folded away, and
 * nothing a file already does is lost — richer logic is summarised and still fully editable.
 */

// ---------- the "when" part, in everyday words ----------

type WhenOption = { key: string; icon: string; label: string; hint: string; group: 'People' | 'Automatic'; make: (doc: SceneDocument, prev?: When) => When | null };
const pointerLayer = (doc: SceneDocument, prev?: When) => (prev?.type === 'pointer' ? prev.layerId : defaultTarget(doc));
export const WHEN_OPTIONS: WhenOption[] = [
  { key: 'enter', icon: 'crosshair', label: 'hovers over', hint: 'The pointer moves onto something', group: 'People', make: (d, p) => ({ type: 'pointer', event: 'enter', layerId: pointerLayer(d, p) }) },
  { key: 'leave', icon: 'crosshair', label: 'moves off', hint: 'The pointer moves away from something', group: 'People', make: (d, p) => ({ type: 'pointer', event: 'leave', layerId: pointerLayer(d, p) }) },
  { key: 'click', icon: 'check', label: 'clicks', hint: 'A click or a tap', group: 'People', make: (d, p) => ({ type: 'pointer', event: 'click', layerId: pointerLayer(d, p) }) },
  { key: 'down', icon: 'drag', label: 'presses and holds', hint: 'The moment the button goes down', group: 'People', make: (d, p) => ({ type: 'pointer', event: 'down', layerId: pointerLayer(d, p) }) },
  { key: 'up', icon: 'drag', label: 'lets go of', hint: 'The moment they let go', group: 'People', make: (d, p) => ({ type: 'pointer', event: 'up', layerId: pointerLayer(d, p) }) },
  { key: 'key', icon: 'command', label: 'presses a key', hint: 'Like Enter or Space', group: 'People', make: () => ({ type: 'key', key: 'Enter' }) },
  { key: 'start', icon: 'play', label: 'it first appears', hint: 'As soon as it’s shown', group: 'Automatic', make: () => ({ type: 'start' }) },
  { key: 'finished', icon: 'film', label: 'a move finishes', hint: 'Right after an animation ends', group: 'Automatic', make: (d) => (d.machine.animations[0] ? { type: 'finished', animationId: d.machine.animations[0].id } : null) },
  { key: 'boolean', icon: 'check', label: 'a switch turns on or off', hint: 'One of your on/off switches', group: 'Automatic', make: (d) => { const v = d.machine.inputs.find((i) => i.type === 'boolean'); return v ? { type: 'boolean', inputId: v.id, value: true } : null; } },
  { key: 'trigger', icon: 'play', label: 'a button is pressed', hint: 'One of your buttons (or the page) presses it', group: 'Automatic', make: (d) => { const v = d.machine.inputs.find((i) => i.type === 'trigger'); return v ? { type: 'trigger', inputId: v.id } : null; } },
  { key: 'number', icon: 'gauge', label: 'a number reaches a value', hint: 'Like progress reaching 100', group: 'Automatic', make: (d) => { const v = d.machine.inputs.find((i) => i.type === 'number'); return v ? { type: 'number', inputId: v.id, op: '>=', value: v.max ?? 100 } : null; } },
  { key: 'stateEnter', icon: 'layers', label: 'it switches state', hint: 'When it becomes Hover, Pressed…', group: 'Automatic', make: (d) => (d.machine.states?.[0] ? { type: 'stateEnter', stateId: d.machine.states[0].id } : null) },
  { key: 'event', icon: 'send', label: 'a message arrives', hint: 'Sent by another interaction or the web page', group: 'Automatic', make: () => ({ type: 'event', name: 'done' }) },
];
const whenKey = (w: When) => (w.type === 'pointer' ? w.event : w.type === 'changed' ? 'boolean' : w.type);
function defaultTarget(doc: SceneDocument) {
  return doc.layers.find((l) => l.name === 'Touch area')?.id ?? [...doc.layers].reverse().find((l) => l.type !== 'group' && !l.locked)?.id;
}
const layerName = (doc: SceneDocument, id?: string) => (id ? doc.layers.find((l) => l.id === id)?.name ?? 'a missing layer' : 'anywhere');
const varName = (doc: SceneDocument, id: string) => doc.machine.inputs.find((i) => i.id === id)?.name ?? '?';
const stateName = (doc: SceneDocument, id?: string) => doc.machine.states?.find((s) => s.id === id)?.name ?? '—';

/** A clickable word in a sentence that opens a small chooser. */
function Token({ children, label, pop }: { children: ReactNode; label: string; pop: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} className="tok" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{children}</button>
      {/* Clicks inside the chooser must not reach the sentence (which opens and closes the card). */}
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} className="pick-pop"><div onClick={(e) => e.stopPropagation()}>{pop(() => setOpen(false))}</div></Popover>
    </>
  );
}
function Pick({ items, onPick }: { items: { key: string; label: ReactNode; hint?: string; icon?: string; on?: boolean }[]; onPick: (key: string) => void }) {
  return <div className="pick" role="listbox">{items.map((it) => <button key={it.key} role="option" aria-selected={!!it.on} className={`pick-item ${it.on ? 'on' : ''}`} onClick={() => onPick(it.key)}>{it.icon && <Icon name={it.icon as any} size={13} />}<span>{it.label}{it.hint && <small>{it.hint}</small>}</span></button>)}</div>;
}

/** The "When …" half of the sentence, with every part clickable. */
function WhenSentence({ doc, w, onChange }: { doc: SceneDocument; w: When; onChange: (w: When) => void }) {
  const m = doc.machine;
  const verb = WHEN_OPTIONS.find((o) => o.key === whenKey(w));
  const verbTok = (text: string) => (
    <Token label="Change what starts it" pop={(close) => (
      <Pick items={WHEN_OPTIONS.filter((o) => o.make(doc, w)).map((o) => ({ key: o.key, label: o.label, hint: o.hint, icon: o.icon, on: o.key === verb?.key }))} onPick={(k) => { const n = WHEN_OPTIONS.find((o) => o.key === k)!.make(doc, w); if (n) onChange(n); close(); }} />
    )}>{text}</Token>
  );
  const layers = [...doc.layers].reverse().filter((l) => l.type !== 'group');
  const layerTok = (id?: string) => w.type === 'pointer' && (
    <Token label="Change what they interact with" pop={(close) => (
      <Pick items={[{ key: '', label: 'anywhere on the canvas', icon: 'maximize', on: !id }, ...layers.map((l) => ({ key: l.id, label: l.name, icon: l.type === 'text' ? 'type' : l.type === 'image' ? 'image' : 'shapes', on: l.id === id }))]} onPick={(k) => { onChange({ ...w, layerId: k || undefined }); close(); }} />
    )}>{layerName(doc, id)}</Token>
  );
  const pickVar = (types: string[], id: string, set: (id: string) => void) => (
    <Token label="Change which one" pop={(close) => <Pick items={m.inputs.filter((i) => types.includes(i.type)).map((i) => ({ key: i.id, label: i.name, on: i.id === id }))} onPick={(k) => { set(k); close(); }} />}>{varName(doc, id)}</Token>
  );
  switch (w.type) {
    case 'pointer': return w.event === 'leave' ? <>the pointer {verbTok('moves off')} {layerTok(w.layerId)}</> : <>someone {verbTok(verb?.label ?? w.event)} {layerTok(w.layerId)}</>;
    case 'key': return <>someone {verbTok('presses')} the <Token label="Change the key" pop={(close) => <Pick items={['Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'any'].map((k) => ({ key: k, label: k === ' ' ? 'Space' : k === 'any' ? 'any key' : k, on: k === w.key }))} onPick={(k) => { onChange({ ...w, key: k }); close(); }} />}>{w.key === ' ' ? 'Space' : w.key === 'any' ? 'any' : w.key}</Token> key</>;
    case 'start': return <>{verbTok('it first appears')}</>;
    case 'finished': return <><Token label="Change which move" pop={(close) => <Pick items={m.animations.map((a) => ({ key: a.id, label: a.name, on: a.id === w.animationId }))} onPick={(k) => { onChange({ ...w, animationId: k }); close(); }} />}>{m.animations.find((a) => a.id === w.animationId)?.name ?? '?'}</Token> {verbTok('finishes')}</>;
    case 'boolean': return <>{pickVar(['boolean'], w.inputId, (inputId) => onChange({ ...w, inputId }))} {verbTok('turns')} <Token label="On or off" pop={(close) => <Pick items={[{ key: 'on', label: 'on', on: w.value }, { key: 'off', label: 'off', on: !w.value }]} onPick={(k) => { onChange({ ...w, value: k === 'on' }); close(); }} />}>{w.value ? 'on' : 'off'}</Token></>;
    case 'changed': return <>{pickVar(['boolean', 'number', 'string', 'enum', 'vector2', 'color'], w.inputId, (inputId) => onChange({ ...w, inputId }))} {verbTok('changes')}</>;
    case 'trigger': return <>the {pickVar(['trigger'], w.inputId, (inputId) => onChange({ ...w, inputId }))} button {verbTok('is pressed')}</>;
    case 'number': return <>{pickVar(['number'], w.inputId, (inputId) => onChange({ ...w, inputId }))} {verbTok(w.op === '>=' ? 'reaches' : w.op === '<' ? 'drops below' : w.op === '>' ? 'goes above' : w.op === '<=' ? 'drops to' : w.op === '!=' ? 'leaves' : 'equals')} <input className="tok-num" type="number" value={w.value} onChange={(e) => onChange({ ...w, value: Number(e.target.value) })} aria-label="Value" onClick={(e) => e.stopPropagation()} /></>;
    case 'stateEnter': return <>it {verbTok('switches to')} <Token label="Change which state" pop={(close) => <Pick items={(m.states ?? []).map((s) => ({ key: s.id, label: s.name, on: s.id === w.stateId }))} onPick={(k) => { onChange({ ...w, stateId: k }); close(); }} />}>{stateName(doc, w.stateId)}</Token></>;
    case 'event': return <>the message <input className="tok-text" value={w.name} onChange={(e) => onChange({ ...w, name: e.target.value || 'message' })} aria-label="Message name" onClick={(e) => e.stopPropagation()} /> {verbTok('arrives')}</>;
  }
}

/** A short "then …" phrase for the folded card. */
function thenWords(r: Rule, doc: SceneDocument) {
  const parts: string[] = [];
  if (r.to) parts.push(`switch to ${stateName(doc, r.to)}`);
  for (const a of r.do.slice(0, r.to ? 1 : 2)) parts.push(describeAction(a, doc).replace(/^./, (c) => c.toLowerCase()));
  const more = r.do.length - (r.to ? 1 : 2);
  return parts.join(', ') + (more > 0 ? ` and ${more} more` : '') || 'nothing yet';
}

// ---------- one interaction ----------

export function InteractionCard({ doc, rule, open, onToggle, n }: { doc: SceneDocument; rule: Rule; open: boolean; onToggle: () => void; n: number }) {
  const set = (patch: Partial<Rule>) => updateRule(rule.id, patch);
  const states = doc.machine.states ?? [];
  const s = logicSummary(rule);
  const t = resolveTransition(rule);
  const setT = (patch: Partial<NonNullable<Rule['transition']>>) => set({ transition: { ...(rule.transition ?? {}), ...patch } });
  const [onlyIf, setOnlyIf] = useState(rule.only.length > 0);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) card.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [open]);
  return (
    <div ref={card} className={`icard ${open ? 'open' : ''} ${rule.enabled === false ? 'off' : ''}`} aria-label={`Interaction ${n}`}>
      <div className="icard-sentence" onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onToggle(); }} aria-expanded={open}>
        <span className="icard-n">{n}</span>
        <span className="icard-text">
          <b className="w-when">When</b> <WhenSentence doc={doc} w={rule.when} onChange={(when) => set({ when })} />
          {rule.from && <> <span className="faint">(while it’s {stateName(doc, rule.from)})</span></>}
          {rule.only.length > 0 && <> <span className="faint">· only if {rule.only.length === 1 ? 'a condition is met' : `${rule.only.length} conditions are met`}</span></>}
          {' '}<span className="w-then">→</span> {thenWords(rule, doc)}
        </span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
      </div>
      {!s.simple && !open && <div className="summary-chip">{summaryText(rule)}</div>}
      {open && (
        <div className="icard-body">
          {states.length > 0 && (
            <div className="icard-row">
              <span className="lbl">Switch to</span>
              <select className="input sm" value={rule.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} aria-label="Switch to state"><option value="">— don’t switch state</option>{states.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            </div>
          )}
          <div className="lbl">{rule.to ? 'Also do this, in order' : 'Do this, in order'}</div>
          <StepList doc={doc} rule={rule} list={{ root: 'do', steps: [] }} onChange={set} />

          {onlyIf ? (
            <div className="col" style={{ gap: 6 }}>
              <div className="row between"><span className="lbl">Only if…</span><button className="btn sm ghost" onClick={() => { set({ only: [], match: undefined }); setOnlyIf(false); }}>Remove</button></div>
              <ConditionTree doc={doc} group={rootGroup(rule)} treeId={`${rule.id}-root`} onChange={(g) => set(fromRootGroup(g))} allowText={false} />
            </div>
          ) : <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { if (!rule.only.length) set({ only: [newLeaf(doc)] }); setOnlyIf(true); }}><Icon name="plus" size={11} />Only if…</button>}

          <details className="more">
            <summary>More options</summary>
            <div className="icard-grid">
              <span className="lbl">Smoothness</span>
              <span className="row" style={{ gap: 8 }}><input type="range" min={0} max={1} step={0.01} value={t.duration} onChange={(e) => setT({ duration: Number(e.target.value) })} aria-label="Smoothness" style={{ flex: 1, accentColor: 'var(--accent)' }} /><span className="faint mono" style={{ width: 56 }}>{t.duration < 0.05 ? 'instant' : `${Math.round(t.duration * 1000)} ms`}</span></span>
              <span className="lbl">Wait first</span>
              <span className="row" style={{ gap: 4 }}><input className="input sm" style={{ width: 80 }} type="number" min={0} step={50} value={Math.round(t.delay * 1000)} onChange={(e) => setT({ delay: Math.max(0, Number(e.target.value) / 1000) })} aria-label="Wait before starting, in milliseconds" /><span className="faint">ms before starting</span></span>
              <span className="lbl">If it happens again while still running</span>
              <select className="input sm" value={t.interruption} onChange={(e) => setT({ interruption: e.target.value as any })} aria-label="If it happens again while still running">
                <option value="allow">start again straight away</option><option value="queue">finish first, then do it again</option><option value="wait">finish first, then do the latest one</option><option value="ignore">ignore it</option>
              </select>
              {states.length > 0 && <>
                <span className="lbl">Only while it’s</span>
                <select className="input sm" value={rule.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} aria-label="Only while in state"><option value="">in any state</option>{states.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              </>}
              <span className="lbl">Name</span>
              <input className="input sm" value={rule.name ?? ''} placeholder="Optional" maxLength={60} onChange={(e) => set({ name: e.target.value || undefined })} aria-label="Interaction name" />
              <span className="lbl">Turned on</span>
              <Switch checked={rule.enabled !== false} onChange={(v) => set({ enabled: v ? undefined : false })} label="Interaction is on" />
            </div>
            <details className="more inner">
              <summary>Expert settings</summary>
              <div className="icard-grid">
                <span className="lbl">Easing</span><EasingField value={t.easing} onChange={(easing) => setT({ easing })} />
                <span className="lbl">Priority</span>
                <select className="input sm" value={t.priority} onChange={(e) => setT({ priority: e.target.value as any })} aria-label="Priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High, wins over normal ones</option><option value="critical">Critical, always wins</option></select>
                <span className="lbl">Mixing</span>
                <select className="input sm" value={t.blend} onChange={(e) => setT({ blend: e.target.value as any })} aria-label="Mixing"><option value="crossfade">Blend smoothly</option><option value="replace">Replace what’s playing</option><option value="additive">Add on top</option></select>
                {rule.to && <>
                  <span className="lbl">State’s move</span>
                  <label className="row" style={{ gap: 6, fontSize: 12 }}><input type="checkbox" checked={t.playStateMove} onChange={(e) => setT({ playStateMove: e.target.checked })} />play {stateName(doc, rule.to)}’s move</label>
                  <span className="lbl">Before switching</span>
                  <StepList doc={doc} rule={rule} list={{ root: 'exit', steps: [] }} onChange={set} />
                </>}
              </div>
            </details>
          </details>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm ghost" onClick={() => commit((d) => ({ ...d, machine: { ...d.machine, rules: [...d.machine.rules, { ...structuredClone(rule), id: uid('ru') }] } }))}><Icon name="copy" size={11} />Duplicate</button>
            <div className="grow" />
            <button className="btn sm ghost" style={{ color: 'var(--danger)' }} onClick={() => deleteRule(rule.id)}><Icon name="trash" size={11} />Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- the guided helper ----------

type DoKind = 'play' | 'flip' | 'reverse' | 'stop' | 'sound' | 'toggle' | 'show' | 'hide' | 'state';
const DO_OPTIONS: { key: DoKind; icon: string; label: string; hint: string }[] = [
  { key: 'play', icon: 'play', label: 'Play a move', hint: 'One of your animations' },
  { key: 'flip', icon: 'refresh', label: 'Play it, then back next time', hint: 'Like a switch: on, off, on…' },
  { key: 'reverse', icon: 'undo', label: 'Play a move backwards', hint: 'Undo how it looks' },
  { key: 'stop', icon: 'pause', label: 'Stop a move', hint: 'Freeze a looping animation' },
  { key: 'sound', icon: 'sound', label: 'Play a sound', hint: 'A click, pop, chime…' },
  { key: 'toggle', icon: 'check', label: 'Flip a switch', hint: 'Turn an on/off switch around' },
  { key: 'show', icon: 'eye', label: 'Show something', hint: 'Make a layer appear' },
  { key: 'hide', icon: 'eyeOff', label: 'Hide something', hint: 'Make a layer disappear' },
  { key: 'state', icon: 'layers', label: 'Switch state', hint: 'Go to Hover, Pressed…' },
];

/** Three plain questions: what do people do, on what, and what should happen. */
export function NewInteraction({ doc, onClose, onCreated }: { doc: SceneDocument; onClose: () => void; onCreated: (id: string) => void }) {
  const m = doc.machine;
  const [step, setStep] = useState(0);
  const [whenK, setWhenK] = useState<string | null>(null);
  const [target, setTarget] = useState<string | undefined>(defaultTarget(doc));
  const [doK, setDoK] = useState<DoKind | null>(null);
  const [what, setWhat] = useState<string>('');
  const [pair, setPair] = useState(true);
  const opt = WHEN_OPTIONS.find((o) => o.key === whenK);
  const pointer = whenK === 'enter' || whenK === 'leave' || whenK === 'click' || whenK === 'down' || whenK === 'up';
  const layers = [...doc.layers].reverse().filter((l) => l.type !== 'group');
  const choicesFor = (k: DoKind | null): { key: string; label: string }[] =>
    k === 'play' || k === 'flip' || k === 'reverse' || k === 'stop' ? m.animations.map((a) => ({ key: a.id, label: a.name }))
      : k === 'sound' ? BUILTIN_SOUNDS.map((s) => ({ key: s, label: SOUND_LABELS[s] }))
      : k === 'toggle' ? m.inputs.filter((i) => i.type === 'boolean').map((i) => ({ key: i.id, label: i.name }))
      : k === 'show' || k === 'hide' ? layers.map((l) => ({ key: l.id, label: l.name }))
      : k === 'state' ? (m.states ?? []).map((s) => ({ key: s.id, label: s.name })) : [];
  const can = (k: DoKind) => choicesFor(k).length > 0;
  const action = (k: DoKind, id: string, reverse = false): Action =>
    k === 'play' || k === 'reverse' ? { type: 'play', animationId: id, direction: k === 'reverse' || reverse ? 'reverse' : 'forward', from: k === 'reverse' || reverse ? 'current' : 'start' }
      : k === 'stop' ? { type: 'stop', animationId: id }
      : k === 'sound' ? { type: 'sound', sound: id as any, assetId: null, volume: 0.7 }
      : k === 'toggle' ? { type: 'setBoolean', inputId: id, value: 'toggle' }
      : { type: 'visibility', layerId: id, visible: (k === 'show') !== reverse ? 'show' : 'hide' };
  // A natural "undo" for hover and press-and-hold, offered as one tick box.
  const pairWith = whenK === 'enter' ? 'leave' : whenK === 'down' ? 'up' : null;
  const pairable = !!pairWith && (doK === 'play' || doK === 'show' || doK === 'hide');
  const create = () => {
    if (!opt || !doK || !what) return;
    const when = { ...opt.make(doc)!, ...(pointer ? { layerId: target } : {}) } as When;
    const base = { only: [], transition: smartTransition(when, m.defaults) };
    if (doK === 'flip') {
      // A switch remembers on/off: the trigger flips it; on plays the move, off plays it back
      // (or stops it, if it repeats). Three plain interactions anyone can read afterwards.
      const anim = m.animations.find((x) => x.id === what)!;
      const sw = { id: uid('in'), name: `${anim.name} on`.slice(0, 40), type: 'boolean' as const, default: false };
      const ids = [uid('ru'), uid('ru'), uid('ru')];
      const back: Action = anim.loop !== 'once' ? { type: 'stop', animationId: what } : { type: 'play', animationId: what, direction: 'reverse', from: 'current' };
      commit((d) => ({ ...d, machine: { ...d.machine, inputs: [...d.machine.inputs, sw], rules: [...d.machine.rules,
        { id: ids[0], ...base, when, do: [{ type: 'setBoolean', inputId: sw.id, value: 'toggle' }] },
        { id: ids[1], only: [], when: { type: 'boolean', inputId: sw.id, value: true }, do: [{ type: 'play', animationId: what, direction: 'forward', from: 'current' }] },
        { id: ids[2], only: [], when: { type: 'boolean', inputId: sw.id, value: false }, do: [back] },
      ] } }));
      onCreated(ids[0]); onClose(); return;
    }
    const first = doK === 'state' ? addRule({ ...base, when, do: [], to: what }) : addRule({ ...base, when, do: [action(doK, what)] });
    if (pairable && pair && pairWith) {
      const back = { ...when, event: pairWith } as When;
      addRule({ only: [], transition: smartTransition(back, m.defaults), when: back, do: [action(doK, what, true)] });
    }
    onCreated(first);
    onClose();
  };
  const tiles = (items: { key: string; icon: string; label: string; hint: string; disabled?: boolean }[], on: string | null, pick: (k: string) => void) => (
    <div className="tiles">{items.map((t) => <button key={t.key} className={`tile ${on === t.key ? 'on' : ''}`} disabled={t.disabled} onClick={() => pick(t.key)}><Icon name={t.icon as any} size={18} /><b>{t.label}</b><small>{t.hint}</small></button>)}</div>
  );
  const steps = ['What do people do?', pointer ? 'On what?' : '', 'What should happen?'].filter(Boolean);
  const stepTitle = step === 0 ? steps[0] : pointer && step === 1 ? 'On what?' : 'What should happen?';
  const onWhat = pointer && step === 1;
  const doStep = step === (pointer ? 2 : 1);
  return (
    <Modal open onClose={onClose} wide title="New interaction" subtitle={<span className="wiz-steps">{steps.map((s, i) => <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{i + 1}. {s}</span>)}</span>}
      footer={<>
        {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
        <div className="grow" />
        {doStep ? <button className="btn primary" disabled={!doK || !what} onClick={create}>Create</button>
          : <button className="btn primary" disabled={step === 0 ? !whenK : false} onClick={() => setStep(step + 1)}>Next</button>}
      </>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="wiz-q">{stepTitle}</div>
        {step === 0 && (
          <>
            {(['People', 'Automatic'] as const).map((g) => (
              <div key={g} className="col" style={{ gap: 6 }}>
                <span className="sec-h">{g === 'People' ? 'When someone…' : 'Or automatically, when…'}</span>
                {tiles(WHEN_OPTIONS.filter((o) => o.group === g).map((o) => ({ key: o.key, icon: o.icon, label: o.label, hint: o.hint, disabled: !o.make(doc) })), whenK, (k) => { setWhenK(k); })}
              </div>
            ))}
          </>
        )}
        {onWhat && (
          <div className="pick wide" role="listbox">
            {[{ id: '', name: 'Anywhere on the canvas', type: 'canvas' }, ...layers].map((l: any) => (
              <button key={l.id} role="option" aria-selected={(target ?? '') === l.id} className={`pick-item ${(target ?? '') === l.id ? 'on' : ''}`} onClick={() => setTarget(l.id || undefined)}>
                <Icon name={l.type === 'canvas' ? 'maximize' : l.type === 'text' ? 'type' : l.type === 'image' ? 'image' : 'shapes'} size={13} /><span>{l.name}{l.name === 'Touch area' && <small>The invisible area around the main thing. Usually the best choice</small>}</span>
              </button>
            ))}
          </div>
        )}
        {doStep && (
          <>
            {tiles(DO_OPTIONS.filter((o) => o.key !== 'flip' || whenK === 'click' || whenK === 'key').map((o) => ({ ...o, disabled: !can(o.key) })), doK, (k) => { setDoK(k as DoKind); setWhat(choicesFor(k as DoKind)[0]?.key ?? ''); })}
            {doK && (
              <label className="col" style={{ gap: 4 }}>
                <span className="label">{doK === 'flip' ? 'Which move' : doK === 'sound' ? 'Which sound' : doK === 'toggle' ? 'Which switch' : doK === 'state' ? 'Which state' : doK === 'show' || doK === 'hide' ? 'Which layer' : 'Which move'}</span>
                <select className="input" value={what} onChange={(e) => setWhat(e.target.value)}>{choicesFor(doK).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
              </label>
            )}
            {pairable && (
              <label className="row" style={{ gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={pair} onChange={(e) => setPair(e.target.checked)} />
                {whenK === 'enter' ? 'Undo it when the pointer moves off' : 'Undo it when they let go'} <span className="faint">(adds a second interaction)</span>
              </label>
            )}
            {opt && doK && what && <div className="wiz-preview">When {opt.group === 'People' ? 'someone ' : ''}{opt.label}{pointer ? <> <b>{layerName(doc, target)}</b></> : ''} → {DO_OPTIONS.find((d) => d.key === doK)!.label.toLowerCase()} <b>{choicesFor(doK).find((c) => c.key === what)?.label}</b></div>}
          </>
        )}
      </div>
    </Modal>
  );
}
