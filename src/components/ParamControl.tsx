import { useEffect, useState } from 'react';
import type { ExposedParam } from '../../shared/scene/schema';
import { validateParamValue } from '../../shared/params';
import { deepEqual } from '../../shared/util/paths';
import type { AssetResolver } from '../engine/assets';
import { Icon } from '../ui/Icon';
import { NumberField, Slider, Switch, Tip } from '../ui/controls';
import { ColorField, gradientCss } from '../ui/color';

/**
 * A brand-governed parameter control. Locked parameters render read-only with the reason;
 * role restrictions and validation errors are explained inline (the server enforces the same rules).
 */
export function ParamControl({ p, value, onChange, onCommit, roles, assets, badge, onReset }: {
  p: ExposedParam; value: unknown; onChange: (v: unknown) => void; onCommit?: () => void; roles: string[]; assets: AssetResolver;
  badge?: React.ReactNode; onReset?: () => void;
}) {
  const locked = !!p.locked;
  const roleBlocked = !!p.roles?.length && !roles.some((r) => p.roles!.includes(r) || r === 'owner' || r === 'admin');
  const disabled = locked || roleBlocked;
  const [draft, setDraft] = useState<unknown>(value);
  useEffect(() => setDraft(value), [value]);
  const check = validateParamValue(p, draft);
  const error = check.ok ? null : check.message;
  const set = (v: unknown) => { setDraft(v); if (validateParamValue(p, v).ok) onChange(v); };
  const id = `param-${p.key}`;
  const len = typeof draft === 'string' ? [...draft].length : 0;

  return (
    <div className="col" style={{ gap: 6, opacity: disabled ? 0.85 : 1 }}>
      <div className="row" style={{ gap: 6 }}>
        <label htmlFor={id} className="label grow" style={{ color: 'var(--text)', fontWeight: 520 }}>{p.label}</label>
        {badge}
        {onReset && <Tip label="Reset to inherited value"><button className="icon-btn sm" onClick={onReset} aria-label={`Reset ${p.label}`}><Icon name="restart" /></button></Tip>}
        {locked && <Tip label={p.lockReason || 'Locked by the brand system'}><span className="badge" aria-label={`Locked: ${p.lockReason || 'brand system'}`}><Icon name="lock" size={10} />locked</span></Tip>}
        {roleBlocked && !locked && <Tip label={`Only ${p.roles!.join(', ')} can change this`}><span className="badge"><Icon name="shield" size={10} />restricted</span></Tip>}
        {p.type === 'text' && p.maxLength && <span className={`mono ${len > p.maxLength ? '' : 'faint'}`} style={{ fontSize: 10.5, color: len > p.maxLength ? 'var(--danger)' : undefined }}>{len}/{p.maxLength}</span>}
      </div>
      {p.type === 'text' && (
        String(p.default ?? '').includes('\n') || (p.maxLength ?? 0) > 40
          ? <textarea id={id} className="textarea" rows={2} value={String(draft ?? '')} disabled={disabled} aria-invalid={!!error} aria-describedby={`${id}-msg`} onChange={(e) => set(e.target.value)} onBlur={onCommit} />
          : <input id={id} className="input" value={String(draft ?? '')} disabled={disabled} aria-invalid={!!error} aria-describedby={`${id}-msg`} onChange={(e) => set(e.target.value)} onBlur={onCommit} onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); set(`${draft}\n`); } }} />
      )}
      {(p.type === 'number' || p.type === 'scale') && (
        <div className="row" style={{ gap: 8 }}>
          <Slider label={p.label} value={Number(draft)} min={p.min ?? 0} max={p.max ?? 1} step={p.step ?? 0.01} disabled={disabled} onChange={set} onCommit={onCommit} />
          <div style={{ width: 70 }}><NumberField label={p.label} value={Number(draft)} min={p.min} max={p.max} step={p.step ?? 0.01} disabled={disabled} onChange={set} onCommit={onCommit} /></div>
        </div>
      )}
      {p.type === 'boolean' && <Switch label={p.label} checked={!!draft} disabled={disabled} onChange={(v) => { set(v); onCommit?.(); }} />}
      {p.type === 'color' && (
        p.options?.length
          ? <ColorField label={p.label} value={String(draft)} restricted swatches={p.options.map((o) => ({ label: o.label, value: String(o.value) }))} disabled={disabled} onChange={(v) => { set(v); }} onCommit={onCommit} />
          : <ColorField label={p.label} value={String(draft)} disabled={disabled} onChange={set} onCommit={onCommit} />
      )}
      {p.type === 'gradientPreset' && (
        <div className="row wrap" style={{ gap: 6 }} role="radiogroup" aria-label={p.label}>
          {(p.options ?? []).map((o) => {
            const on = deepEqual(o.value, draft);
            return (
              <button key={o.label} role="radio" aria-checked={on} disabled={disabled} onClick={() => { set(o.value); onCommit?.(); }} title={o.label}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', background: 'none', border: 0, padding: 0, cursor: disabled ? 'not-allowed' : 'pointer', color: on ? 'var(--text)' : 'var(--text-2)' }}>
                <span style={{ width: 62, height: 36, borderRadius: 8, background: gradientCss(o.value as any, 120), boxShadow: on ? '0 0 0 2px var(--bg-1), 0 0 0 3.5px var(--text)' : 'inset 0 0 0 1px var(--line-2)' }} />
                <span style={{ fontSize: 11 }}>{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {(p.type === 'select' || p.type === 'multiSelect') && (
        <select id={id} className="select" disabled={disabled} value={JSON.stringify(draft)} onChange={(e) => { set(JSON.parse(e.target.value)); onCommit?.(); }}>
          {(p.options ?? []).map((o) => <option key={o.label} value={JSON.stringify(o.value)}>{o.label}</option>)}
        </select>
      )}
      {p.type === 'image' && <ImageOptions p={p} value={draft as string | null} assets={assets} disabled={disabled} onPick={(v) => { set(v); onCommit?.(); }} />}
      {p.type === 'position' && (
        <div className="pgrid2">
          {(['x', 'y'] as const).map((k) => <NumberField key={k} label={`${p.label} ${k}`} prefix={k.toUpperCase()} value={(draft as any)?.[k] ?? 0.5} min={p.min ?? 0} max={p.max ?? 1} step={0.01} disabled={disabled} onChange={(v) => set({ ...(draft as any), [k]: v })} onCommit={onCommit} />)}
        </div>
      )}
      <div id={`${id}-msg`} aria-live="polite">
        {error ? <div className="field-error">{error}</div> : locked ? <div className="field-hint">{p.lockReason || 'Locked by the brand system.'}</div> : roleBlocked ? <div className="field-hint">Only {p.roles!.join(', ')} can change this.</div> : p.description ? <div className="field-hint">{p.description}</div> : null}
      </div>
    </div>
  );
}

function ImageOptions({ p, value, assets, disabled, onPick }: { p: ExposedParam; value: string | null; assets: AssetResolver; disabled: boolean; onPick: (v: string) => void }) {
  const [urls, setUrls] = useState<Record<string, { url?: string; missing?: boolean; w?: number; h?: number }>>({});
  useEffect(() => {
    (p.options ?? []).forEach((o) => assets.resolve(String(o.value)).then((a) => setUrls((u) => ({ ...u, [String(o.value)]: 'url' in a ? { url: a.url, w: a.width, h: a.height } : { missing: true } }))));
  }, [p.options, assets]);
  return (
    <div className="row wrap" style={{ gap: 8 }} role="radiogroup" aria-label={p.label}>
      {(p.options ?? []).map((o) => {
        const v = String(o.value), u = urls[v], on = v === value;
        return (
          <button key={v} role="radio" aria-checked={on} aria-label={o.label} title={o.label} disabled={disabled || u?.missing} onClick={() => onPick(v)}
            style={{ width: 64, height: 64, borderRadius: 10, padding: 0, cursor: 'pointer', border: 0, background: u?.url ? `center / cover url(${u.url})` : 'var(--bg-3)', boxShadow: on ? '0 0 0 2px var(--bg-1), 0 0 0 3.5px var(--text)' : 'inset 0 0 0 1px var(--line-2)', display: 'grid', placeItems: 'center' }}>
            {u?.missing && <Icon name="alert" size={14} />}
          </button>
        );
      })}
    </div>
  );
}
