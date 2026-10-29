import { useMemo, useState } from 'react';
import type { SceneDocument } from '../../shared/scene/schema';
import { analyzeCompatibility, EXPORT_FORMATS, type ExportFormatId } from '../../shared/compat';
import { adaptScene } from '../../shared/adapt';
import { CHANNEL_FORMATS, formatById } from '../../shared/formats';
import { useExports } from '../lib/exports';
import { errorMessage } from '../lib/api';
import { useCan } from '../lib/session';
import { Field, NumberField, Segmented, StatusBadge, toast } from '../ui/controls';
import { Icon } from '../ui/Icon';

/**
 * Export settings + compatibility analysis. The server re-resolves the scene from `source`
 * (consumers never upload scene JSON) and the worker renders exact frames at fixed times.
 */
export function ExportPanel({ doc, source, name, channel, time = 0, onQueued }: { doc: SceneDocument; source: any; name: string; channel?: string; time?: number; onQueued?: () => void }) {
  const can = useCan();
  const create = useExports((s) => s.create);
  const [fmt, setFmt] = useState<ExportFormatId>('mp4');
  const [ch, setCh] = useState<string>(channel ?? '');
  const f = ch ? formatById(ch) : undefined;
  const [size, setSize] = useState<{ w: number; h: number }>(() => (f ? { w: f.width, h: f.height } : { w: doc.canvas.width, h: doc.canvas.height }));
  const [s, setS] = useState({ fps: doc.canvas.fps, duration: doc.canvas.duration, startTime: 0, loops: 1, quality: 'high', background: '' as string, time: +time.toFixed(3), webpQuality: 0.92, transparent: false });
  const [busy, setBusy] = useState(false);
  const adapted = useMemo(() => adaptScene(doc, f ? { ...f, width: size.w, height: size.h } : { width: size.w, height: size.h }), [doc, f, size]);
  const report = useMemo(() => analyzeCompatibility(adapted, fmt), [adapted, fmt]);
  const meta = EXPORT_FORMATS.find((x) => x.id === fmt)!;
  const odd = fmt === 'mp4' && (size.w % 2 || size.h % 2);
  const frames = Math.round(s.duration * s.fps) * s.loops;

  const pickChannel = (id: string) => {
    setCh(id);
    const c = formatById(id);
    if (c) setSize({ w: c.width, h: c.height });
  };
  const go = async () => {
    setBusy(true);
    try {
      const settings = fmt === 'mp4' ? { width: size.w, height: size.h, fps: s.fps, duration: s.duration, startTime: s.startTime, loops: s.loops, quality: s.quality, background: s.background || null }
        : fmt === 'png' ? { width: size.w, height: size.h, time: s.time, background: s.transparent ? 'transparent' : 'scene' }
        : fmt === 'webp' ? { width: size.w, height: size.h, time: s.time, quality: s.webpQuality, background: s.transparent ? 'transparent' : 'scene' } : {};
      await create({ source, format: fmt, settings, channel: ch || undefined, name });
      toast('info', 'Export queued', 'Rendering in the background — keep working.');
      onQueued?.();
    } catch (e) { toast('danger', 'Export not started', errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 22 }}>
      <div className="col" style={{ gap: 14 }}>
        <div className="col" style={{ gap: 6 }} role="radiogroup" aria-label="Export format">
          <span className="label">Format</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {EXPORT_FORMATS.map((x) => (
              <button key={x.id} role="radio" aria-checked={fmt === x.id} className="chip" aria-pressed={fmt === x.id} disabled={!x.implemented} title={x.note} onClick={() => setFmt(x.id)} style={!x.implemented ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                {x.label}{!x.implemented && <span className="faint mono" style={{ fontSize: 9.5 }}>soon</span>}
              </button>
            ))}
          </div>
          <span className="field-hint">{meta.note}</span>
        </div>
        {(fmt === 'mp4' || fmt === 'png' || fmt === 'webp' || fmt === 'embed' || fmt === 'scene-json') && (
          <Field label="Channel layout" hint="Adapts layout (safe areas, overrides) — never stretches.">
            <select className="select" value={ch} onChange={(e) => (e.target.value ? pickChannel(e.target.value) : (setCh(''), setSize({ w: doc.canvas.width, h: doc.canvas.height })))}>
              <option value="">Design canvas · {doc.canvas.width}×{doc.canvas.height}</option>
              {CHANNEL_FORMATS.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.width}×{c.height}</option>)}
            </select>
          </Field>
        )}
        {(fmt === 'mp4' || fmt === 'png' || fmt === 'webp') && (
          <>
            <div className="pgrid2">
              <Field label="Width" error={odd ? 'MP4 needs even dimensions' : null}><NumberField label="Width" prefix="W" value={size.w} min={16} max={3840} step={1} onChange={(v) => setSize({ ...size, w: Math.round(v) })} /></Field>
              <Field label="Height"><NumberField label="Height" prefix="H" value={size.h} min={16} max={3840} step={1} onChange={(v) => setSize({ ...size, h: Math.round(v) })} /></Field>
            </div>
            <div className="row" style={{ gap: 6 }}>{[0.5, 1, 2].map((k) => <button key={k} className="btn sm" onClick={() => setSize({ w: Math.round((size.w * k) / 2) * 2, h: Math.round((size.h * k) / 2) * 2 })}>{k}×</button>)}</div>
          </>
        )}
        {fmt === 'mp4' && (
          <>
            <div className="pgrid3">
              <Field label="Frame rate"><select className="select" value={s.fps} onChange={(e) => setS({ ...s, fps: Number(e.target.value) })}>{[24, 25, 30, 50, 60].map((v) => <option key={v}>{v}</option>)}</select></Field>
              <Field label="Duration (s)"><NumberField label="Duration" prefix="⏱" value={s.duration} min={0.5} max={120} step={0.1} onChange={(v) => setS({ ...s, duration: v })} /></Field>
              <Field label="Loops"><NumberField label="Loop count" prefix="×" value={s.loops} min={1} max={10} step={1} onChange={(v) => setS({ ...s, loops: Math.round(v) })} /></Field>
            </div>
            <div className="pgrid2">
              <Field label="Quality"><Segmented label="Quality" value={s.quality as any} onChange={(v) => setS({ ...s, quality: v })} options={['draft', 'standard', 'high', 'max'].map((q) => ({ value: q as any, label: q }))} /></Field>
              <Field label="Start at (s)"><NumberField label="Start time" prefix="t" value={s.startTime} min={0} max={doc.canvas.duration} step={0.05} onChange={(v) => setS({ ...s, startTime: v })} /></Field>
            </div>
            <Field label="Background" hint="MP4 has no alpha channel; scene background is used unless overridden.">
              <div className="row"><label className="checkbox"><input type="checkbox" checked={!!s.background} onChange={(e) => setS({ ...s, background: e.target.checked ? '#000000' : '' })} />Override</label>{s.background && <input type="color" value={s.background} onChange={(e) => setS({ ...s, background: e.target.value })} aria-label="Background colour" />}</div>
            </Field>
            <div className="faint mono" style={{ fontSize: 11 }}>{frames} frames · rendered at exact times t = i / {s.fps}</div>
          </>
        )}
        {(fmt === 'png' || fmt === 'webp') && (
          <>
            <Field label="Frame" hint={`Exact time in seconds (frame ${Math.round(s.time * doc.canvas.fps)} at ${doc.canvas.fps} fps)`}>
              <div className="row"><NumberField label="Frame time" prefix="t" suffix="s" value={s.time} min={0} max={doc.canvas.duration} step={1 / doc.canvas.fps} onChange={(v) => setS({ ...s, time: v })} />
                <button className="btn sm" onClick={() => setS({ ...s, time: +time.toFixed(3) })}>Playhead</button><button className="btn sm" onClick={() => setS({ ...s, time: doc.export.posterTime })}>Poster</button></div>
            </Field>
            <label className="checkbox"><input type="checkbox" checked={s.transparent} onChange={(e) => setS({ ...s, transparent: e.target.checked })} />Transparent background</label>
            {fmt === 'webp' && <Field label={`WebP quality ${Math.round(s.webpQuality * 100)}%`}><input type="range" min={0.1} max={1} step={0.01} value={s.webpQuality} onChange={(e) => setS({ ...s, webpQuality: Number(e.target.value) })} aria-label="WebP quality" /></Field>}
          </>
        )}
        <button className="btn primary lg" disabled={busy || !meta.implemented || !!odd || !can('export.create')} onClick={go}>{busy ? <span className="spinner" /> : <><Icon name="download" />Export {meta.label}</>}</button>
        {!can('export.create') && <div className="field-error">Your role cannot create exports.</div>}
      </div>
      <div className="col" style={{ gap: 10 }}>
        <div className="row between"><span className="eyebrow">Compatibility</span><StatusBadge status={meta.implemented ? report.status : 'unavailable'} label={meta.implemented ? report.status : 'unavailable'} /></div>
        {!meta.implemented && <div className="surface" style={{ padding: 10, fontSize: 12.5 }}>{meta.label} is not implemented yet. This analysis shows what would carry over once it is.</div>}
        {report.flashing.map((x) => <div key={x} className="row field-error" style={{ gap: 6 }}><Icon name="alert" size={13} />{x}</div>)}
        <div className="col scroll" style={{ gap: 4, maxHeight: 360 }}>
          {report.items.map((i, k) => (
            <div key={k} className="row" style={{ gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
              <span style={{ color: i.level === 'ok' ? 'var(--ok)' : i.level === 'warn' ? 'var(--warn)' : i.level === 'error' ? 'var(--danger)' : 'var(--info)', marginTop: 2 }}><Icon name={i.level === 'ok' ? 'check' : i.level === 'info' ? 'info' : 'alert'} size={13} /></span>
              <div><div style={{ fontWeight: 520 }}>{i.feature} <span className="badge mono" style={{ height: 16, fontSize: 9.5 }}>{i.cls}</span></div><div className="muted">{i.message}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
