import { useRef } from 'react';
import type { Easing } from '../../../../shared/scene/schema';
import { ease } from '../../../../shared/util/easing';

/** Easing pickers: a named ease with a live curve, or a custom Bézier curve with draggable handles. */
const NAMED: { value: string; label: string }[] = [
  { value: 'easeOut', label: 'Ease out' }, { value: 'easeIn', label: 'Ease in' }, { value: 'easeInOut', label: 'Ease in & out' }, { value: 'linear', label: 'Linear' },
  { value: 'expoOut', label: 'Snappy' }, { value: 'backOut', label: 'Overshoot' }, { value: 'spring', label: 'Spring' },
];
/** Named easings, or a custom Bézier curve with draggable handles. */
export function EasingField({ value, onChange }: { value: Easing; onChange: (e: Easing) => void }) {
  const custom = Array.isArray(value);
  return (
    <span className="col" style={{ gap: 6 }}>
      <select className="input sm" value={custom ? 'custom' : value} onChange={(e) => onChange(e.target.value === 'custom' ? [0.25, 0.1, 0.25, 1] : (e.target.value as Easing))} aria-label="Easing">
        {NAMED.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}<option value="custom">Custom curve…</option>
      </select>
      {custom ? <BezierEditor value={value as [number, number, number, number]} onChange={onChange} /> : <CurvePreview easing={value} />}
    </span>
  );
}
function CurvePreview({ easing }: { easing: Easing }) {
  const pts = Array.from({ length: 33 }, (_, i) => { const x = i / 32; return `${8 + x * 84},${82 - ease(easing, x) * 64}`; }).join(' ');
  return <svg className="curve" viewBox="0 0 100 100" width={100} height={64} aria-hidden><polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} /></svg>;
}
function BezierEditor({ value, onChange }: { value: [number, number, number, number]; onChange: (v: Easing) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const S = 120, P = 14, toX = (x: number) => P + x * (S - 2 * P), toY = (y: number) => S - P - y * (S - 2 * P) * 0.7 - (S - 2 * P) * 0.15;
  const fromPt = (cx: number, cy: number) => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((cx - r.left) / r.width) * S, y = ((cy - r.top) / r.height) * S;
    return { x: Math.min(1, Math.max(0, (x - P) / (S - 2 * P))), y: Math.min(2, Math.max(-1, (S - P - (S - 2 * P) * 0.15 - y) / ((S - 2 * P) * 0.7))) };
  };
  const drag = (h: 0 | 1) => (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => { const p = fromPt(ev.clientX, ev.clientY); const v = [...value] as typeof value; v[h * 2] = +p.x.toFixed(2); v[h * 2 + 1] = +p.y.toFixed(2); onChange(v); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const [x1, y1, x2, y2] = value;
  const pts = Array.from({ length: 41 }, (_, i) => { const x = i / 40; return `${toX(x)},${toY(ease(value, x))}`; }).join(' ');
  return (
    <span className="col" style={{ gap: 4 }}>
      <svg ref={svg} className="curve edit" viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="group" aria-label="Custom curve">
        <rect x={P} y={toY(1)} width={S - 2 * P} height={toY(0) - toY(1)} className="curve-box" />
        <line x1={toX(0)} y1={toY(0)} x2={toX(x1)} y2={toY(y1)} className="curve-arm" />
        <line x1={toX(1)} y1={toY(1)} x2={toX(x2)} y2={toY(y2)} className="curve-arm" />
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2.2} />
        <circle cx={toX(x1)} cy={toY(y1)} r={6} className="curve-h" onPointerDown={drag(0)} />
        <circle cx={toX(x2)} cy={toY(y2)} r={6} className="curve-h" onPointerDown={drag(1)} />
      </svg>
      <span className="row" style={{ gap: 4 }}>{value.map((n, i) => <input key={i} className="input sm mono" style={{ width: 52 }} type="number" step={0.05} min={i % 2 ? -1 : 0} max={i % 2 ? 2 : 1} value={n} onChange={(e) => { const v = [...value] as typeof value; v[i] = Number(e.target.value); onChange(v); }} aria-label={['x1', 'y1', 'x2', 'y2'][i]} />)}</span>
    </span>
  );
}

