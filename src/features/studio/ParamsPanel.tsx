import { useEffect, useState } from 'react';
import type { ExposedParam } from '../../../shared/scene/schema';
import { PARAM_TYPES } from '../../../shared/scene/schema';
import { paramIssues, readTarget } from '../../../shared/params';
import { Icon } from '../../ui/Icon';
import { EmptyState, NumberField, Switch, Tip } from '../../ui/controls';
import { gradientCss } from '../../ui/color';
import { useBrandTokens, colorSwatches, gradientPresets } from '../../lib/brand';
import { api } from '../../lib/api';
import { useStudio, updateParam, removeParam, select } from './store';

const CONSUMER_ROLES = ['marketing', 'operations', 'engineer', 'designer'];

export function ParamsPanel({ readOnly }: { readOnly: boolean }) {
  const doc = useStudio((s) => s.doc)!;
  const tokens = useBrandTokens();
  const [images, setImages] = useState<any[]>([]);
  useEffect(() => { api('/assets', { query: { kind: 'image' } }).then((r) => setImages(r.assets)).catch(() => {}); }, []);
  const issues = paramIssues(doc);
  if (!doc.exposed.length) return <EmptyState icon="link" title="No editable parameters yet">Hover any property in Inspect and click <Icon name="link" size={12} /> to expose it. Exposed parameters are the only things other teams can change.</EmptyState>;
  return (
    <div style={{ padding: 10 }} className="col">
      <div className="faint" style={{ fontSize: 12, padding: '2px 4px 4px' }}>These controls appear in the team playground and campaigns. Everything else stays fixed; locked parameters are shown but cannot change. The server re-validates every value.</div>
      {issues.length > 0 && <div className="surface" style={{ padding: 10, borderColor: 'rgba(241,187,93,.35)' }}>{issues.map((i) => <div key={i} className="row" style={{ color: 'var(--warn)', fontSize: 12 }}><Icon name="alert" size={13} />{i}</div>)}</div>}
      {doc.exposed.map((p) => <ParamCard key={p.key} p={p} readOnly={readOnly} tokens={tokens} images={images} />)}
    </div>
  );
}

function ParamCard({ p, readOnly, tokens, images }: { p: ExposedParam; readOnly: boolean; tokens: any[]; images: any[] }) {
  const doc = useStudio((s) => s.doc)!;
  const [open, setOpen] = useState(false);
  const u = (patch: Partial<ExposedParam>, k?: string) => updateParam(p.key, patch, k ? `param:${p.key}:${k}` : undefined);
  const current = p.targets[0] ? readTarget(doc, p.targets[0]) : undefined;
  const optionValues = (p.options ?? []).map((o) => JSON.stringify(o.value));
  const toggleOption = (label: string, value: unknown) => {
    const v = JSON.stringify(value);
    const has = optionValues.includes(v);
    u({ options: has ? p.options!.filter((o) => JSON.stringify(o.value) !== v) : [...(p.options ?? []), { label, value }] });
  };
  return (
    <div className="surface" style={{ padding: 0 }}>
      <div className="row" style={{ padding: '9px 10px', gap: 8 }}>
        <button className="icon-btn sm" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${p.label}`} onClick={() => setOpen(!open)}><Icon name={open ? 'chevronDown' : 'chevronRight'} /></button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}><span style={{ fontWeight: 560 }} className="ellipsis">{p.label}</span>{p.locked && <Icon name="lock" size={12} />}</div>
          <div className="mono faint" style={{ fontSize: 10.5 }}>{p.key} · {p.type} · {p.targets.map((t) => doc.layers.find((l) => l.id === t.layerId)?.name).join(', ')}</div>
        </div>
        {!readOnly && <Tip label="Remove parameter"><button className="icon-btn sm" aria-label={`Remove ${p.label}`} onClick={() => removeParam(p.key)}><Icon name="trash" /></button></Tip>}
      </div>
      {open && (
        <div className="col" style={{ padding: '0 12px 12px', gap: 9 }}>
          <div className="pgrid2">
            <label className="field"><span className="label">Label</span><input className="input sm" value={p.label} disabled={readOnly} onChange={(e) => u({ label: e.target.value || p.label }, 'label')} /></label>
            <label className="field"><span className="label">Type</span><select className="select sm" value={p.type} disabled={readOnly} onChange={(e) => u({ type: e.target.value as any })}>{PARAM_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          </div>
          <label className="field"><span className="label">Description</span><input className="input sm" value={p.description} disabled={readOnly} placeholder="Shown as help text to other teams" onChange={(e) => u({ description: e.target.value }, 'desc')} /></label>
          <label className="field"><span className="label">Group</span><input className="input sm" value={p.group ?? ''} disabled={readOnly} placeholder="Content, Style, Motion…" onChange={(e) => u({ group: e.target.value }, 'group')} /></label>
          <div className="row between"><span className="label">Default</span>
            <span className="row" style={{ gap: 6 }}><span className="mono faint ellipsis" style={{ maxWidth: 140 }}>{typeof p.default === 'object' ? (Array.isArray(p.default) ? `${p.default.length} stops` : JSON.stringify(p.default)) : String(p.default)}</span>
              <button className="btn sm" disabled={readOnly || JSON.stringify(current) === JSON.stringify(p.default)} onClick={() => u({ default: current })}>Use current</button></span></div>
          {(p.type === 'number' || p.type === 'scale') && (
            <div className="pgrid3">
              <NumberField label="Minimum" prefix="min" value={p.min ?? 0} step={0.01} disabled={readOnly} onChange={(v) => u({ min: v }, 'min')} />
              <NumberField label="Maximum" prefix="max" value={p.max ?? 1} step={0.01} disabled={readOnly} onChange={(v) => u({ max: v }, 'max')} />
              <NumberField label="Step" prefix="Δ" value={p.step ?? 0.01} step={0.001} min={0.0001} disabled={readOnly} onChange={(v) => u({ step: v }, 'step')} />
            </div>
          )}
          {p.type === 'text' && (
            <div className="row between"><span className="label">Max characters</span><div style={{ width: 90 }}><NumberField label="Maximum length" prefix="#" value={p.maxLength ?? 2000} step={1} min={1} max={2000} disabled={readOnly} onChange={(v) => u({ maxLength: Math.round(v) }, 'maxlen')} /></div></div>
          )}
          {p.type === 'color' && (
            <div className="field"><span className="label">Allowed colours {p.options?.length ? `(${p.options.length})` : '(any)'}</span>
              <div className="row wrap" style={{ gap: 5 }}>{colorSwatches(tokens).map((s) => <button key={s.value} className="swatch" aria-pressed={optionValues.includes(JSON.stringify(s.value))} title={s.label} aria-label={`Allow ${s.label}`} disabled={readOnly} style={{ background: s.value }} onClick={() => toggleOption(s.label, s.value)} />)}
                {typeof current === 'string' && <button className="swatch" aria-pressed={optionValues.includes(JSON.stringify(current))} title="Current colour" aria-label="Allow current colour" disabled={readOnly} style={{ background: current }} onClick={() => toggleOption('Current', current)} />}</div>
              <span className="field-hint">With no colours selected, any colour is allowed.</span>
            </div>
          )}
          {p.type === 'gradientPreset' && (
            <div className="field"><span className="label">Allowed palettes</span>
              <div className="row wrap" style={{ gap: 5 }}>{gradientPresets(tokens).map((g) => <button key={g.key} aria-pressed={optionValues.includes(JSON.stringify(g.stops))} aria-label={`Allow ${g.label}`} disabled={readOnly} onClick={() => toggleOption(g.label, g.stops)} title={g.label}
                style={{ width: 44, height: 18, borderRadius: 5, background: gradientCss(g.stops), border: optionValues.includes(JSON.stringify(g.stops)) ? '2px solid var(--text)' : '1px solid var(--line-2)', cursor: 'pointer' }} />)}</div>
            </div>
          )}
          {p.type === 'image' && (
            <div className="field"><span className="label">Approved images</span>
              <div className="row wrap" style={{ gap: 5 }}>{images.map((a) => <button key={a.id} className="swatch lg" aria-pressed={optionValues.includes(JSON.stringify(a.id))} title={a.name} aria-label={`Allow ${a.name}`} disabled={readOnly} style={{ backgroundImage: `url(${a.url})`, backgroundSize: 'cover' }} onClick={() => toggleOption(a.name, a.id)} />)}</div>
            </div>
          )}
          {p.type === 'select' && (
            <div className="field"><span className="label">Options (label = value, one per line)</span>
              <textarea className="textarea mono" rows={3} disabled={readOnly} defaultValue={(p.options ?? []).map((o) => `${o.label} = ${o.value}`).join('\n')} onBlur={(e) => u({ options: e.target.value.split('\n').map((l) => l.split('=').map((x) => x.trim())).filter((x) => x[0]).map(([label, value]) => ({ label, value: value ?? label })) })} />
            </div>
          )}
          <div className="row between"><span className="label">Locked by brand</span><Switch label="Locked" checked={!!p.locked} disabled={readOnly} onChange={(v) => u({ locked: v })} /></div>
          {p.locked && <label className="field"><span className="label">Reason shown to teams</span><input className="input sm" value={p.lockReason ?? ''} disabled={readOnly} placeholder="e.g. Brand rule: headline colour is fixed" onChange={(e) => u({ lockReason: e.target.value }, 'lr')} /></label>}
          <div className="field"><span className="label">Who may change it {p.roles?.length ? '' : '(everyone with template access)'}</span>
            <div className="row wrap" style={{ gap: 5 }}>{CONSUMER_ROLES.map((r) => <button key={r} className="chip" aria-pressed={!!p.roles?.includes(r)} disabled={readOnly} onClick={() => u({ roles: p.roles?.includes(r) ? p.roles.filter((x) => x !== r) : [...(p.roles ?? []), r] })}>{r}</button>)}</div>
          </div>
          <label className="field"><span className="label">Token binding</span>
            <select className="select sm" value={p.tokenBinding ?? ''} disabled={readOnly} onChange={(e) => u({ tokenBinding: e.target.value || null })}>
              <option value="">None</option>{tokens.map((t) => <option key={t.key} value={t.key}>{t.key}</option>)}
            </select>
          </label>
          <button className="btn sm ghost" onClick={() => select([p.targets[0].layerId])}><Icon name="crosshair" size={12} />Show target layer</button>
        </div>
      )}
    </div>
  );
}
