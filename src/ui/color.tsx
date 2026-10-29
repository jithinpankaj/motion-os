import { useRef, useState } from 'react';
import { hexToHsv, hsvToHex, isHex } from '../../shared/util/color';
import type { GradientProps } from '../../shared/scene/schema';
import { Popover } from './controls';
import { Icon } from './Icon';

type Swatch = { label: string; value: string };

export function ColorPicker({ value, onChange, onCommit, swatches }: { value: string; onChange: (v: string) => void; onCommit?: () => void; swatches?: Swatch[] }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [text, setText] = useState(value);
  const sv = useRef<HTMLDivElement>(null), hue = useRef<HTMLDivElement>(null);
  const set = (h: number, s: number, v: number) => { setHsv([h, s, v]); const hex = hsvToHex(h, s, v); setText(hex); onChange(hex); };
  const dragSV = (e: React.PointerEvent) => {
    const r = sv.current!.getBoundingClientRect();
    set(hsv[0], Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)));
  };
  const dragHue = (e: React.PointerEvent) => {
    const r = hue.current!.getBoundingClientRect();
    set(Math.min(359.9, Math.max(0, ((e.clientX - r.left) / r.width) * 360)), hsv[1], hsv[2]);
  };
  const pointer = (fn: (e: React.PointerEvent) => void) => ({
    onPointerDown: (e: React.PointerEvent) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); fn(e); },
    onPointerMove: (e: React.PointerEvent) => { if (e.buttons) fn(e); },
    onPointerUp: () => onCommit?.(),
  });
  const keySV = (e: React.KeyboardEvent) => {
    const d = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowRight') set(hsv[0], Math.min(1, hsv[1] + d), hsv[2]);
    if (e.key === 'ArrowLeft') set(hsv[0], Math.max(0, hsv[1] - d), hsv[2]);
    if (e.key === 'ArrowUp') set(hsv[0], hsv[1], Math.min(1, hsv[2] + d));
    if (e.key === 'ArrowDown') set(hsv[0], hsv[1], Math.max(0, hsv[2] - d));
  };
  return (
    <div className="cp">
      <>
          <div ref={sv} className="cp-sv" role="slider" tabIndex={0} aria-label="Saturation and brightness" aria-valuetext={value} onKeyDown={keySV} onKeyUp={() => onCommit?.()} style={{ background: `linear-gradient(0deg, #000, transparent), linear-gradient(90deg, #fff, ${hsvToHex(hsv[0], 1, 1)})` }} {...pointer(dragSV)}>
            <span className="cp-knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: value }} />
          </div>
          <div ref={hue} className="cp-hue" role="slider" tabIndex={0} aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv[0])}
            onKeyDown={(e) => { if (e.key === 'ArrowRight') set((hsv[0] + 5) % 360, hsv[1], hsv[2]); if (e.key === 'ArrowLeft') set((hsv[0] + 355) % 360, hsv[1], hsv[2]); }} onKeyUp={() => onCommit?.()} {...pointer(dragHue)}>
            <span className="cp-knob" style={{ left: `${(hsv[0] / 360) * 100}%`, top: '50%', background: hsvToHex(hsv[0], 1, 1) }} />
          </div>
      </>
      <div className="row">
        <span className="swatch" style={{ background: value }} aria-hidden />
        <input className="input sm mono" aria-label="Hex colour" value={text} onChange={(e) => { setText(e.target.value); if (isHex(e.target.value)) { onChange(e.target.value.toLowerCase()); setHsv(hexToHsv(e.target.value)); } }} onBlur={() => { setText(value); onCommit?.(); }} />
      </div>
      {!!swatches?.length && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Brand palette</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {swatches.map((s) => <button key={s.label} className="swatch" title={`${s.label} ${s.value}`} aria-label={s.label} aria-pressed={s.value.toLowerCase() === value.toLowerCase()} style={{ background: s.value }} onClick={() => { onChange(s.value); setHsv(hexToHsv(s.value)); setText(s.value); onCommit?.(); }} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Colour control. With `restricted`, only the provided swatches are allowed (brand-governed). */
export function ColorField({ value, onChange, onCommit, label, swatches, restricted, disabled }: { value: string; onChange: (v: string) => void; onCommit?: () => void; label: string; swatches?: Swatch[]; restricted?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  if (restricted) {
    return (
      <div className="row wrap" style={{ gap: 6 }} role="radiogroup" aria-label={label}>
        {swatches?.map((s) => <button key={s.value} role="radio" aria-checked={s.value.toLowerCase() === value.toLowerCase()} aria-pressed={s.value.toLowerCase() === value.toLowerCase()} className="swatch lg" title={s.label} aria-label={s.label} disabled={disabled} style={{ background: s.value }} onClick={() => { onChange(s.value); onCommit?.(); }} />)}
      </div>
    );
  }
  return (
    <>
      <button ref={ref} className="row" style={{ gap: 7, height: 26, padding: '0 7px 0 3px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg-2)', cursor: disabled ? 'not-allowed' : 'pointer', width: '100%', opacity: disabled ? 0.5 : 1 }} disabled={disabled} aria-label={`${label}: ${value}`} onClick={() => setOpen(true)}>
        <span className="swatch" style={{ width: 18, height: 18, background: value }} />
        <span className="mono ellipsis">{value.toUpperCase()}</span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement="left">
        <ColorPicker value={value} onChange={onChange} onCommit={onCommit} swatches={swatches} />
      </Popover>
    </>
  );
}

export function gradientCss(stops: GradientProps['stops'], angle = 90) {
  return `linear-gradient(${angle}deg, ${stops.slice().sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(', ')})`;
}

/** Gradient stop editor: drag stops, click the bar to add, select to recolour, Delete to remove. */
export function GradientEditor({ stops, onChange, onCommit, swatches, disabled }: { stops: GradientProps['stops']; onChange: (s: GradientProps['stops']) => void; onCommit?: () => void; swatches?: Swatch[]; disabled?: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState(0);
  const i = Math.min(sel, stops.length - 1);
  const posFrom = (x: number) => { const r = bar.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (x - r.left) / r.width)); };
  const update = (idx: number, patch: Partial<GradientProps['stops'][number]>) => onChange(stops.map((s, k) => (k === idx ? { ...s, ...patch } : s)));
  return (
    <div className="col" style={{ gap: 4 }}>
      <div ref={bar} className="gbar" style={{ background: gradientCss(stops) }} aria-label="Gradient stops — click to add" onPointerDown={(e) => {
        if (disabled || e.target !== e.currentTarget || stops.length >= 6) return;
        const pos = posFrom(e.clientX);
        const sorted = stops.slice().sort((a, b) => a.pos - b.pos);
        const near = sorted.reduce((a, b) => (Math.abs(b.pos - pos) < Math.abs(a.pos - pos) ? b : a));
        onChange([...stops, { color: near.color, pos: +pos.toFixed(3) }]);
        setSel(stops.length);
        onCommit?.();
      }}>
        {stops.map((s, k) => (
          <button key={k} className="gstop" aria-pressed={k === i} aria-label={`Stop ${k + 1}: ${s.color} at ${Math.round(s.pos * 100)}%`} style={{ left: `${s.pos * 100}%`, background: s.color }} disabled={disabled}
            onPointerDown={(e) => { e.stopPropagation(); setSel(k); (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => { if (e.buttons) update(k, { pos: +posFrom(e.clientX).toFixed(3) }); }}
            onPointerUp={() => onCommit?.()}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); update(k, { pos: Math.min(1, Math.max(0, +(s.pos + (e.key === 'ArrowRight' ? 0.01 : -0.01) * (e.shiftKey ? 10 : 1)).toFixed(3))) }); }
              if ((e.key === 'Delete' || e.key === 'Backspace') && stops.length > 2) { e.preventDefault(); onChange(stops.filter((_, x) => x !== k)); setSel(0); onCommit?.(); }
            }} onKeyUp={() => onCommit?.()} />
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <div className="grow"><ColorField label={`Stop ${i + 1} colour`} value={stops[i].color} onChange={(c) => update(i, { color: c })} onCommit={onCommit} swatches={swatches} disabled={disabled} /></div>
        <span className="mono faint" style={{ width: 34, textAlign: 'right' }}>{Math.round(stops[i].pos * 100)}%</span>
        <button className="icon-btn sm" aria-label="Remove stop" disabled={disabled || stops.length <= 2} onClick={() => { onChange(stops.filter((_, x) => x !== i)); setSel(0); onCommit?.(); }}><Icon name="minus" /></button>
      </div>
    </div>
  );
}
