import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { api, errorMessage } from '../../lib/api';
import { invalidateBrand } from '../../lib/brand';
import { useCan, useSession } from '../../lib/session';
import { EmptyState, Field, Modal, NumberField, Slider, timeAgo, toast } from '../../ui/controls';
import { ColorField, GradientEditor, gradientCss } from '../../ui/color';
import { Icon } from '../../ui/Icon';
import { contrastRatio } from '../../../shared/util/color';
import { easingFn } from '../../../shared/util/easing';
import { SCENE_FONTS } from '../../engine/fonts';

type Token = { key: string; category: string; value: any; description: string };
const SECTIONS: { cat: string; title: string; desc: string }[] = [
  { cat: 'color', title: 'Colour', desc: 'Palette available to every scene and template. Contrast is checked against Night.' },
  { cat: 'typography', title: 'Typography', desc: 'Type roles used by text layers.' },
  { cat: 'gradient', title: 'Gradient presets', desc: 'Approved palettes offered to teams in the playground.' },
  { cat: 'duration', title: 'Motion duration', desc: 'Timing scale in seconds.' },
  { cat: 'easing', title: 'Easing', desc: 'Cubic-bezier curves for entrances and UI.' },
  { cat: 'spring', title: 'Spring physics', desc: 'Stiffness, damping and mass.' },
  { cat: 'intensity', title: 'Motion intensity', desc: 'Global default for how much things move.' },
  { cat: 'particles', title: 'Particle density', desc: 'Upper bound for particle counts in templates.' },
  { cat: 'behaviour', title: 'Animation behaviour', desc: 'Default loop and playback rules.' },
  { cat: 'accessibility', title: 'Accessibility defaults', desc: 'Reduced motion, contrast and flash limits.' },
];

export default function Brand() {
  const brandId = useSession((s) => s.brandId);
  const can = useCan();
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [saved, setSaved] = useState<Token[]>([]);
  const [meta, setMeta] = useState<{ name: string; version: number } | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const edit = can('brand.edit');
  const load = () => {
    if (!brandId) return;
    api(`/brands/${brandId}/tokens`).then((r) => { setTokens(r.tokens); setSaved(r.tokens); setMeta(r.brand); }).catch((e) => toast('danger', 'Brand unavailable', errorMessage(e)));
    api(`/brands/${brandId}/versions`).then((r) => setVersions(r.versions)).catch(() => {});
  };
  useEffect(load, [brandId]);
  const dirty = useMemo(() => JSON.stringify(tokens) !== JSON.stringify(saved), [tokens, saved]);
  if (!tokens) return <div className="page-inner"><div className="skel" style={{ height: 300 }} /></div>;
  const set = (key: string, value: any) => setTokens((t) => t!.map((x) => (x.key === key ? { ...x, value } : x)));
  const night = tokens.find((t) => t.key === 'color.night')?.value ?? '#000000';
  const save = async () => {
    setBusy(true);
    try { const r = await api(`/brands/${brandId}/tokens`, { method: 'PUT', body: { tokens, note } }); toast('ok', `Brand tokens v${r.version} saved`); invalidateBrand(); setNote(''); load(); } catch (e) { toast('danger', 'Tokens not saved', errorMessage(e)); } finally { setBusy(false); }
  };
  const restore = async (v: number) => { if (!confirm(`Restore token version ${v}? A new version is created; nothing is deleted.`)) return; await api(`/brands/${brandId}/versions/${v}/restore`, { method: 'POST' }); toast('ok', `Restored v${v}`); invalidateBrand(); load(); };

  return (
    <div className="page-inner">
      <div className="row between wrap" style={{ alignItems: 'flex-end' }}>
        <div><div className="eyebrow">Brand system · v{meta?.version}</div><h1 className="h1" style={{ marginTop: 8 }}>{meta?.name}</h1><p className="muted" style={{ margin: '6px 0 0', maxWidth: 560 }}>Motion tokens shared by every scene. Templates bind parameters to these tokens so teams stay on brand.</p></div>
        {edit && <div className="row"><input className="input" style={{ width: 240 }} placeholder="Describe this change" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Change note" /><button className="btn primary lg" disabled={!dirty || busy} onClick={save}>{busy ? <span className="spinner" /> : 'Save new version'}</button></div>}
      </div>
      {!edit && <div className="badge" style={{ marginTop: 12 }}><Icon name="lock" size={11} />Read-only — brand.edit required</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 260px', gap: 32, marginTop: 28 }}>
        <div className="col" style={{ gap: 36 }}>
          {SECTIONS.map((s) => {
            const list = tokens.filter((t) => t.category === s.cat);
            return (
              <section key={s.cat}>
                <div className="section-h"><div><h2 className="h2">{s.title}</h2><div className="faint" style={{ fontSize: 12.5, marginTop: 3 }}>{s.desc}</div></div>{edit && ['color', 'gradient', 'duration'].includes(s.cat) && <button className="btn sm" onClick={() => setAdding(s.cat)}><Icon name="plus" size={12} />Token</button>}</div>
                {!list.length && <div className="faint">No tokens.</div>}
                <div style={{ display: 'grid', gridTemplateColumns: s.cat === 'color' ? 'repeat(auto-fill, minmax(170px, 1fr))' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {list.map((t) => <TokenCard key={t.key} t={t} edit={edit} night={night} onChange={(v) => set(t.key, v)} onRemove={() => setTokens(tokens.filter((x) => x.key !== t.key))} />)}
                </div>
              </section>
            );
          })}
        </div>
        <aside className="col" style={{ gap: 8, position: 'sticky', top: 0, alignSelf: 'start' }}>
          <span className="eyebrow">Token versions</span>
          {versions.map((v) => (
            <div key={v.version} className="surface" style={{ padding: '8px 10px' }}>
              <div className="row between"><b style={{ fontWeight: 560 }}>v{v.version}</b><span className="faint mono" style={{ fontSize: 10.5 }}>{timeAgo(v.created_at)}</span></div>
              <div className="muted" style={{ fontSize: 12 }}>{v.note || '—'} · {v.author}</div>
              {edit && v.version !== meta?.version && <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => restore(v.version)}><Icon name="history" size={12} />Restore</button>}
            </div>
          ))}
        </aside>
      </div>
      <AddToken cat={adding} onClose={() => setAdding(null)} onAdd={(t) => { setTokens([...tokens, t]); setAdding(null); }} existing={tokens.map((t) => t.key)} />
    </div>
  );
}

function TokenCard({ t, edit, night, onChange, onRemove }: { t: Token; edit: boolean; night: string; onChange: (v: any) => void; onRemove: () => void }) {
  const name = t.key.split('.').slice(1).join('.');
  const head = <div className="row between"><span style={{ fontWeight: 560 }}>{name}</span>{edit && !['color.night', 'color.paper'].includes(t.key) && <button className="icon-btn sm" aria-label={`Remove ${t.key}`} onClick={onRemove}><Icon name="x" /></button>}</div>;
  switch (t.category) {
    case 'color': {
      const cr = contrastRatio(t.value, night);
      return (
        <div className="surface col" style={{ padding: 0, overflow: 'hidden', gap: 0 }}>
          <div style={{ height: 70, background: t.value }} />
          <div className="col" style={{ padding: 10, gap: 6 }}>{head}<ColorField label={t.key} value={t.value} onChange={onChange} disabled={!edit} />
            <span className={`badge ${cr >= 4.5 ? 'ok' : cr >= 3 ? 'warn' : ''}`} title="Contrast against Night background">{cr.toFixed(1)}:1 on night</span></div>
        </div>
      );
    }
    case 'gradient':
      return <div className="surface col" style={{ padding: 10 }}><div style={{ height: 54, borderRadius: 8, background: gradientCss(t.value, 100) }} />{head}{edit && <GradientEditor stops={t.value} onChange={onChange} />}</div>;
    case 'typography':
      return (
        <div className="surface col" style={{ padding: 12 }}>
          {head}
          <div style={{ fontFamily: `"${t.value.family}"`, fontWeight: t.value.weight, letterSpacing: `${t.value.tracking}em`, fontSize: 30, lineHeight: 1.1 }}>Motion system</div>
          <div className="pgrid3">
            <select className="select sm" aria-label="Font family" value={t.value.family} disabled={!edit} onChange={(e) => onChange({ ...t.value, family: e.target.value })}>{SCENE_FONTS.map((f) => <option key={f.family}>{f.family}</option>)}</select>
            <NumberField label="Weight" prefix="W" value={t.value.weight} step={100} min={100} max={900} disabled={!edit} onChange={(v) => onChange({ ...t.value, weight: v })} />
            <NumberField label="Tracking" prefix="T" value={t.value.tracking} step={0.005} min={-0.2} max={1} disabled={!edit} onChange={(v) => onChange({ ...t.value, tracking: v })} />
          </div>
        </div>
      );
    case 'easing':
      return <div className="surface col" style={{ padding: 12 }}>{head}<CurvePreview bezier={t.value} /><div className="pgrid2">{[0, 1, 2, 3].map((i) => <NumberField key={i} label={`Control ${i}`} prefix={['x1', 'y1', 'x2', 'y2'][i]} value={t.value[i]} step={0.01} min={i % 2 ? -1 : 0} max={i % 2 ? 2 : 1} disabled={!edit} onChange={(v) => onChange(t.value.map((x: number, j: number) => (j === i ? v : x)))} />)}</div></div>;
    case 'spring':
      return <div className="surface col" style={{ padding: 12 }}>{head}<SpringPreview s={t.value} /><div className="pgrid3">{(['stiffness', 'damping', 'mass'] as const).map((k) => <NumberField key={k} label={k} prefix={k[0].toUpperCase()} value={t.value[k]} step={k === 'mass' ? 0.1 : 1} min={k === 'mass' ? 0.1 : 0} max={2000} disabled={!edit} onChange={(v) => onChange({ ...t.value, [k]: v })} />)}</div></div>;
    case 'duration':
      return <div className="surface col" style={{ padding: 12 }}>{head}<DurationPreview d={t.value} /><div className="row"><Slider label={t.key} value={t.value} min={0.05} max={4} step={0.01} disabled={!edit} onChange={onChange} /><span className="mono" style={{ width: 52, textAlign: 'right' }}>{t.value.toFixed(2)}s</span></div></div>;
    case 'intensity':
      return <div className="surface col" style={{ padding: 12 }}>{head}<div className="row"><Slider label={t.key} value={t.value} min={0} max={1} disabled={!edit} onChange={onChange} /><span className="mono">{t.value.toFixed(2)}</span></div></div>;
    case 'particles':
      return <div className="surface col" style={{ padding: 12 }}>{head}<NumberField label={t.key} prefix="#" value={t.value} step={1000} min={0} max={200000} disabled={!edit} onChange={(v) => onChange(Math.round(v))} /></div>;
    default:
      return (
        <div className="surface col" style={{ padding: 12 }}>{head}<div className="faint" style={{ fontSize: 12 }}>{t.description}</div>
          {typeof t.value === 'boolean' ? <label className="checkbox"><input type="checkbox" checked={t.value} disabled={!edit} onChange={(e) => onChange(e.target.checked)} />{t.value ? 'On' : 'Off'}</label>
            : typeof t.value === 'number' ? <NumberField label={t.key} prefix="#" value={t.value} step={0.1} disabled={!edit} onChange={onChange} />
            : <select className="select sm" value={t.value} disabled={!edit} onChange={(e) => onChange(e.target.value)} aria-label={t.key}><option value="static">static frame</option><option value="reduced">reduced (fades)</option></select>}
        </div>
      );
  }
}

function CurvePreview({ bezier }: { bezier: number[] }) {
  const f = easingFn(bezier as any);
  const pts = Array.from({ length: 41 }, (_, i) => `${4 + (i / 40) * 92},${56 - f(i / 40) * 48}`).join(' ');
  return <svg viewBox="0 0 100 60" style={{ width: '100%', height: 60 }} aria-hidden><polyline points={pts} fill="none" stroke="var(--key)" strokeWidth="1.6" /></svg>;
}
function DurationPreview({ d }: { d: number }) {
  return <div style={{ height: 22, position: 'relative', background: 'var(--bg-1)', borderRadius: 6, overflow: 'hidden' }}><motion.div key={d} style={{ position: 'absolute', top: 5, width: 12, height: 12, borderRadius: 4, background: 'var(--text)' }} animate={{ left: ['4%', '90%'] }} transition={{ duration: d, repeat: Infinity, repeatType: 'reverse', ease: [0.2, 0, 0, 1], repeatDelay: 0.4 }} /></div>;
}
function SpringPreview({ s }: { s: { stiffness: number; damping: number; mass: number } }) {
  return <div style={{ height: 30, position: 'relative', background: 'var(--bg-1)', borderRadius: 6, overflow: 'hidden' }}><motion.div key={JSON.stringify(s)} style={{ position: 'absolute', top: 7, width: 16, height: 16, borderRadius: '50%', background: 'var(--accent)' }} initial={{ left: '4%' }} animate={{ left: '80%' }} transition={{ type: 'spring', ...s, repeat: Infinity, repeatType: 'reverse', repeatDelay: 0.6 }} /></div>;
}

function AddToken({ cat, onClose, onAdd, existing }: { cat: string | null; onClose: () => void; onAdd: (t: Token) => void; existing: string[] }) {
  const [name, setName] = useState('');
  const key = `${cat}.${name.trim().replace(/[^a-zA-Z0-9]+/g, '')}`;
  const value = cat === 'color' ? '#7c9cff' : cat === 'gradient' ? [{ color: '#111111', pos: 0 }, { color: '#7c9cff', pos: 1 }] : 0.4;
  const bad = !name.trim() ? 'Name required' : existing.includes(key) ? 'Key already exists' : null;
  return (
    <Modal open={!!cat} onClose={onClose} title={`New ${cat} token`} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!bad} onClick={() => { onAdd({ key, category: cat!, value, description: '' }); setName(''); }}>Add</button></>}>
      <Field label="Name" hint={`Key: ${key}`} error={name ? bad : null}><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. highlight" /></Field>
    </Modal>
  );
}
