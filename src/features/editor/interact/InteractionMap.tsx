import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Action, Rule, SceneDocument, When } from '../../../../shared/scene/schema';
import type { MotionRuntime } from '../../../../shared/motion/runtime';
import { describeAction, forEachAction, opSymbol } from '../../../../shared/motion/logic';
import { Icon } from '../../../ui/Icon';
import { LAYER_DRAG } from '../LayersPanel';
import { selectRule } from '../store';
import type { InteractionDraft } from './Simple';

/**
 * The interaction map, drawn the way state machines are: every move (and every named state) is a
 * box, and every interaction is a labelled arrow into the box it plays. Arrows start at Entry (when
 * the file appears) or Any state (whenever their trigger happens). Drag a layer from Layers onto a
 * box to make that move play when people touch the layer. While previewing on the left, the boxes
 * that are playing light up.
 */
type Node = { key: string; label: string; kind: 'state' | 'anim' | 'act'; animId?: string; loop?: string };
type Edge = { rule: Rule; n: number; from: string; to: string; label: string };

const POINTER: Record<string, string> = { click: 'click', enter: 'hover', leave: 'hover off', down: 'press', up: 'release' };
function edgeLabel(w: When, doc: SceneDocument): string {
  const name = (id?: string) => (id ? doc.layers.find((l) => l.id === id)?.name ?? '?' : 'anywhere');
  const v = (id: string) => doc.machine.inputs.find((i) => i.id === id)?.name ?? '?';
  switch (w.type) {
    case 'pointer': return `${POINTER[w.event] ?? w.event} · ${name(w.layerId)}`;
    case 'number': return `${v(w.inputId)} ${opSymbol(w.op)} ${w.value}`;
    case 'boolean': return `${v(w.inputId)} ${w.value ? 'on' : 'off'}`;
    case 'trigger': return `${v(w.inputId)} pressed`;
    case 'changed': return `${v(w.inputId)} changes`;
    case 'key': return `key ${w.key === ' ' ? 'Space' : w.key}`;
    case 'finished': return `${doc.machine.animations.find((a) => a.id === w.animationId)?.name ?? 'a move'} ends`;
    case 'stateEnter': return `becomes ${doc.machine.states?.find((s) => s.id === w.stateId)?.name ?? '?'}`;
    case 'event': return `“${w.name}” arrives`;
    case 'start': return 'starts';
  }
}
const firstPlay = (actions: Action[]) => { let id: string | undefined; forEachAction(actions, (a) => { if (!id && a.type === 'play') id = a.animationId; }); return id; };
const firstLeaf = (actions: Action[]) => { let x: Action | undefined; forEachAction(actions, (a) => { if (!x && a.type !== 'parallel' && a.type !== 'branch' && a.type !== 'wait' && a.type !== 'waitFor') x = a; }); return x; };

const NODE_H = 40, GAP = 12, TOP = 16, LEFT_W = 116;

export function InteractionMap({ doc, runtime, onDraft }: { doc: SceneDocument; runtime: MotionRuntime | null; onDraft: (d: InteractionDraft) => void }) {
  const m = doc.machine;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { const w = Math.round(el.getBoundingClientRect().width); setWidth((p) => (p === w ? p : w)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [
      ...(m.states ?? []).map((s) => ({ key: `state:${s.id}`, label: s.name, kind: 'state' as const })),
      ...m.animations.map((a) => ({ key: `anim:${a.id}`, label: a.name, kind: 'anim' as const, animId: a.id, loop: a.loop })),
    ];
    const edges: Edge[] = m.rules.map((r, i) => {
      const play = firstPlay(r.do);
      let to = r.to ? `state:${r.to}` : play ? `anim:${play}` : `act:${r.id}`;
      if (to.startsWith('act:')) { const a = firstLeaf(r.do); nodes.push({ key: to, label: a ? describeAction(a, doc) : 'Does nothing yet', kind: 'act' }); }
      if (!nodes.some((n) => n.key === to)) to = `act:${r.id}`;
      const from = r.when.type === 'start' ? 'entry' : r.from ? `state:${r.from}` : 'any';
      return { rule: r, n: i + 1, from, to, label: edgeLabel(r.when, doc) };
    });
    return { nodes, edges };
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geometry. States (when the file has any) sit in a row at the top, like a state machine: forward
  // transitions arc above the row, backward ones below. Moves stack in a column underneath, fed by
  // arrows from Entry (on start) and Any state (whenever their trigger happens).
  const states = nodes.filter((n) => n.kind === 'state').sort((x, y) => (x.key === `state:${m.initialState}` ? -1 : y.key === `state:${m.initialState}` ? 1 : 0));
  const column = nodes.filter((n) => n.kind !== 'state');
  const ROW_Y = states.length ? TOP + 52 : 0;
  const stateGap = 72;
  const stateW = states.length ? Math.max(96, Math.min(170, (width - 32 - LEFT_W - 40 - stateGap * (states.length - 1)) / states.length)) : 0;
  const sx = (i: number) => 16 + LEFT_W + 40 + i * (stateW + stateGap);
  const sIndex = new Map(states.map((n, i) => [n.key, i]));
  const colTop = states.length ? ROW_Y + NODE_H + 74 : TOP;
  const x0 = Math.max(LEFT_W + 120, Math.round(width * 0.5));
  const nodeW = Math.max(130, Math.min(260, width - x0 - 16));
  const yOf = new Map(column.map((n, i) => [n.key, colTop + i * (NODE_H + GAP) + NODE_H / 2]));
  const height = Math.max(colTop + column.length * (NODE_H + GAP) - GAP + TOP, 150);
  const entryY = states.length ? ROW_Y + NODE_H / 2 : TOP + NODE_H / 2;
  const left = { entry: entryY, any: Math.max(colTop + NODE_H / 2 + (states.length ? 0 : 64), (colTop + height) / 2) };
  const anchor = (key: string) => (key === 'entry' || key === 'any' ? { x: 16 + LEFT_W, y: left[key] } : { x: x0 + nodeW, y: yOf.get(key) ?? 0 });
  const perTarget = new Map<string, number>();
  const perPair = new Map<string, number>();
  const playing = (n: Node) => (n.animId && runtime ? runtime.isPlaying(n.animId) : n.kind === 'state' && runtime ? runtime.state === n.key.slice(6) : false);
  const inRow = (e: Edge) => sIndex.has(e.to);
  const rowArc = (e: Edge) => {
    const j = sIndex.get(e.to)!, i = e.from.startsWith('state:') ? sIndex.get(e.from) : undefined;
    const xj = sx(j) + stateW / 2;
    if (i === undefined) return { d: `M${16 + LEFT_W},${ROW_Y + NODE_H / 2} L${sx(j) - 2},${ROW_Y + NODE_H / 2}`, lx: (16 + LEFT_W + sx(j)) / 2, ly: ROW_Y + NODE_H / 2 - 14, side: 'mid' };
    const xi = sx(i) + stateW / 2, fwd = j > i, span = Math.abs(j - i);
    const y = fwd ? ROW_Y : ROW_Y + NODE_H, lift = (fwd ? -1 : 1) * (22 + (span - 1) * 14);
    return { d: `M${xi + (fwd ? 10 : -10)},${y} C${xi},${y + lift * 1.6} ${xj},${y + lift * 1.6} ${xj + (fwd ? -10 : 10)},${y + (fwd ? -2 : 2)}`, lx: (xi + xj) / 2, ly: y + lift * 1.25, side: fwd ? 'up' : 'down' };
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(LAYER_DRAG)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'link';
    setDragging(true);
    setOver((e.target as HTMLElement).closest<HTMLElement>('[data-node]')?.dataset.node ?? 'map');
  };
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(LAYER_DRAG);
    const node = (e.target as HTMLElement).closest<HTMLElement>('[data-node]')?.dataset.node;
    setOver(null); setDragging(false);
    if (!id) return;
    e.preventDefault();
    onDraft({ target: id, play: node?.startsWith('anim:') ? node.slice(5) : undefined });
  };

  return (
    <div className="imap-wrap">
      <div className="imap-help"><Icon name="drag" size={13} /><span><b>Drag a layer</b> from Layers onto a move to make it play when people touch that layer. Arrows show what starts each move; click one to edit it.</span></div>
      <div ref={box} className={`imap${dragging ? ' dragging' : ''}${over === 'map' ? ' over' : ''}`} style={{ height }} onDragOver={onDragOver} onDragLeave={(e) => { if (!box.current?.contains(e.relatedTarget as globalThis.Node)) { setOver(null); setDragging(false); } }} onDrop={onDrop}
        role="group" aria-label="Interaction map">
        {width > 0 && <>
          <svg className="imap-svg" width={width} height={height} aria-hidden>
            <defs><marker id="imap-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" /></marker></defs>
            {states.length > 0 && m.initialState && sIndex.has(`state:${m.initialState}`) && <path className="imap-edge entry" d={`M${16 + LEFT_W},${ROW_Y + NODE_H / 2} L${sx(sIndex.get(`state:${m.initialState}`)!) - 2},${ROW_Y + NODE_H / 2}`} markerEnd="url(#imap-arrow)" />}
            {edges.map((e) => {
              if (inRow(e)) return <path key={e.rule.id} className="imap-edge row" d={rowArc(e).d} markerEnd="url(#imap-arrow)" />;
              const a = anchor(e.from), toY = yOf.get(e.to) ?? 0;
              const start = e.from === 'entry' && states.length ? { x: 16 + LEFT_W / 2, y: ROW_Y + NODE_H } : a;
              const mid = (start.x + x0) / 2;
              return <path key={e.rule.id} className="imap-edge" d={`M${start.x},${start.y} C${start.x === a.x ? mid : start.x},${start.x === a.x ? start.y : toY} ${mid},${toY} ${x0 - 2},${toY}`} markerEnd="url(#imap-arrow)" />;
            })}
          </svg>
          {(['entry', 'any'] as const).map((k) => (
            <div key={k} className={`imap-src ${k}`} style={{ left: 16, top: left[k] - NODE_H / 2, width: LEFT_W, height: NODE_H }} hidden={k === 'any' && !edges.some((e) => e.from === 'any') && !column.length}>
              <Icon name={k === 'entry' ? 'play' : 'crosshair'} size={12} />{k === 'entry' ? 'Entry' : 'Any state'}
            </div>
          ))}
          {edges.filter(inRow).map((e) => {
            const arc = rowArc(e), key = `${e.from}>${e.to}`, k = perPair.get(key) ?? 0;
            perPair.set(key, k + 1);
            return (
              <button key={e.rule.id} className={`imap-label mid${e.rule.enabled === false ? ' off' : ''}`} style={{ left: arc.lx, top: arc.ly + (arc.side === 'down' ? 1 : -1) * k * 21, maxWidth: stateW + stateGap - 8 }} onClick={() => selectRule(e.rule.id)} title={`Interaction ${e.n}: ${e.label}`}>
                <span className="imap-n">{e.n}</span><span className="ellipsis">{e.label}</span>
              </button>
            );
          })}
          {[...states.map((n, i) => ({ n, x: sx(i), y: ROW_Y, w: stateW })), ...column.map((n) => ({ n, x: x0, y: (yOf.get(n.key) ?? 0) - NODE_H / 2, w: nodeW }))].map(({ n, x, y, w }) => (
            <div key={n.key} data-node={n.key} className={`imap-node ${n.kind}${playing(n) ? ' live' : ''}${over === n.key ? ' over' : ''}`} style={{ left: x, top: y, width: w, height: NODE_H }}
              title={n.kind === 'anim' ? 'Drop a layer here to play this move when people touch it' : n.kind === 'state' ? `State${m.initialState === n.key.slice(6) ? ' (starts here)' : ''}` : undefined}>
              <Icon name={n.kind === 'state' ? 'layers' : n.kind === 'anim' ? 'film' : 'sparkles'} size={13} />
              <span className="ellipsis">{n.label}</span>
              {n.loop && n.loop !== 'once' && <span className="imap-tag">{n.loop === 'loop' ? 'loops' : 'back & forth'}</span>}
              {n.kind === 'anim' && <button className="imap-add" aria-label={`Make something play ${n.label}`} title="Make something play this" onClick={() => onDraft({ play: n.animId })}><Icon name="plus" size={11} /></button>}
            </div>
          ))}
          {edges.filter((e) => !inRow(e)).map((e) => {
            const k = perTarget.get(e.to) ?? 0; perTarget.set(e.to, k + 1);
            const count = edges.filter((x) => x.to === e.to && !inRow(x)).length;
            const y = (yOf.get(e.to) ?? 0) + (k - (count - 1) / 2) * 22;
            return (
              <button key={e.rule.id} className={`imap-label${e.rule.enabled === false ? ' off' : ''}`} style={{ left: x0 - 10, top: y, maxWidth: x0 - LEFT_W - 40 }} onClick={() => selectRule(e.rule.id)} title={`Interaction ${e.n}: ${e.label}`}>
                <span className="imap-n">{e.n}</span><span className="ellipsis">{e.label}</span>
              </button>
            );
          })}
          {!nodes.length && <div className="imap-empty">Make a move in <b>Animate</b> first. Each move appears here as a box you can drop layers onto.</div>}
        </>}
      </div>
    </div>
  );
}
