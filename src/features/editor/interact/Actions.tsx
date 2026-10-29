import { useState } from 'react';
import type { Action, LeafAction, Rule, SceneDocument, VarValue } from '../../../../shared/scene/schema';
import { describeAction } from '../../../../shared/motion/logic';
import { Icon } from '../../../ui/Icon';
import { ConditionTree } from './Conditions';
import { SoundPicker } from './SoundPicker';
import { STEP_KINDS, insertStep, listAt, moveStep, newStep, readDrag, setStep, startDrag, type ListPath } from './tree';

/**
 * Ordered steps for a connection. Steps run top to bottom; "At the same time" runs its steps together
 * and continues when all are done; "If … otherwise …" picks a path. Steps drag to reorder and can be
 * dropped into (or out of) those blocks.
 */
export function StepList({ doc, rule, list, onChange, depth = 0 }: { doc: SceneDocument; rule: Rule; list: ListPath; onChange: (patch: Partial<Rule>) => void; depth?: number }) {
  const steps = listAt(rule, list);
  const [over, setOver] = useState<number | null>(null);
  const drop = (e: React.DragEvent, index: number) => {
    e.preventDefault(); e.stopPropagation(); setOver(null);
    const d = readDrag(e) as any;
    if (!d) return;
    if (d.kind === 'step' && d.tree === rule.id) onChange(moveStep(rule, d.path, list, index));
    else if (d.kind === 'newStep') { const a = newStep(d.step, doc); if (a) onChange(insertStep(rule, list, index, a)); }
  };
  const zone = (index: number) => <div className={`drop-line ${over === index ? 'on' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(index); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, index)} />;
  return (
    <div className={`isteps ${depth ? 'nested' : ''}`}>
      {zone(0)}
      {steps.map((a, i) => (
        <div key={i}>
          <div className={`istep ${a.type === 'parallel' || a.type === 'branch' ? 'container' : ''}`}>
            <div className="step-h">
              <span className="grip" draggable onDragStart={(e) => startDrag(e, { kind: 'step', path: { list, i }, tree: rule.id } as any)} title="Drag to reorder"><Icon name="drag" size={12} /></span>
              <span className="step-n">{i + 1}</span>
              {a.type === 'parallel' ? <span className="step-title">At the same time</span>
                : a.type === 'branch' ? <span className="step-title">If</span>
                : <StepEditor doc={doc} a={a} onChange={(na) => onChange(setStep(rule, { list, i }, na))} />}
              <div className="grow" />
              <button className="icon-btn sm" aria-label={`Remove step ${i + 1}: ${describeAction(a, doc)}`} onClick={() => onChange(setStep(rule, { list, i }, null))}><Icon name="x" size={11} /></button>
            </div>
            {a.type === 'parallel' && <StepList doc={doc} rule={rule} list={{ root: list.root, steps: [...list.steps, { i, key: 'actions' }] }} onChange={onChange} depth={depth + 1} />}
            {a.type === 'branch' && (
              <div className="branch">
                <ConditionTree allowText={false} doc={doc} group={a.if} treeId={`${rule.id}-b${list.steps.map((s) => s.i).join('.')}.${i}`} onChange={(g) => onChange(setStep(rule, { list, i }, { ...a, if: g }))} />
                <div className="branch-h then">Then</div>
                <StepList doc={doc} rule={rule} list={{ root: list.root, steps: [...list.steps, { i, key: 'then' }] }} onChange={onChange} depth={depth + 1} />
                <div className="branch-h else">Otherwise</div>
                <StepList doc={doc} rule={rule} list={{ root: list.root, steps: [...list.steps, { i, key: 'else' }] }} onChange={onChange} depth={depth + 1} />
              </div>
            )}
          </div>
          {zone(i + 1)}
        </div>
      ))}
      <AddStep doc={doc} onAdd={(a) => onChange(insertStep(rule, list, steps.length, a))} label={depth ? 'Add step here' : 'Add action'} />
    </div>
  );
}

function AddStep({ doc, onAdd, label }: { doc: SceneDocument; onAdd: (a: Action) => void; label: string }) {
  return (
    <select className="add-step" value="" onChange={(e) => { const a = newStep(e.target.value, doc); if (a) onAdd(a); }} aria-label={label}>
      <option value="">+ {label}…</option>
      {STEP_KINDS.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.items.map((k) => <option key={k.kind} value={k.kind} disabled={!newStep(k.kind, doc)}>{k.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** One step's settings, inline. */
export function StepEditor({ doc, a, onChange }: { doc: SceneDocument; a: LeafAction; onChange: (a: Action) => void }) {
  const m = doc.machine;
  const anims = <T extends { animationId: string }>(x: T) => <select value={x.animationId} onChange={(e) => onChange({ ...(x as any), animationId: e.target.value })} aria-label="Move">{m.animations.map((an) => <option key={an.id} value={an.id}>{an.name}</option>)}</select>;
  const vars = (types: string[], id: string, set: (id: string) => void) => <select value={id} onChange={(e) => set(e.target.value)} aria-label="Variable">{m.inputs.filter((i) => types.includes(i.type)).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>;
  switch (a.type) {
    case 'play':
      return <span className="cond-words"><select value={a.direction} onChange={(e) => onChange({ ...a, direction: e.target.value as 'forward' })} aria-label="Direction"><option value="forward">Play</option><option value="reverse">Play backwards</option></select>{anims(a)}
        <select value={a.from} onChange={(e) => onChange({ ...a, from: e.target.value as 'start' })} aria-label="From"><option value="start">from the {a.direction === 'reverse' ? 'end' : 'start'}</option><option value="current">from where it is</option></select>
        <select value={a.loop ?? ''} onChange={(e) => onChange({ ...a, loop: (e.target.value || undefined) as any })} aria-label="Repeat"><option value="">as the move repeats</option><option value="once">once</option><option value="loop">on a loop</option><option value="pingpong">back and forth</option></select></span>;
    case 'stop': return <span className="cond-words"><span>Stop</span>{anims(a)}</span>;
    case 'pause': return <span className="cond-words"><span>Pause</span>{anims(a)}</span>;
    case 'waitFor': return <span className="cond-words"><span>Wait for</span>{anims(a)}<span>to finish</span></span>;
    case 'wait': return <span className="cond-words"><span>Wait</span><input className="inl" type="number" min={0} max={60000} step={50} value={Math.round(a.seconds * 1000)} onChange={(e) => onChange({ ...a, seconds: Math.max(0, Math.min(60, Number(e.target.value) / 1000)) })} aria-label="Milliseconds" /><span>ms</span></span>;
    case 'setBoolean': return <span className="cond-words"><select value={a.value} onChange={(e) => onChange({ ...a, value: e.target.value as 'on' })} aria-label="How"><option value="on">Turn on</option><option value="off">Turn off</option><option value="toggle">Flip</option></select>{vars(['boolean'], a.inputId, (inputId) => onChange({ ...a, inputId }))}</span>;
    case 'setNumber': {
      const how = a.mode === 'set' ? 'set' : a.value >= 0 ? 'inc' : 'dec';
      return <span className="cond-words"><select value={how} onChange={(e) => { const h = e.target.value; onChange({ ...a, mode: h === 'set' ? 'set' : 'add', value: h === 'dec' ? -Math.abs(a.value || 1) : h === 'inc' ? Math.abs(a.value || 1) : a.value }); }} aria-label="How"><option value="set">Set</option><option value="inc">Increase</option><option value="dec">Decrease</option></select>
        {vars(['number'], a.inputId, (inputId) => onChange({ ...a, inputId }))}<span>{how === 'set' ? 'to' : 'by'}</span>
        <input className="inl" type="number" value={how === 'dec' ? -a.value : a.value} onChange={(e) => { const n = Number(e.target.value); onChange({ ...a, value: how === 'dec' ? -Math.abs(n) : n }); }} aria-label="Amount" /></span>;
    }
    case 'setVar': {
      const v = m.inputs.find((i) => i.id === a.inputId);
      return <span className="cond-words"><span>Set</span>{vars(['string', 'enum', 'vector2', 'color'], a.inputId, (inputId) => onChange({ ...a, inputId, value: m.inputs.find((i) => i.id === inputId)!.default }))}<span>to</span><ValueInput type={v?.type ?? 'string'} options={v?.options} value={a.value} onChange={(value) => onChange({ ...a, value })} /></span>;
    }
    case 'fire': return <span className="cond-words"><span>Press</span>{vars(['trigger'], a.inputId, (inputId) => onChange({ ...a, inputId }))}</span>;
    case 'setState': return <span className="cond-words"><span>Go to state</span><select value={a.stateId} onChange={(e) => onChange({ ...a, stateId: e.target.value })} aria-label="State">{(m.states ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></span>;
    case 'visibility': return <span className="cond-words"><select value={a.visible} onChange={(e) => onChange({ ...a, visible: e.target.value as 'show' })} aria-label="Show or hide"><option value="show">Show</option><option value="hide">Hide</option><option value="toggle">Show / hide</option></select><select value={a.layerId} onChange={(e) => onChange({ ...a, layerId: e.target.value })} aria-label="Layer">{doc.layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></span>;
    case 'emit': return <span className="cond-words"><span>Send event</span><input className="inl" style={{ width: 90 }} value={a.name} onChange={(e) => onChange({ ...a, name: e.target.value || 'event' })} aria-label="Event name" /><span>with</span><input className="inl" style={{ width: 60 }} value={a.value ?? ''} placeholder="value" onChange={(e) => onChange({ ...a, value: e.target.value === '' ? undefined : isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })} aria-label="Event value" /></span>;
    case 'sound': return <span className="cond-words"><SoundPicker a={a} onChange={onChange} /></span>;
  }
}

/** An input for a variable value of any type. */
export function ValueInput({ type, value, onChange, options, min, max }: { type: string; value: VarValue; onChange: (v: VarValue) => void; options?: string[]; min?: number; max?: number }) {
  if (type === 'boolean' || type === 'trigger') return <select value={String(!!value)} onChange={(e) => onChange(e.target.value === 'true')} aria-label="Value"><option value="true">on</option><option value="false">off</option></select>;
  if (type === 'number') return <input className="inl" type="number" min={min} max={max} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} aria-label="Value" />;
  if (type === 'enum') return <select value={String(value)} onChange={(e) => onChange(e.target.value)} aria-label="Value">{(options ?? []).map((o) => <option key={o}>{o}</option>)}</select>;
  if (type === 'color') return <input type="color" value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label="Colour" />;
  if (type === 'vector2') { const v = typeof value === 'object' && value ? value : { x: 0, y: 0 }; return <><span>x</span><input className="inl" type="number" value={v.x} step={0.1} onChange={(e) => onChange({ ...v, x: Number(e.target.value) })} aria-label="x" style={{ width: 52 }} /><span>y</span><input className="inl" type="number" value={v.y} step={0.1} onChange={(e) => onChange({ ...v, y: Number(e.target.value) })} aria-label="y" style={{ width: 52 }} /></>; }
  return <input className="inl" style={{ width: 100 }} value={String(value)} onChange={(e) => onChange(e.target.value)} aria-label="Text" />;
}
