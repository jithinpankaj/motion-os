import { useState } from 'react';
import type { Input, SceneDocument } from '../../../shared/scene/schema';
import { VAR_LABEL } from '../../../shared/motion/logic';
import { Switch } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { pathLabel } from './Animate';
import { addBinding, addInput, addState, deleteBinding, deleteInput, deleteState, selectRule, setInitialState, updateBinding, updateInput, updateState, useEditor } from './store';
import { ValueInput } from './interact/Actions';
import { InteractionCard, NewInteraction, type InteractionDraft } from './interact/Simple';
import { InteractionMap } from './interact/InteractionMap';
import type { MotionRuntime } from '../../../shared/motion/runtime';

/**
 * Interact, right panel. Selecting a connection on the Interaction Canvas (or a rule here) opens its
 * inspector; otherwise this lists the variables, every interaction, slider links and the defaults new
 * connections start with. Simple controls come first; advanced variable types are one click away.
 */
const TYPE_ICON: Record<Input['type'], string> = { boolean: 'check', trigger: 'play', number: 'gauge', string: 'type', enum: 'layers', vector2: 'move', color: 'brand' };

export function InteractPanel({ doc, runtime }: { doc: SceneDocument; runtime: MotionRuntime | null }) {
  const m = doc.machine;
  canvasSize = { w: doc.canvas.width, h: doc.canvas.height };
  const open = useEditor((s) => s.selectedRule);
  const [wizard, setWizard] = useState<InteractionDraft | null>(null);
  return (
    <div>
      <div className="sec">
        <div className="sec-h">Map</div>
        <InteractionMap doc={doc} runtime={runtime} onDraft={(d) => setWizard(d)} />
      </div>
      <div className="sec">
        <div className="sec-h">Interactions <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{m.rules.length}</span></div>
        <div className="empty-hint">Each interaction is a sentence: <b>when</b> something happens, <b>do</b> something. Click any underlined word to change it.</div>
        <button className="btn primary" onClick={() => setWizard({})}><Icon name="plus" size={13} />New interaction</button>
        {!m.animations.length && <div className="empty-hint">Tip: make a move in <b>Animate</b> first. Then an interaction can play it.</div>}
        {m.rules.map((r, i) => <InteractionCard key={r.id} doc={doc} rule={r} n={i + 1} open={open === r.id} onToggle={() => selectRule(open === r.id ? null : r.id)} />)}
      </div>

      <States doc={doc} />
      <Variables doc={doc} />

      <div className="sec">
        <div className="sec-h">Slider links</div>
        <div className="empty-hint">Let a slider drive a property directly, like a progress bar’s width.</div>
        {m.bindings.map((b) => {
          const l = doc.layers.find((x) => x.id === b.layerId);
          return (
            <div key={b.id} className="rule">
              <div className="w">
                <select value={b.inputId} onChange={(e) => updateBinding(b.id, { inputId: e.target.value })} aria-label="Slider">{m.inputs.filter((i) => i.type === 'number').map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
                <span>from</span><input className="inl" type="number" value={b.from[0]} onChange={(e) => updateBinding(b.id, { from: [Number(e.target.value), b.from[1]] }, `bf:${b.id}`)} aria-label="Slider start" />
                <span>to</span><input className="inl" type="number" value={b.from[1]} onChange={(e) => updateBinding(b.id, { from: [b.from[0], Number(e.target.value)] }, `bf:${b.id}`)} aria-label="Slider end" />
              </div>
              <div className="w">
                <span>moves</span>
                <select value={b.layerId} onChange={(e) => updateBinding(b.id, { layerId: e.target.value })} aria-label="Layer">{doc.layers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <select value={b.path} onChange={(e) => updateBinding(b.id, { path: e.target.value })} aria-label="Property">{numberPaths(l).map((p) => <option key={p} value={p}>{pathLabel(p)}</option>)}</select>
              </div>
              <div className="w">
                <select value={b.relative ? 'by' : 'to'} onChange={(e) => updateBinding(b.id, { relative: e.target.value === 'by', to: e.target.value === 'by' ? [-20 / k(b.path), 20 / k(b.path)].map((v) => +v.toFixed(4)) as [number, number] : b.to })} aria-label="Set or shift">
                  <option value="to">set it from</option><option value="by">shift it by</option>
                </select>
                <input className="inl" type="number" value={+(b.to[0] * k(b.path)).toFixed(2)} onChange={(e) => updateBinding(b.id, { to: [Number(e.target.value) / k(b.path), b.to[1]] }, `bt:${b.id}`)} aria-label="Property start" />
                <span>to</span><input className="inl" type="number" value={+(b.to[1] * k(b.path)).toFixed(2)} onChange={(e) => updateBinding(b.id, { to: [b.to[0], Number(e.target.value) / k(b.path)] }, `bt:${b.id}`)} aria-label="Property end" />
                {(b.path === 'transform.x' || b.path === 'transform.y') && <span className="faint">px</span>}
                <div className="grow" /><button className="icon-btn sm" aria-label="Remove slider link" onClick={() => deleteBinding(b.id)}><Icon name="trash" size={12} /></button>
              </div>
            </div>
          );
        })}
        <button className="btn sm" disabled={!m.inputs.some((i) => i.type === 'number') || !doc.layers.length} title={!m.inputs.some((i) => i.type === 'number') ? 'Add a slider control first' : undefined}
          onClick={() => { const i = m.inputs.find((x) => x.type === 'number')!; const l = doc.layers[doc.layers.length - 1]; addBinding({ inputId: i.id, layerId: l.id, path: 'transform.rotation', from: [i.min ?? 0, i.max ?? 100], to: [0, 360] }); }}>
          <Icon name="plus" size={12} />Link a slider
        </button>
      </div>
      {wizard && <NewInteraction doc={doc} draft={wizard} onClose={() => setWizard(null)} onCreated={(id) => selectRule(id)} />}
    </div>
  );
}

/** States: named poses (Rest, Hover, Pressed). An interaction can switch to one; entering it plays its move. */
function States({ doc }: { doc: SceneDocument }) {
  const states = doc.machine.states ?? [];
  const [show, setShow] = useState(states.length > 0);
  if (!show) return (
    <div className="sec"><button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShow(true)}><Icon name="layers" size={12} />Use states (optional)</button></div>
  );
  return (
    <div className="sec">
      <div className="sec-h">States</div>
      <div className="empty-hint">Optional. A state is a named pose like <b>Rest</b>, <b>Hover</b> or <b>Pressed</b>. An interaction can <b>switch to</b> a state, which plays its move. Handy when there are several poses.</div>
      {states.map((st) => (
        <div key={st.id} className="ctrl">
          <span className="ic"><Icon name="layers" size={13} /></span>
          <input className="nm" defaultValue={st.name} onBlur={(e) => e.target.value.trim() && updateState(st.id, { name: e.target.value.trim().slice(0, 40) })} aria-label="State name" />
          <select className="input sm" style={{ width: 110 }} value={st.animationId ?? ''} onChange={(e) => updateState(st.id, { animationId: e.target.value || null })} aria-label={`${st.name} plays`}>
            <option value="">no move</option>{doc.machine.animations.map((a) => <option key={a.id} value={a.id}>plays {a.name}</option>)}
          </select>
          {doc.machine.initialState === st.id ? <span className="start-pill" title="It starts in this state">Start</span>
            : <button className="icon-btn sm" title="Start in this state" aria-label={`Start in ${st.name}`} onClick={() => setInitialState(st.id)}><Icon name="play" size={11} /></button>}
          <button className="icon-btn sm" aria-label={`Delete ${st.name}`} onClick={() => { if (confirm(`Delete the state “${st.name}”? Interactions that switch to it stop switching.`)) deleteState(st.id); }}><Icon name="trash" size={12} /></button>
        </div>
      ))}
      <button className="btn sm" onClick={() => addState(states.length ? 'State' : 'Rest', doc.machine.animations[0]?.id ?? null)}><Icon name="plus" size={12} />Add a state</button>
    </div>
  );
}

/** The variable manager: name, type, starting value and limits. Live values show in Try it. */
function Variables({ doc }: { doc: SceneDocument }) {
  const [more, setMore] = useState(false);
  return (
    <div className="sec">
      <div className="sec-h">Switches & values</div>
      <div className="empty-hint">Things your interactions can remember and change. An on/off switch, a button, a number. People can also change them from the page.</div>
      {doc.machine.inputs.map((i) => <ControlRow key={i.id} input={i} doc={doc} />)}
      <div className="row wrap" style={{ gap: 6 }}>
        {(['boolean', 'trigger', 'number'] as const).map((t) => <button key={t} className="btn sm grow" onClick={() => addInput(t)}><Icon name="plus" size={12} />{t === 'boolean' ? 'Switch' : t === 'number' ? 'Number' : 'Button'}</button>)}
        <button className="btn sm ghost" aria-expanded={more} onClick={() => setMore(!more)}><Icon name={more ? 'chevronDown' : 'chevronRight'} size={11} />More types</button>
      </div>
      {more && <div className="row wrap" style={{ gap: 6 }}>{(['string', 'enum', 'vector2', 'color'] as const).map((t) => <button key={t} className="btn sm grow" onClick={() => addInput(t)}><Icon name="plus" size={12} />{VAR_LABEL[t]}</button>)}</div>}
    </div>
  );
}

function ControlRow({ input, doc }: { input: Input; doc: SceneDocument }) {
  const [limits, setLimits] = useState(false);
  const hasLimits = input.type === 'number' || input.type === 'vector2' || input.type === 'string' || input.type === 'enum';
  return (
    <div className="col" style={{ gap: 4 }}>
    <div className="ctrl">
      <span className="ic" title={VAR_LABEL[input.type]}><Icon name={TYPE_ICON[input.type] as any} size={13} /></span>
      <input className="nm" value={input.name} onChange={(e) => e.target.value.trim() && updateInput(input.id, { name: e.target.value }, `in-name:${input.id}`)} aria-label={`${VAR_LABEL[input.type]} name`} />
      <span className="ctrl-type">{VAR_LABEL[input.type]}</span>
      {input.type === 'boolean' && <Switch checked={!!input.default} onChange={(v) => updateInput(input.id, { default: v })} label="Starts on" />}
      {input.type !== 'boolean' && input.type !== 'trigger' && <span className="rule" style={{ padding: 0, border: 0, background: 'none', display: 'contents' }}><ValueInput type={input.type} options={input.options} min={input.min} max={input.max} value={input.default} onChange={(v) => updateInput(input.id, { default: v }, `in-def:${input.id}`)} /></span>}
      {hasLimits && <button className="icon-btn sm" aria-label={`Limits for ${input.name}`} aria-pressed={limits} title="Limits and validation" onClick={() => setLimits(!limits)}><Icon name="settings" size={12} /></button>}
      <button className="icon-btn sm" aria-label={`Delete ${input.name}`} onClick={() => deleteInput(input.id)}><Icon name="trash" size={12} /></button>
    </div>
    {limits && (
      <div className="row wrap rule" style={{ gap: 6, marginLeft: 36, padding: 8 }}>
        {(input.type === 'number' || input.type === 'vector2') && <>
          <span className="faint">min</span><input className="inl" type="number" value={input.min ?? ''} placeholder="none" onChange={(e) => updateInput(input.id, { min: e.target.value === '' ? undefined : Number(e.target.value) }, `in-min:${input.id}`)} aria-label="Minimum" />
          <span className="faint">max</span><input className="inl" type="number" value={input.max ?? ''} placeholder="none" onChange={(e) => updateInput(input.id, { max: e.target.value === '' ? undefined : Number(e.target.value) }, `in-max:${input.id}`)} aria-label="Maximum" />
        </>}
        {input.type === 'string' && <><span className="faint">at most</span><input className="inl" type="number" min={1} max={200} value={input.maxLength ?? 200} onChange={(e) => updateInput(input.id, { maxLength: Math.max(1, Math.min(200, Number(e.target.value) || 200)) }, `in-len:${input.id}`)} aria-label="Maximum length" /><span className="faint">characters</span></>}
        {input.type === 'enum' && <><span className="faint">choices</span><input className="inl" style={{ width: 200 }} defaultValue={(input.options ?? []).join(', ')} onBlur={(e) => { const opts = [...new Set(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 32); if (opts.length) updateInput(input.id, { options: opts, default: opts.includes(String(input.default)) ? input.default : opts[0] }); }} aria-label="Choices, separated by commas" /></>}
      </div>
    )}
    {input.type === 'number' && (
      <div className="row" style={{ gap: 6, paddingLeft: 36, fontSize: 12 }}>
        <span className="faint">Follows the pointer</span>
        <select className="input" style={{ height: 26, fontSize: 11.5, width: 'auto' }} value={input.follow ?? ''} onChange={(e) => updateInput(input.id, { follow: (e.target.value || undefined) as any })} aria-label={`${input.name} follows the pointer`}>
          <option value="">no</option><option value="pointerX">left ↔ right</option><option value="pointerY">up ↕ down</option>
        </select>
        {input.follow && <>
          <select className="input" style={{ height: 26, fontSize: 11.5, width: 'auto' }} value={input.dragLayer ?? ''} onChange={(e) => updateInput(input.id, { dragLayer: e.target.value || undefined })} aria-label="When it follows">
            <option value="">all the time</option>
            {doc.layers.filter((l) => l.type !== 'group').map((l) => <option key={l.id} value={l.id}>while dragging {l.name}</option>)}
          </select>
          <span className="faint">lag</span><input type="range" min={0} max={0.95} step={0.05} value={input.smoothing ?? 0.6} onChange={(e) => updateInput(input.id, { smoothing: Number(e.target.value) }, `in-sm:${input.id}`)} aria-label="How lazily it follows" style={{ width: 60 }} />
          <span className="faint">bounce</span><input type="range" min={0} max={0.9} step={0.05} value={input.bounce ?? 0} onChange={(e) => updateInput(input.id, { bounce: Number(e.target.value) || undefined }, `in-b:${input.id}`)} aria-label="How much it bounces" style={{ width: 60 }} />
        </>}
      </div>
    )}
    </div>
  );
}

/** Positions are stored as fractions of the canvas; links show them in pixels. */
let canvasSize = { w: 1080, h: 1080 };
const k = (path: string) => (path === 'transform.x' ? canvasSize.w : path === 'transform.y' ? canvasSize.h : 1);

function numberPaths(l: SceneDocument['layers'][number] | undefined): string[] {
  const common = ['transform.x', 'transform.y', 'transform.rotation', 'transform.scale', 'opacity'];
  if (!l) return common;
  if (l.type === 'shape') return [...common, 'props.width', 'props.height', 'props.radius', 'props.innerRadius', 'props.stroke.width', 'props.fill.angle'];
  if (l.type === 'text') return [...common, 'props.size', 'props.tracking'];
  if (l.type === 'image') return [...common, 'props.width', 'props.height'];
  if (l.type === 'gradient') return ['opacity', 'props.noiseAmp', 'props.distortion', 'props.grain'];
  if (l.type === 'particles') return ['opacity', 'props.size', 'props.velocity', 'props.noise'];
  return common;
}

