import { useEffect, useRef, useState } from 'react';
import { useTouchDevice } from '../../lib/device';
import type { DrawingProps, Layer, SceneDocument, Stroke } from '../../../shared/scene/schema';
import { createLayer, defaultDrawing } from '../../../shared/scene/defaults';
import { paintStrokes, strokesBounds } from '../../engine/strokes';
import { Tip } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { setLayout, useLayout } from './layout';
import { commit, endCoalesce, select, undo, useEditor } from './store';

/**
 * Draw mode: sketch straight onto the canvas with a mouse, a finger or a pencil (pressure-sensitive
 * on iPad). Every stroke is one undoable step and goes into a drawing layer; that layer then moves,
 * reacts and replays like anything else. Draw each part you want to move separately as its own
 * drawing ("New drawing").
 */
type Brush = 'pen' | 'pencil' | 'brush' | 'marker' | 'highlighter' | 'eraser';
const BRUSHES: { key: Brush; label: string; icon: string; kbd?: string }[] = [
  { key: 'pen', label: 'Pen', icon: 'pen' },
  { key: 'pencil', label: 'Pencil', icon: 'pencil' },
  { key: 'brush', label: 'Brush', icon: 'brush' },
  { key: 'marker', label: 'Marker', icon: 'marker' },
  { key: 'highlighter', label: 'Highlighter', icon: 'highlighter' },
  { key: 'eraser', label: 'Eraser', icon: 'eraser', kbd: 'E' },
];
const COLORS = ['#1d1d1f', '#ffffff', '#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#0090ff', '#8e4ec6'];

type DrawLayer = Extract<Layer, { type: 'drawing' }>;
const drawingOf = (doc: SceneDocument | null, id: string | null) => (id ? (doc?.layers.find((l) => l.id === id && l.type === 'drawing') as DrawLayer | undefined) : undefined);

/** Scene pixels ↔ the drawing box's own pixels (undoing its position, turn and scale). */
function toLocal(l: DrawLayer, doc: SceneDocument, x: number, y: number) {
  const t = l.transform, W = doc.canvas.width, H = doc.canvas.height, r = (-t.rotation * Math.PI) / 180;
  const dx = x - t.x * W, dy = y - t.y * H;
  const rx = dx * Math.cos(r) - dy * Math.sin(r), ry = dx * Math.sin(r) + dy * Math.cos(r);
  return { x: rx / (t.scale * t.scaleX) + l.props.width / 2, y: ry / (t.scale * t.scaleY) + l.props.height / 2, k: t.scale * Math.sqrt(t.scaleX * t.scaleY) };
}

/** Start drawing: into an existing drawing (opened up so new strokes aren't clipped), or a new one. */
export function startDrawing(layerId: string | null = null) {
  const st = useEditor.getState();
  if (st.mode !== 'design') useEditor.setState({ mode: 'design', playing: false });
  const doc = st.doc, l = drawingOf(doc, layerId);
  if (l && doc && !l.parentId) {
    // Pad the box evenly on every side: the centre stays put, so nothing on screen moves.
    const W = doc.canvas.width, H = doc.canvas.height;
    commit((d) => ({ ...d, layers: d.layers.map((x) => (x.id === l.id && x.type === 'drawing' ? { ...x, props: { ...x.props, width: x.props.width + 2 * W, height: x.props.height + 2 * H, strokes: x.props.strokes.map((s) => ({ ...s, points: s.points.map((v, i) => (i % 3 === 0 ? v + W : i % 3 === 1 ? v + H : v)) })) } } : x)) }));
    setLayout({ drawing: true, drawLayer: l.id });
  } else setLayout({ drawing: true, drawLayer: null });
  select(null);
}

/** Finish: trim the drawing's box to its strokes (keeping it where it is) and select it. */
export function finishDrawing() {
  const { drawLayer } = useLayout.getState();
  setLayout({ drawing: false, drawLayer: null });
  const doc = useEditor.getState().doc, l = drawingOf(doc, drawLayer);
  if (!l || !doc) return;
  if (!l.props.strokes.length) { commit((d) => ({ ...d, layers: d.layers.filter((x) => x.id !== l.id) })); return; }
  const b = strokesBounds(l.props.strokes, l.props.thickness)!;
  const t = l.transform, W = doc.canvas.width, H = doc.canvas.height, r = (t.rotation * Math.PI) / 180;
  const lx = (b.x + b.w / 2 - l.props.width / 2) * t.scale * t.scaleX, ly = (b.y + b.h / 2 - l.props.height / 2) * t.scale * t.scaleY;
  const ox = lx * Math.cos(r) - ly * Math.sin(r), oy = lx * Math.sin(r) + ly * Math.cos(r);
  commit((d) => ({ ...d, layers: d.layers.map((x) => (x.id === l.id && x.type === 'drawing' ? {
    ...x,
    transform: { ...x.transform, x: +(x.transform.x + ox / W).toFixed(5), y: +(x.transform.y + oy / H).toFixed(5) },
    props: { ...x.props, width: Math.max(1, +b.w.toFixed(1)), height: Math.max(1, +b.h.toFixed(1)), strokes: x.props.strokes.map((s) => ({ ...s, points: s.points.map((v, i) => +(i % 3 === 0 ? v - b.x : i % 3 === 1 ? v - b.y : v).toFixed(i % 3 === 2 ? 2 : 1)) })) },
  } : x)) }));
  select(l.id);
}

/** The transparent surface over the artboard that turns pointer movement into strokes. */
export function DrawSurface({ doc }: { doc: SceneDocument }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ id: number; points: number[]; erase: string | null } | null>(null);
  const penSeen = useRef(false);
  const W = doc.canvas.width, H = doc.canvas.height;

  const scenePoint = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, px: r.width / W };
  };
  const repaint = () => {
    const c = canvas.current, s = live.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    if (!s || s.erase !== null || !s.points.length) return;
    const { brush, brushSize, brushColor } = useLayout.getState();
    paintStrokes(g, [{ brush: brush as Stroke['brush'], color: brushColor, size: brushSize, points: s.points }], { scale: c.width / W });
  };
  // Keep the overlay's pixels matched to its size on screen.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(() => { const r = c.getBoundingClientRect(); c.width = Math.round(r.width * devicePixelRatio); c.height = Math.round(r.height * devicePixelRatio); repaint(); });
    ro.observe(c);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const erase = (x: number, y: number, key: string) => {
    const { drawLayer, brushSize } = useLayout.getState();
    const st = useEditor.getState(), l = drawingOf(st.doc, drawLayer);
    if (!l || !st.doc) return;
    const p = toLocal(l, st.doc, x, y), r = (brushSize * 1.5) / p.k;
    const keep = l.props.strokes.filter((s) => {
      const reach = r + (s.size * l.props.thickness) / 2;
      for (let i = 0; i < s.points.length; i += 3) if (Math.hypot(s.points[i] - p.x, s.points[i + 1] - p.y) < reach) return false;
      return true;
    });
    if (keep.length !== l.props.strokes.length) commit((d) => ({ ...d, layers: d.layers.map((x2) => (x2.id === l.id && x2.type === 'drawing' ? { ...x2, props: { ...x2.props, strokes: keep } } : x2)) }), key);
  };

  const finishStroke = () => {
    const s = live.current;
    live.current = null;
    repaint();
    if (!s || s.erase !== null || s.points.length < 3) { endCoalesce(); return; }
    const { brush, brushSize, brushColor } = useLayout.getState();
    const st = useEditor.getState(), doc0 = st.doc!;
    let l = drawingOf(doc0, useLayout.getState().drawLayer);
    if (l?.parentId) l = undefined; // drawings inside groups get a fresh drawing instead
    if (!l) {
      const n = doc0.layers.filter((x) => x.type === 'drawing').length + 1;
      const props: DrawingProps = { ...defaultDrawing(), width: W, height: H, strokes: [{ brush: brush as Stroke['brush'], color: brushColor, size: brushSize, points: s.points.map((v, i) => +v.toFixed(i % 3 === 2 ? 2 : 1)) }] };
      const created = createLayer('drawing', { name: `Drawing ${n}`, props } as any);
      commit((d) => ({ ...d, layers: [...d.layers, created] }));
      setLayout({ drawLayer: created.id });
      return;
    }
    const target = l;
    const pts: number[] = [];
    let k = 1;
    for (let i = 0; i < s.points.length; i += 3) { const q = toLocal(target, doc0, s.points[i], s.points[i + 1]); k = q.k; pts.push(+q.x.toFixed(1), +q.y.toFixed(1), +s.points[i + 2].toFixed(2)); }
    const stroke: Stroke = { brush: brush as Stroke['brush'], color: brushColor, size: +(brushSize / k).toFixed(2), points: pts };
    commit((d) => ({ ...d, layers: d.layers.map((x) => (x.id === target.id && x.type === 'drawing' ? { ...x, props: { ...x.props, strokes: [...x.props.strokes, stroke].slice(-600) } } : x)) }));
  };

  return (
    <canvas ref={canvas} className="draw-surface" aria-label="Drawing surface. Draw with a pointer, finger or pencil."
      onPointerDown={(e) => {
        if (e.pointerType === 'pen') penSeen.current = true;
        if (e.pointerType === 'touch' && penSeen.current) return; // palm rejection once a pencil is in use
        if (e.button > 0) return;
        e.preventDefault();
        canvas.current!.setPointerCapture(e.pointerId);
        const p = scenePoint(e), { brush } = useLayout.getState();
        if (brush === 'eraser') { const key = `erase:${Date.now()}`; live.current = { id: e.pointerId, points: [], erase: key }; erase(p.x, p.y, key); return; }
        live.current = { id: e.pointerId, points: [p.x, p.y, e.pointerType === 'mouse' ? 0.5 : e.pressure], erase: null };
        repaint();
      }}
      onPointerMove={(e) => {
        const s = live.current;
        if (!s || s.id !== e.pointerId) return;
        const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const p = scenePoint(ev);
          if (s.erase !== null) { erase(p.x, p.y, s.erase); continue; }
          const n = s.points.length;
          if (Math.hypot(p.x - s.points[n - 3], p.y - s.points[n - 2]) * p.px < 1.2) continue; // under ~1 screen pixel
          s.points.push(p.x, p.y, ev.pointerType === 'mouse' ? 0.5 : ev.pressure);
        }
        repaint();
      }}
      onPointerUp={(e) => { if (live.current?.id === e.pointerId) finishStroke(); }}
      onPointerCancel={() => { live.current = null; repaint(); endCoalesce(); }}
    />
  );
}

/** The floating toolbar while drawing: strokes, size, colour, eraser, undo and done. */
export function DrawBar() {
  const touch = useTouchDevice();
  const [pick, setPick] = useState<'brush' | 'colour' | null>(null);
  const { brush, brushSize, brushColor, drawLayer } = useLayout();
  const doc = useEditor((s) => s.doc);
  const count = drawingOf(doc, drawLayer)?.props.strokes.length ?? 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/input|textarea|select/i.test((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); finishDrawing(); }
      else if (e.key === '[') setLayout({ brushSize: Math.max(1, useLayout.getState().brushSize - 2) });
      else if (e.key === ']') setLayout({ brushSize: Math.min(80, useLayout.getState().brushSize + 2) });
      else if (e.key.toLowerCase() === 'e' && !e.metaKey && !e.ctrlKey) setLayout({ brush: useLayout.getState().brush === 'eraser' ? 'pen' : 'eraser' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="draw-bar metal-graphite" role="toolbar" aria-label="Drawing tools">
      {touch && <>
        <button className="cb-btn draw-pick" aria-label={`Stroke: ${BRUSHES.find((b) => b.key === brush)?.label}`} aria-expanded={pick === 'brush'} onClick={() => setPick(pick === 'brush' ? null : 'brush')}><Icon name={BRUSHES.find((b) => b.key === brush)?.icon ?? 'pen'} size={18} /></button>
        <button className="cb-btn draw-pick" aria-label="Colour" aria-expanded={pick === 'colour'} onClick={() => setPick(pick === 'colour' ? null : 'colour')}><span className="draw-swatch" style={{ background: brushColor }} /></button>
        {pick && (
          <div className="draw-pop metal-graphite" role="radiogroup" aria-label={pick === 'brush' ? 'Stroke' : 'Colour'}>
            {pick === 'brush'
              ? BRUSHES.map((b) => <button key={b.key} className="cb-btn cb-text" role="radio" aria-checked={brush === b.key} onClick={() => { setLayout({ brush: b.key }); setPick(null); }}><Icon name={b.icon} size={16} />{b.label}</button>)
              : <div className="draw-colors">{COLORS.map((c) => <button key={c} role="radio" aria-checked={brushColor === c} aria-label={`Colour ${c}`} className="draw-swatch big" style={{ background: c }} onClick={() => { setLayout({ brushColor: c, ...(brush === 'eraser' ? { brush: 'pen' } : {}) }); setPick(null); }} />)}<label className="draw-swatch big custom"><input type="color" value={brushColor} onChange={(e) => setLayout({ brushColor: e.target.value })} aria-label="Pick any colour" /></label></div>}
          </div>
        )}
      </>}
      {!touch && <div className="draw-group" role="radiogroup" aria-label="Stroke">
        {BRUSHES.map((b) => (
          <Tip key={b.key} label={b.label} kbd={b.kbd} side="top">
            <button className="cb-btn" role="radio" aria-checked={brush === b.key} aria-label={b.label} onClick={() => setLayout({ brush: b.key })}><Icon name={b.icon} size={16} /></button>
          </Tip>
        ))}
      </div>}
      <span className="cb-sep" />
      <label className="draw-size" title="Size ( [ and ] )">
        <span className="draw-dot" style={{ width: Math.min(22, 3 + brushSize * 0.5), height: Math.min(22, 3 + brushSize * 0.5), background: brush === 'eraser' ? 'transparent' : brushColor }} />
        <input type="range" min={1} max={80} value={brushSize} onChange={(e) => setLayout({ brushSize: Number(e.target.value) })} aria-label="Stroke size" />
      </label>
      {!touch && <span className="cb-sep" />}
      {!touch && <div className="draw-colors" role="radiogroup" aria-label="Colour">
        {COLORS.map((c) => <button key={c} role="radio" aria-checked={brushColor === c} aria-label={`Colour ${c}`} className="draw-swatch" style={{ background: c }} onClick={() => setLayout({ brushColor: c, ...(brush === 'eraser' ? { brush: 'pen' } : {}) })} />)}
        <label className="draw-swatch custom" title="Any colour"><input type="color" value={brushColor} onChange={(e) => setLayout({ brushColor: e.target.value })} aria-label="Pick any colour" /></label>
      </div>}
      <span className="cb-sep" />
      <Tip label="Undo last stroke" kbd="⌘Z" side="top"><button className="cb-btn" aria-label="Undo last stroke" disabled={!count} onClick={undo}><Icon name="undo" size={15} /></button></Tip>
      <Tip label="Finish this drawing and start a separate one, to animate on its own" side="top"><button className="cb-btn cb-text" aria-label={touch ? 'New part' : 'New drawing'} disabled={!count} onClick={() => { finishDrawing(); startDrawing(null); }}><Icon name="plus" size={13} />{touch ? 'New part' : 'New drawing'}</button></Tip>
      {touch
        ? <button className="draw-done" onClick={() => { finishDrawing(); setLayout({ moveSheet: true }); }}><Icon name="film" size={14} />Animate</button>
        : <button className="draw-done" onClick={finishDrawing}>Done</button>}
    </div>
  );
}
