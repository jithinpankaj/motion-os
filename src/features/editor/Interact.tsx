import { useState } from 'react';
import type { Action, Condition, Input, Rule, SceneDocument, When } from '../../../shared/scene/schema';
import { Modal, Switch } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { pathLabel } from './Animate';
import { addBinding, addInput, addRule, commit, deleteBinding, deleteInput, deleteRule, updateBinding, updateInput, updateRule } from './store';
import { uid } from '../../../shared/util/random';

/**
 * Interactions in plain language. Controls are what people (or a website) change; rules say
 * "when this happens, (only if …), do that"; slider links tie a slider directly to a property.
 */
const TYPE_INFO: Record<Input['type'], { label: string; icon: string; hint: string }> = {
  boolean: { label: 'Toggle', icon: 'check', hint: 'on or off' },
  trigger: { label: 'Button', icon: 'play', hint: 'pressed' },
  number: { label: 'Slider', icon: 'gauge', hint: 'a number' },
};

export function InteractPanel({ doc }: { doc: SceneDocument }) {
  const m = doc.machine;
  canvasSize = { w: doc.canvas.width, h: doc.canvas.height };
  const [recipe, setRecipe] = useState<null | 'toggle' | 'hover' | 'press'>(null);
  return (
    <div>
      <div className="sec">
        <div className="sec-h">Controls</div>
        <div className="empty-hint">Things people can change: switches, buttons and sliders. A slider can also follow the pointer — link it to eyes or a head to make a character look at the cursor.</div>
        {m.inputs.map((i) => <ControlRow key={i.id} input={i} />)}
        <div className="row" style={{ gap: 6 }}>
          {(['boolean', 'trigger', 'number'] as const).map((t) => <button key={t} className="btn sm grow" onClick={() => addInput(t)}><Icon name="plus" size={12} />{TYPE_INFO[t].label}</button>)}
        </div>
      </div>

      <div className="sec">
        <div className="sec-h">Quick recipes</div>
        <div className="moves" style={{ gridTemplateColumns: '1fr' }}>
          <button className="move" onClick={() => setRecipe('toggle')}><Icon name="check" size={14} /><span>Click to toggle<small>Click a layer → a move plays, click again → it plays back</small></span></button>
          <button className="move" onClick={() => setRecipe('hover')}><Icon name="crosshair" size={14} /><span>Hover effect<small>Pointer over a layer plays a move; leaving reverses it</small></span></button>
          <button className="move" onClick={() => setRecipe('press')}><Icon name="play" size={14} /><span>Press to play<small>Clicking a layer plays a move from the start</small></span></button>
        </div>
      </div>

      <div className="sec">
        <div className="sec-h">Rules <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 450 }}>{m.rules.length}</span></div>
        {!m.rules.length && <div className="empty-hint">No rules yet. A rule says <b>when</b> something happens, what to <b>do</b>. Try a quick recipe above.</div>}
        {m.rules.map((r, i) => <RuleCard key={r.id} rule={r} doc={doc} n={i + 1} />)}
        <button className="btn sm" onClick={() => addRule({ when: { type: 'start' }, only: [], do: [m.animations[0] ? { type: 'play', animationId: m.animations[0].id, direction: 'forward', from: 'start' } : m.inputs[0] ? defaultAction(doc) : { type: 'play', animationId: '', direction: 'forward', from: 'start' }] })} disabled={!m.animations.length && !m.inputs.length} title={!m.animations.length && !m.inputs.length ? 'Create a move or a control first' : undefined}>
          <Icon name="plus" size={12} />Add a rule
        </button>
      </div>

      <div className="sec">
        <div className="sec-h">Slider links</div>
        <div className="empty-hint">Let a slider drive a property directly — e.g. a progress bar’s width.</div>
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
      {recipe && <RecipeDialog kind={recipe} doc={doc} onClose={() => setRecipe(null)} />}
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

function defaultAction(doc: SceneDocument): Action {
  const i = doc.machine.inputs[0];
  if (i.type === 'boolean') return { type: 'setBoolean', inputId: i.id, value: 'toggle' };
  if (i.type === 'trigger') return { type: 'fire', inputId: i.id };
  return { type: 'setNumber', inputId: i.id, mode: 'add', value: 1 };
}

function ControlRow({ input }: { input: Input }) {
  const info = TYPE_INFO[input.type];
  return (
    <div className="col" style={{ gap: 4 }}>
    <div className="ctrl">
      <span className="ic" title={info.label}><Icon name={info.icon as any} size={13} /></span>
      <input className="nm" value={input.name} onChange={(e) => e.target.value.trim() && updateInput(input.id, { name: e.target.value }, `in-name:${input.id}`)} aria-label={`${info.label} name`} />
      {input.type === 'boolean' && <Switch checked={!!input.default} onChange={(v) => updateInput(input.id, { default: v })} label="Starts on" />}
      {input.type === 'number' && <>
        <input className="input" style={{ width: 46, height: 26, fontSize: 11 }} type="number" value={input.min ?? 0} onChange={(e) => updateInput(input.id, { min: Number(e.target.value) }, `in-min:${input.id}`)} aria-label="Minimum" title="Minimum" />
        <input className="input" style={{ width: 52, height: 26, fontSize: 11 }} type="number" value={input.max ?? 100} onChange={(e) => updateInput(input.id, { max: Number(e.target.value) }, `in-max:${input.id}`)} aria-label="Maximum" title="Maximum" />
      </>}
      <button className="icon-btn sm" aria-label={`Delete ${input.name}`} onClick={() => deleteInput(input.id)}><Icon name="trash" size={12} /></button>
    </div>
    {input.type === 'number' && (
      <div className="row" style={{ gap: 6, paddingLeft: 36, fontSize: 12 }}>
        <span className="faint">Follows the pointer</span>
        <select className="input" style={{ height: 26, fontSize: 11.5, width: 'auto' }} value={input.follow ?? ''} onChange={(e) => updateInput(input.id, { follow: (e.target.value || undefined) as any })} aria-label={`${input.name} follows the pointer`}>
          <option value="">no</option><option value="pointerX">left ↔ right</option><option value="pointerY">up ↕ down</option>
        </select>
        {input.follow && <><span className="faint">lag</span><input type="range" min={0} max={0.95} step={0.05} value={input.smoothing ?? 0.6} onChange={(e) => updateInput(input.id, { smoothing: Number(e.target.value) }, `in-sm:${input.id}`)} aria-label="How lazily it follows" style={{ width: 60 }} /></>}
      </div>
    )}
    </div>
  );
}

// ---------- rule editor ----------

type WhenKind = 'start' | 'bool' | 'trigger' | 'number' | 'pointer' | 'finished';
const whenKind = (w: When): WhenKind => (w.type === 'boolean' ? 'bool' : w.type === 'start' || w.type === 'trigger' || w.type === 'number' || w.type === 'pointer' || w.type === 'finished' ? w.type : 'start');

function RuleCard({ rule, doc, n }: { rule: Rule; doc: SceneDocument; n: number }) {
  const m = doc.machine;
  const bools = m.inputs.filter((i) => i.type === 'boolean'), triggers = m.inputs.filter((i) => i.type === 'trigger'), numbers = m.inputs.filter((i) => i.type === 'number');
  const setWhen = (when: When) => updateRule(rule.id, { when });
  const changeKind = (k: WhenKind) => {
    if (k === 'start') setWhen({ type: 'start' });
    else if (k === 'bool' && bools[0]) setWhen({ type: 'boolean', inputId: bools[0].id, value: true });
    else if (k === 'trigger' && triggers[0]) setWhen({ type: 'trigger', inputId: triggers[0].id });
    else if (k === 'number' && numbers[0]) setWhen({ type: 'number', inputId: numbers[0].id, op: '>=', value: numbers[0].max ?? 100 });
    else if (k === 'pointer' && doc.layers[0]) setWhen({ type: 'pointer', event: 'click', layerId: doc.layers[doc.layers.length - 1].id });
    else if (k === 'finished' && m.animations[0]) setWhen({ type: 'finished', animationId: m.animations[0].id });
  };
  const w = rule.when;
  const setAction = (i: number, a: Action) => updateRule(rule.id, { do: rule.do.map((x, j) => (j === i ? a : x)) });
  return (
    <div className="rule" aria-label={`Rule ${n}`}>
      <div className="w">
        <span className="kw when">When</span>
        <select value={whenKind(w)} onChange={(e) => changeKind(e.target.value as WhenKind)} aria-label="When">
          <option value="start">it starts</option>
          <option value="pointer" disabled={!doc.layers.length}>someone interacts with a layer</option>
          <option value="bool" disabled={!bools.length}>a toggle changes</option>
          <option value="trigger" disabled={!triggers.length}>a button is pressed</option>
          <option value="number" disabled={!numbers.length}>a slider reaches a value</option>
          <option value="finished" disabled={!m.animations.length}>a move finishes</option>
        </select>
        <div className="grow" />
        <button className="icon-btn sm" aria-label={`Delete rule ${n}`} onClick={() => deleteRule(rule.id)}><Icon name="trash" size={12} /></button>
      </div>
      {w.type === 'pointer' && (
        <div className="w">
          <span>someone</span>
          <select value={w.event} onChange={(e) => setWhen({ ...w, event: e.target.value as any })} aria-label="Pointer event">
            <option value="click">clicks</option><option value="enter">hovers over</option><option value="leave">moves off</option><option value="down">presses on</option><option value="up">lets go of</option>
          </select>
          <LayerSelect doc={doc} value={w.layerId} onChange={(layerId) => setWhen({ ...w, layerId })} />
        </div>
      )}
      {w.type === 'boolean' && <div className="w"><InputSelect inputs={bools} value={w.inputId} onChange={(inputId) => setWhen({ ...w, inputId })} /><span>turns</span><select value={String(w.value)} onChange={(e) => setWhen({ ...w, value: e.target.value === 'true' })} aria-label="Turns"><option value="true">on</option><option value="false">off</option></select></div>}
      {w.type === 'trigger' && <div className="w"><InputSelect inputs={triggers} value={w.inputId} onChange={(inputId) => setWhen({ ...w, inputId })} /><span>is pressed</span></div>}
      {w.type === 'number' && <div className="w"><InputSelect inputs={numbers} value={w.inputId} onChange={(inputId) => setWhen({ ...w, inputId })} /><OpSelect value={w.op} onChange={(op) => setWhen({ ...w, op })} /><input className="inl" type="number" value={w.value} onChange={(e) => setWhen({ ...w, value: Number(e.target.value) })} aria-label="Value" /></div>}
      {w.type === 'finished' && <div className="w"><AnimSelect doc={doc} value={w.animationId} onChange={(animationId) => setWhen({ ...w, animationId })} /><span>finishes</span></div>}

      {rule.only.map((c, i) => (
        <div key={i} className="w">
          <span className="kw if">Only if</span>
          <ConditionEditor doc={doc} c={c} onChange={(nc) => updateRule(rule.id, { only: rule.only.map((x, j) => (j === i ? nc : x)) })} />
          <button className="icon-btn sm" aria-label="Remove condition" onClick={() => updateRule(rule.id, { only: rule.only.filter((_, j) => j !== i) })}><Icon name="x" size={11} /></button>
        </div>
      ))}

      {rule.do.map((a, i) => (
        <div key={i} className="w">
          <span className="kw then">{i === 0 ? 'Then' : 'And'}</span>
          <ActionEditor doc={doc} a={a} onChange={(na) => setAction(i, na)} />
          {rule.do.length > 1 && <button className="icon-btn sm" aria-label="Remove action" onClick={() => updateRule(rule.id, { do: rule.do.filter((_, j) => j !== i) })}><Icon name="x" size={11} /></button>}
        </div>
      ))}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm ghost" onClick={() => updateRule(rule.id, { do: [...rule.do, rule.do[rule.do.length - 1]] })}><Icon name="plus" size={11} />Also do</button>
        <button className="btn sm ghost" disabled={!bools.length && !numbers.length} onClick={() => updateRule(rule.id, { only: [...rule.only, bools[0] ? { type: 'boolean', inputId: bools[0].id, value: true } : { type: 'number', inputId: numbers[0].id, op: '>', value: 0 }] })}><Icon name="plus" size={11} />Only if…</button>
      </div>
    </div>
  );
}

function ConditionEditor({ doc, c, onChange }: { doc: SceneDocument; c: Condition; onChange: (c: Condition) => void }) {
  const inputs = doc.machine.inputs.filter((i) => i.type === 'boolean' || i.type === 'number');
  const pick = (id: string) => { const i = inputs.find((x) => x.id === id)!; onChange(i.type === 'boolean' ? { type: 'boolean', inputId: id, value: true } : { type: 'number', inputId: id, op: '>', value: 0 }); };
  return <>
    <InputSelect inputs={inputs} value={c.inputId} onChange={pick} />
    {c.type === 'boolean'
      ? <><span>is</span><select value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value === 'true' })} aria-label="Is"><option value="true">on</option><option value="false">off</option></select></>
      : <><OpSelect value={c.op} onChange={(op) => onChange({ ...c, op })} /><input className="inl" type="number" value={c.value} onChange={(e) => onChange({ ...c, value: Number(e.target.value) })} aria-label="Value" /></>}
  </>;
}

type ActKind = 'play' | 'reverse' | 'stop' | 'toggle' | 'press' | 'number';
function ActionEditor({ doc, a, onChange }: { doc: SceneDocument; a: Action; onChange: (a: Action) => void }) {
  const m = doc.machine;
  const bools = m.inputs.filter((i) => i.type === 'boolean'), triggers = m.inputs.filter((i) => i.type === 'trigger'), numbers = m.inputs.filter((i) => i.type === 'number');
  const kind: ActKind = a.type === 'play' ? (a.direction === 'reverse' ? 'reverse' : 'play') : a.type === 'stop' ? 'stop' : a.type === 'setBoolean' ? 'toggle' : a.type === 'fire' ? 'press' : 'number';
  const anim0 = m.animations[0]?.id ?? '';
  const change = (k: ActKind) => {
    const animationId = 'animationId' in a ? a.animationId : anim0;
    if (k === 'play') onChange({ type: 'play', animationId, direction: 'forward', from: 'start' });
    else if (k === 'reverse') onChange({ type: 'play', animationId, direction: 'reverse', from: 'current' });
    else if (k === 'stop') onChange({ type: 'stop', animationId });
    else if (k === 'toggle' && bools[0]) onChange({ type: 'setBoolean', inputId: bools[0].id, value: 'toggle' });
    else if (k === 'press' && triggers[0]) onChange({ type: 'fire', inputId: triggers[0].id });
    else if (k === 'number' && numbers[0]) onChange({ type: 'setNumber', inputId: numbers[0].id, mode: 'set', value: 0 });
  };
  return <>
    <select value={kind} onChange={(e) => change(e.target.value as ActKind)} aria-label="Do">
      <option value="play" disabled={!m.animations.length}>play</option>
      <option value="reverse" disabled={!m.animations.length}>play backwards</option>
      <option value="stop" disabled={!m.animations.length}>stop</option>
      <option value="toggle" disabled={!bools.length}>change toggle</option>
      <option value="press" disabled={!triggers.length}>press button</option>
      <option value="number" disabled={!numbers.length}>change slider</option>
    </select>
    {(a.type === 'play' || a.type === 'stop') && <AnimSelect doc={doc} value={a.animationId} onChange={(animationId) => onChange({ ...a, animationId })} />}
    {a.type === 'play' && <select value={a.from} onChange={(e) => onChange({ ...a, from: e.target.value as any })} aria-label="From"><option value="start">from the {a.direction === 'reverse' ? 'end' : 'start'}</option><option value="current">from where it is</option></select>}
    {a.type === 'setBoolean' && <><InputSelect inputs={bools} value={a.inputId} onChange={(inputId) => onChange({ ...a, inputId })} /><select value={a.value} onChange={(e) => onChange({ ...a, value: e.target.value as any })} aria-label="To"><option value="toggle">flip it</option><option value="on">to on</option><option value="off">to off</option></select></>}
    {a.type === 'fire' && <InputSelect inputs={triggers} value={a.inputId} onChange={(inputId) => onChange({ ...a, inputId })} />}
    {a.type === 'setNumber' && <><InputSelect inputs={numbers} value={a.inputId} onChange={(inputId) => onChange({ ...a, inputId })} /><select value={a.mode} onChange={(e) => onChange({ ...a, mode: e.target.value as any })} aria-label="How"><option value="set">to</option><option value="add">by adding</option></select><input className="inl" type="number" value={a.value} onChange={(e) => onChange({ ...a, value: Number(e.target.value) })} aria-label="Amount" /></>}
  </>;
}

const OpSelect = ({ value, onChange }: { value: string; onChange: (v: any) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Comparison"><option value=">=">reaches</option><option value=">">goes above</option><option value="<">goes below</option><option value="<=">is at most</option><option value="=">equals</option></select>
);
const InputSelect = ({ inputs, value, onChange }: { inputs: Input[]; value: string; onChange: (v: string) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Control">{inputs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
);
const AnimSelect = ({ doc, value, onChange }: { doc: SceneDocument; value: string; onChange: (v: string) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Move">{doc.machine.animations.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
);
const LayerSelect = ({ doc, value, onChange }: { doc: SceneDocument; value: string; onChange: (v: string) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Layer">{[...doc.layers].reverse().filter((l) => l.type !== 'group').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
);

/** Recipes write ordinary rules (and a toggle when needed) that stay editable afterwards. */
function RecipeDialog({ kind, doc, onClose }: { kind: 'toggle' | 'hover' | 'press'; doc: SceneDocument; onClose: () => void }) {
  const layers = [...doc.layers].reverse().filter((l) => l.type !== 'group');
  const [layerId, setLayerId] = useState(layers[0]?.id ?? '');
  const [animId, setAnimId] = useState(doc.machine.animations[0]?.id ?? '');
  const ready = layerId && animId;
  const title = { toggle: 'Click to toggle', hover: 'Hover effect', press: 'Press to play' }[kind];
  const apply = () => {
    const play = (direction: 'forward' | 'reverse', from: 'start' | 'current'): Action => ({ type: 'play', animationId: animId, direction, from });
    const layerName = doc.layers.find((l) => l.id === layerId)?.name ?? 'Layer';
    // A repeating move can't "play back to the start", so turning it off stops it instead.
    const repeats = doc.machine.animations.find((a) => a.id === animId)?.loop !== 'once';
    const undoIt: Action = repeats ? { type: 'stop', animationId: animId } : play('reverse', 'current');
    if (kind === 'toggle') {
      const input: Input = { id: uid('in'), name: `${layerName} on`.slice(0, 40), type: 'boolean', default: false };
      commit((d) => ({ ...d, machine: { ...d.machine, inputs: [...d.machine.inputs, input], rules: [...d.machine.rules,
        { id: uid('ru'), when: { type: 'pointer', event: 'click', layerId }, only: [], do: [{ type: 'setBoolean', inputId: input.id, value: 'toggle' }] },
        { id: uid('ru'), when: { type: 'boolean', inputId: input.id, value: true }, only: [], do: [play('forward', 'current')] },
        { id: uid('ru'), when: { type: 'boolean', inputId: input.id, value: false }, only: [], do: [undoIt] },
      ] } }));
    } else if (kind === 'hover') {
      addRule({ when: { type: 'pointer', event: 'enter', layerId }, only: [], do: [play('forward', 'current')] });
      addRule({ when: { type: 'pointer', event: 'leave', layerId }, only: [], do: [undoIt] });
    } else addRule({ when: { type: 'pointer', event: 'click', layerId }, only: [], do: [play('forward', 'start')] });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={title} subtitle="Pick what people interact with and which move it plays. You can edit the rules afterwards."
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ready} onClick={apply}>Add</button></>}>
      {!doc.machine.animations.length ? <div className="empty-hint">You need a move first. Go to <b>Animate</b>, select a layer and pick a one-click move.</div> : (
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 4 }}><span className="label">{kind === 'hover' ? 'When the pointer is over' : 'When someone clicks'}</span>
            <select className="input" value={layerId} onChange={(e) => setLayerId(e.target.value)}>{layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="col" style={{ gap: 4 }}><span className="label">Play this move</span>
            <select className="input" value={animId} onChange={(e) => setAnimId(e.target.value)}>{doc.machine.animations.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <div className="empty-hint">{kind === 'toggle' ? 'Adds a toggle control and three rules: click flips it; on plays the move; off plays it backwards (or stops it, if it repeats).' : kind === 'hover' ? 'Adds two rules: hover plays the move; moving off plays it backwards (or stops it, if it repeats).' : 'Adds one rule: a click plays the move from the start.'}</div>
        </div>
      )}
    </Modal>
  );
}
