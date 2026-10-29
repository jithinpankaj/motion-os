import { useEffect, useMemo, useRef, useState } from 'react';
import type { Condition, ConditionGroup, LeafCondition, SceneDocument } from '../../../../shared/scene/schema';
import { COMPARE_OPS, EVENT_FIELDS } from '../../../../shared/scene/schema';
import { conditionToExpression, describeCondition, expressionSuggestions, opSymbol, parseExpression } from '../../../../shared/motion/logic';
import { Icon } from '../../../ui/Icon';
import { insertCond, leafFor, moveCond, newLeaf, readDrag, setCond, startDrag, type CondPath } from './tree';

/**
 * The visual condition editor: groups of conditions ("all / any / none of these"), nested as deep as
 * needed, written as readable sentences. Conditions drag between groups and positions; an optional
 * text mode writes the same thing as an expression with autocomplete and live validation.
 */
export function ConditionTree({ doc, group, onChange, treeId, live, allowText = true }: { doc: SceneDocument; group: ConditionGroup; onChange: (g: ConditionGroup) => void; treeId: string; live?: (c: Condition) => boolean | null; allowText?: boolean }) {
  const [text, setText] = useState(false);
  return (
    <div className="cond-tree">
      {allowText && (
        <div className="row between" style={{ gap: 6 }}>
          <span className="faint" style={{ fontSize: 11.5 }}>{text ? 'Write it as text. Names in [brackets] if they have spaces' : 'Drag conditions to reorder them or move them into groups'}</span>
          <button className="btn sm ghost" onClick={() => setText(!text)} aria-pressed={text} title="Switch between the visual editor and a text expression"><Icon name="code" size={11} />{text ? 'Visual' : 'Text'}</button>
        </div>
      )}
      {text ? <ExpressionEditor doc={doc} group={group} onChange={onChange} />
        : <GroupBox doc={doc} root={group} path={[]} onChange={onChange} treeId={treeId} live={live} />}
    </div>
  );
}

const OP_LABEL = { all: 'All of these', any: 'Any one of these', none: 'None of these' } as const;

function GroupBox({ doc, root, path, onChange, treeId, live }: { doc: SceneDocument; root: ConditionGroup; path: CondPath; onChange: (g: ConditionGroup) => void; treeId: string; live?: (c: Condition) => boolean | null }) {
  const g = (path.length ? path.reduce<Condition>((c, i) => (c as ConditionGroup).items[i], root) : root) as ConditionGroup;
  const [over, setOver] = useState<number | null>(null);
  const drop = (e: React.DragEvent, index: number) => {
    e.preventDefault(); e.stopPropagation(); setOver(null);
    const d = readDrag(e);
    if (!d) return;
    if (d.kind === 'cond' && (d as any).tree === treeId) onChange(moveCond(root, d.path, path, index));
    else if (d.kind === 'newCond') onChange(insertCond(root, path, index, d.group ? { type: 'group', op: 'any', items: [newLeaf(doc)] } : newLeaf(doc)));
  };
  const zone = (index: number) => (
    <div className={`drop-line ${over === index ? 'on' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(index); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, index)} />
  );
  const state = live?.(g);
  return (
    <div className={`cond-group ${path.length ? 'nested' : ''} ${state === true ? 'pass' : state === false ? 'fail' : ''}`}>
      <div className="cond-group-h">
        {path.length > 0 && <span className="grip" draggable onDragStart={(e) => startDrag(e, { kind: 'cond', path, tree: treeId } as any)} title="Drag to move this group"><Icon name="drag" size={12} /></span>}
        <select value={g.op} onChange={(e) => onChange(setCond(root, path, { ...g, op: e.target.value as ConditionGroup['op'] }))} aria-label="How the conditions combine">
          {(['all', 'any', 'none'] as const).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
        </select>
        {path.length > 0 && <button className="icon-btn sm" aria-label="Remove group" onClick={() => onChange(setCond(root, path, null))}><Icon name="x" size={11} /></button>}
      </div>
      {zone(0)}
      {g.items.map((c, i) => (
        <div key={i}>
          {c.type === 'group'
            ? <GroupBox doc={doc} root={root} path={[...path, i]} onChange={onChange} treeId={treeId} live={live} />
            : (
              <div className={`cond-row ${live?.(c) === true ? 'pass' : live?.(c) === false ? 'fail' : ''}`}>
                <span className="grip" draggable onDragStart={(e) => startDrag(e, { kind: 'cond', path: [...path, i], tree: treeId } as any)} title="Drag to reorder or move into a group"><Icon name="drag" size={12} /></span>
                <LeafEditor doc={doc} c={c} onChange={(nc) => onChange(setCond(root, [...path, i], nc))} />
                <button className="icon-btn sm" aria-label={`Remove condition: ${describeCondition(c, doc)}`} onClick={() => onChange(setCond(root, [...path, i], null))}><Icon name="x" size={11} /></button>
              </div>
            )}
          {zone(i + 1)}
        </div>
      ))}
      {!g.items.length && <div className="empty-hint" style={{ padding: '2px 4px' }}>{path.length ? 'Empty group. Add a condition or drag one here.' : 'No conditions: it always runs.'}</div>}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm ghost" onClick={() => onChange(insertCond(root, path, g.items.length, newLeaf(doc)))}><Icon name="plus" size={11} />Add condition</button>
        <button className="btn sm ghost" onClick={() => onChange(insertCond(root, path, g.items.length, { type: 'group', op: g.op === 'all' ? 'any' : 'all', items: [newLeaf(doc)] }))}><Icon name="group" size={11} />Add condition group</button>
      </div>
    </div>
  );
}

type Subject = string; // `var:<id>` | 'state' | `playing` | `event:<field>`
const subjectOf = (c: LeafCondition): Subject => ('inputId' in c ? `var:${c.inputId}` : c.type === 'state' ? 'state' : c.type === 'playing' ? 'playing' : `event:${c.field}`);

/** One condition as a sentence: [subject] [comparison] [value]. */
export function LeafEditor({ doc, c, onChange }: { doc: SceneDocument; c: LeafCondition; onChange: (c: LeafCondition) => void }) {
  const m = doc.machine;
  const vars = m.inputs.filter((i) => i.type !== 'trigger');
  const pickSubject = (s: Subject) => {
    if (s.startsWith('var:')) onChange(leafFor(s.slice(4), doc));
    else if (s === 'state' && m.states?.[0]) onChange({ type: 'state', stateId: m.states[0].id, is: true });
    else if (s === 'playing' && m.animations[0]) onChange({ type: 'playing', animationId: m.animations[0].id, is: true });
    else if (s.startsWith('event:')) { const f = s.slice(6) as (typeof EVENT_FIELDS)[number]; onChange({ type: 'event', field: f, op: f === 'x' || f === 'y' ? '>' : 'is', value: f === 'key' ? 'Enter' : f === 'x' || f === 'y' ? 0 : '' }); }
  };
  const v = 'inputId' in c ? m.inputs.find((i) => i.id === c.inputId) : undefined;
  const cmpSelect = (op: string, set: (op: any) => void, extra?: React.ReactNode) => (
    <select value={op} onChange={(e) => set(e.target.value)} aria-label="Comparison">{COMPARE_OPS.map((o) => <option key={o} value={o}>{opSymbol(o)}</option>)}{extra}</select>
  );
  return (
    <span className="cond-words">
      <select value={subjectOf(c)} onChange={(e) => pickSubject(e.target.value)} aria-label="What to check">
        <optgroup label="Variables">{vars.map((i) => <option key={i.id} value={`var:${i.id}`}>{i.name}</option>)}</optgroup>
        <optgroup label="State machine">
          <option value="state" disabled={!m.states?.length}>Current state</option>
          <option value="playing" disabled={!m.animations.length}>A move is playing</option>
        </optgroup>
        <optgroup label="The triggering event">{(['key', 'name', 'value', 'x', 'y'] as const).map((f) => <option key={f} value={`event:${f}`}>Event {f}</option>)}</optgroup>
      </select>
      {c.type === 'boolean' && <><span>is</span><select value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value === 'true' })} aria-label="Is"><option value="true">on</option><option value="false">off</option></select></>}
      {(c.type === 'number' || c.type === 'range' || c.type === 'compare') && v && (
        <>
          <select value={c.type === 'range' ? 'between' : c.op} onChange={(e) => {
            const o = e.target.value;
            if (o === 'between') onChange({ type: 'range', inputId: v.id, min: v.min ?? 0, max: v.max ?? 10 });
            else onChange(c.type === 'compare' ? { ...c, op: o as any } : { type: 'number', inputId: v.id, op: o as any, value: c.type === 'number' ? c.value : 0 });
          }} aria-label="Comparison">
            {COMPARE_OPS.map((o) => <option key={o} value={o}>{opSymbol(o)}</option>)}
            {c.type !== 'compare' && <option value="between">between</option>}
          </select>
          {c.type === 'range'
            ? <><input className="inl" type="number" value={c.min} onChange={(e) => onChange({ ...c, min: Number(e.target.value) })} aria-label="From" /><span>and</span><input className="inl" type="number" value={c.max} onChange={(e) => onChange({ ...c, max: Number(e.target.value) })} aria-label="To" /></>
            : (
              <select value={c.type === 'compare' ? c.otherId : '__n'} onChange={(e) => onChange(e.target.value === '__n' ? { type: 'number', inputId: v.id, op: c.op, value: 0 } : { type: 'compare', inputId: v.id, op: c.op, otherId: e.target.value })} aria-label="Compare with">
                <option value="__n">a number</option>
                {m.inputs.filter((i) => i.type === 'number' && i.id !== v.id).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            )}
          {c.type === 'number' && <input className="inl" type="number" value={c.value} onChange={(e) => onChange({ ...c, value: Number(e.target.value) })} aria-label="Value" />}
        </>
      )}
      {c.type === 'text' && v && (
        <>
          <select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as any })} aria-label="Comparison">
            <option value="is">is</option><option value="isNot">is not</option>
            {v.type !== 'enum' && <><option value="contains">contains</option><option value="startsWith">starts with</option></>}
          </select>
          {v.type === 'enum' ? <select value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} aria-label="Value">{(v.options ?? []).map((o) => <option key={o}>{o}</option>)}</select>
            : v.type === 'color' ? <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.value) ? c.value : '#000000'} onChange={(e) => onChange({ ...c, value: e.target.value })} aria-label="Colour" />
            : <input className="inl" style={{ width: 90 }} value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} aria-label="Text" />}
        </>
      )}
      {c.type === 'vector' && <><select value={c.axis} onChange={(e) => onChange({ ...c, axis: e.target.value as 'x' })} aria-label="Axis"><option value="x">x</option><option value="y">y</option></select>{cmpSelect(c.op, (op) => onChange({ ...c, op }))}<input className="inl" type="number" value={c.value} onChange={(e) => onChange({ ...c, value: Number(e.target.value) })} aria-label="Value" /></>}
      {c.type === 'state' && <><select value={String(c.is)} onChange={(e) => onChange({ ...c, is: e.target.value === 'true' })} aria-label="Is"><option value="true">is</option><option value="false">is not</option></select><select value={c.stateId} onChange={(e) => onChange({ ...c, stateId: e.target.value })} aria-label="State">{(m.states ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></>}
      {c.type === 'playing' && <><select value={c.animationId} onChange={(e) => onChange({ ...c, animationId: e.target.value })} aria-label="Move">{m.animations.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select value={String(c.is)} onChange={(e) => onChange({ ...c, is: e.target.value === 'true' })} aria-label="Is"><option value="true">is playing</option><option value="false">is not playing</option></select></>}
      {c.type === 'event' && (
        <>
          <select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as any })} aria-label="Comparison">
            {(c.field === 'x' || c.field === 'y' || c.field === 'value' ? COMPARE_OPS : []).map((o) => <option key={o} value={o}>{opSymbol(o)}</option>)}
            {c.field !== 'x' && c.field !== 'y' && <><option value="is">is</option><option value="isNot">is not</option><option value="contains">contains</option><option value="startsWith">starts with</option></>}
          </select>
          <input className="inl" style={{ width: 80 }} value={String(c.value)} onChange={(e) => onChange({ ...c, value: c.field === 'x' || c.field === 'y' || (typeof c.value === 'number') ? Number(e.target.value) || 0 : e.target.value })} aria-label="Value" />
        </>
      )}
      {'inputId' in c && !v && <span className="bad">missing variable</span>}
    </span>
  );
}

/** The same conditions as a readable expression, validated as you type (never executed as code). */
function ExpressionEditor({ doc, group, onChange }: { doc: SceneDocument; group: ConditionGroup; onChange: (g: ConditionGroup) => void }) {
  const initial = useMemo(() => conditionToExpression(group, doc), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [src, setSrc] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const parsed = useMemo(() => parseExpression(src, doc), [src, doc]);
  // Save when the text changes to something valid — never in response to the save itself.
  const groupRef = useRef(group); groupRef.current = group;
  useEffect(() => {
    if (!parsed.ok || src === initial) return;
    if (JSON.stringify(parsed.group) !== JSON.stringify(groupRef.current)) onChange(parsed.group);
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  const word = /(\[[^\]]*|[A-Za-z_.][A-Za-z0-9_.]*)$/.exec(src.slice(0, caret))?.[0] ?? '';
  const sugg = word ? expressionSuggestions(word, doc).filter((x) => x !== word) : [];
  const accept = (s: string) => { const before = src.slice(0, caret - word.length), after = src.slice(caret); const next = `${before}${s} ${after.trimStart()}`; setSrc(next); setCaret(before.length + s.length + 1); };
  return (
    <div className="col" style={{ gap: 6 }}>
      <textarea className={`input mono expr ${parsed.ok ? '' : 'bad'}`} rows={3} value={src} spellCheck={false}
        onChange={(e) => { setSrc(e.target.value); setCaret(e.target.selectionStart); }} onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={(e) => { if (e.key === 'Tab' && sugg[0]) { e.preventDefault(); accept(sugg[0]); } }}
        aria-label="Conditions as an expression" placeholder='Coins >= 1 and not IsSpinning and (Mode is "hard" or event.key = "Enter")' />
      {sugg.length > 0 && <div className="row wrap" style={{ gap: 4 }}>{sugg.map((s) => <button key={s} className="chip" onMouseDown={(e) => { e.preventDefault(); accept(s); }}>{s}</button>)}<span className="faint" style={{ fontSize: 11 }}>Tab to accept</span></div>}
      {parsed.ok
        ? <div className="ok-line"><Icon name="check" size={11} />Valid: {parsed.group.items.length ? `${countLeaves(parsed.group)} condition${countLeaves(parsed.group) === 1 ? '' : 's'}` : 'no conditions, always runs'}</div>
        : <div className="err-line"><Icon name="alert" size={11} />{parsed.error}{src ? <span className="mono faint"> · at “{src.slice(parsed.at, parsed.at + 12) || 'the end'}”</span> : null}</div>}
      <div className="empty-hint">Use <b>and</b>, <b>or</b>, <b>not</b> and brackets. Compare with = ≠ &gt; &lt; ≥ ≤, <b>is</b>, <b>contains</b>, <b>starts with</b>, <b>in</b> 1..5. Also <b>state is</b> Hover, <b>[Move] is playing</b>, <b>event.key</b> = "Enter".</div>
    </div>
  );
}
const countLeaves = (c: Condition): number => (c.type === 'group' ? c.items.reduce((n, x) => n + countLeaves(x), 0) : 1);
