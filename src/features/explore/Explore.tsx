import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { heroNavigate, preload } from '../../lib/transition';
import { MotionTile } from '../../components/MotionTile';
import { EmptyState, StatusBadge } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { deserializeScene } from '../../../shared/scene/serialize';
import { CHANNEL_FORMATS } from '../../../shared/formats';
import { hexToHsv } from '../../../shared/util/color';
import type { AssistantAnswer } from '../../../shared/assistant';

const HUES: [string, number, string][] = [['Red', 0, '#ff5a4f'], ['Orange', 28, '#ff9a3c'], ['Yellow', 55, '#f5d84a'], ['Green', 125, '#4fd17a'], ['Teal', 175, '#2fc6c0'], ['Blue', 220, '#4f86ff'], ['Purple', 272, '#9b6bff'], ['Pink', 320, '#ff6ac8']];
const hueBuckets = (colors: string[]) => {
  const out = new Set<string>();
  for (const c of colors) {
    const [h, s, v] = hexToHsv(c);
    if (s < 0.18 || v < 0.12) { if (v > 0.05) out.add('Mono'); continue; }
    const b = HUES.reduce((best, x) => { const d = Math.min(Math.abs(h - x[1]), 360 - Math.abs(h - x[1])); return d < best[1] ? [x[0], d] as [string, number] : best; }, ['', 999] as [string, number]);
    out.add(b[0]);
  }
  return out;
};

type Facets = { q: string; category: string; team: string; brand: string; channel: string; format: string; color: string; interaction: string; compat: string; status: string };
const EMPTY: Facets = { q: '', category: '', team: '', brand: '', channel: '', format: '', color: '', interaction: '', compat: '', status: '' };

export default function Explore() {
  const [data, setData] = useState<{ templates: any[]; teams: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sp, setSp] = useSearchParams();
  const [f, setF] = useState<Facets>(() => ({ ...EMPTY, ...Object.fromEntries([...sp.entries()].filter(([k]) => k in EMPTY)) }));
  const [ai, setAi] = useState<AssistantAnswer | null>(null);
  const nav = useNavigate();
  const channelParam = sp.get('channel');

  useEffect(() => {
    api('/library').then((d) => setData({ teams: d.teams, templates: d.templates.map((t: any) => {
      const doc = deserializeScene(t.doc);
      const aspect = doc.canvas.width / doc.canvas.height;
      return { ...t, doc, hues: hueBuckets(t.colors), shape: aspect > 1.1 ? 'Landscape' : aspect < 0.9 ? 'Portrait' : 'Square' };
    }) })).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    const next = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    setSp(next, { replace: true });
  }, [f, setSp]);

  const options = useMemo(() => {
    const t = data?.templates ?? [];
    return {
      category: [...new Set(t.map((x) => x.category))],
      brand: [...new Set(t.map((x) => x.brand_name).filter(Boolean))],
      interaction: [...new Set(t.map((x) => x.interaction))],
    };
  }, [data]);

  const results = useMemo(() => {
    if (!data) return [];
    const q = f.q.toLowerCase();
    const aiOrder = ai?.templates?.map((x) => x.id);
    let list = data.templates.filter((t) =>
      (!q || aiOrder || [t.name, t.description, t.category, ...(t.doc.meta.tags ?? [])].join(' ').toLowerCase().includes(q)) &&
      (!f.category || t.category === f.category) &&
      (!f.team || !t.visible_team_ids.length || t.visible_team_ids.includes(f.team)) &&
      (!f.brand || t.brand_name === f.brand) &&
      (!f.channel || !t.channels.length || t.channels.includes(f.channel)) &&
      (!f.format || t.shape === f.format) &&
      (!f.color || t.hues.has(f.color)) &&
      (!f.interaction || t.interaction === f.interaction) &&
      (!f.compat || t.compat[f.compat] === 'supported') &&
      (!f.status || t.status === f.status));
    if (aiOrder) list = list.filter((t) => aiOrder.includes(t.id)).sort((a, b) => aiOrder.indexOf(a.id) - aiOrder.indexOf(b.id));
    return list;
  }, [data, f, ai]);

  const ask = async () => {
    if (f.q.trim().split(/\s+/).length < 2) { setAi(null); return; }
    try { setAi(await api('/assistant', { body: { query: f.q } })); } catch { setAi(null); }
  };
  const set = (k: keyof Facets, v: string) => { setF((x) => ({ ...x, [k]: x[k] === v ? '' : v })); if (k === 'q') setAi(null); };
  const active = Object.entries(f).filter(([k, v]) => v && k !== 'q').length;
  const resolver = apiResolver();
  const openTo = (id: string) => `/play/${id}${channelParam ? `?format=${channelParam}` : ''}`;

  return (
    <div className="page-inner">
      <div className="row between wrap" style={{ alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div className="eyebrow">Approved library</div>
          <h1 className="h1" style={{ marginTop: 8 }}>Explore motion</h1>
          <p className="muted" style={{ margin: '6px 0 0', maxWidth: 520 }}>Brand-approved templates your team can customise. Everything here is governed: locked parameters stay on brand.</p>
        </div>
        <div className="row" style={{ width: 'min(440px, 100%)' }}>
          <div className="row grow surface" style={{ padding: '0 10px', height: 38, gap: 8 }}>
            <Icon name="search" />
            <input className="grow" style={{ background: 'none', border: 0, outline: 'none', fontSize: 13.5 }} placeholder="Search, or describe: “calm blue story”" value={f.q} onChange={(e) => set('q', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} aria-label="Search templates" />
            {f.q && <button className="icon-btn sm" onClick={() => { setF({ ...f, q: '' }); setAi(null); }} aria-label="Clear search"><Icon name="x" /></button>}
          </div>
          <button className="btn lg" onClick={ask} title="Natural-language search"><Icon name="wand" />Ask</button>
        </div>
      </div>
      {channelParam && <div className="badge info" style={{ marginTop: 14 }}>Creating for {CHANNEL_FORMATS.find((c) => c.id === channelParam)?.name}</div>}

      <div className="col" style={{ marginTop: 22, gap: 10 }} role="group" aria-label="Filters">
        <FacetRow label="Category" values={options.category} value={f.category} onPick={(v) => set('category', v)} />
        <FacetRow label="Channel" values={CHANNEL_FORMATS.map((c) => c.id)} labels={Object.fromEntries(CHANNEL_FORMATS.map((c) => [c.id, c.name]))} value={f.channel} onPick={(v) => set('channel', v)} />
        <div className="row wrap" style={{ gap: 18 }}>
          <FacetRow label="Format" values={['Portrait', 'Square', 'Landscape']} value={f.format} onPick={(v) => set('format', v)} />
          <div className="row" style={{ gap: 6 }}>
            <span className="eyebrow" style={{ width: 92 }}>Colour</span>
            {[...HUES, ['Mono', 0, '#9a9a9a'] as [string, number, string]].map(([n, , c]) => (
              <button key={n} className="swatch" style={{ background: c, width: 20, height: 20, borderRadius: '50%' }} aria-pressed={f.color === n} aria-label={n} title={n} onClick={() => set('color', n)} />
            ))}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 18 }}>
          <FacetRow label="Interaction" values={options.interaction} value={f.interaction} onPick={(v) => set('interaction', v)} />
          <FacetRow label="Export" values={['mp4', 'png', 'embed']} labels={{ mp4: 'MP4 ready', png: 'PNG ready', embed: 'WebGL embed' }} value={f.compat} onPick={(v) => set('compat', v)} />
          <FacetRow label="Status" values={['published', 'deprecated']} value={f.status} onPick={(v) => set('status', v)} />
          {data && data.teams.length > 0 && <FacetRow label="Team" values={data.teams.map((t) => t.id)} labels={Object.fromEntries(data.teams.map((t) => [t.id, t.name]))} value={f.team} onPick={(v) => set('team', v)} />}
          {options.brand.length > 1 && <FacetRow label="Brand" values={options.brand} value={f.brand} onPick={(v) => set('brand', v)} />}
        </div>
      </div>

      <AnimatePresence>
        {ai && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
            <div className="surface row" style={{ padding: '10px 12px', marginTop: 16, gap: 10 }}>
              <Icon name="wand" /><span className="grow">{ai.text}</span><button className="btn sm ghost" onClick={() => setAi(null)}>Show all</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="row between" style={{ margin: '26px 0 14px' }}>
        <span className="faint">{data ? `${results.length} of ${data.templates.length} templates` : 'Loading…'}</span>
        {active > 0 && <button className="btn sm ghost" onClick={() => setF({ ...EMPTY, q: f.q })}>Clear {active} filter{active > 1 ? 's' : ''}</button>}
      </div>
      {error && <EmptyState icon="alert" title="Library unavailable">{error}</EmptyState>}
      {!data && !error && <div className="mgrid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skel" style={{ aspectRatio: '4/5' }} />)}</div>}
      {data && !results.length && <EmptyState icon="search" title="No templates match">Try removing a filter, or ask the assistant with a description like “warm, energetic product launch”.</EmptyState>}
      <motion.div layout className="mgrid">
        <AnimatePresence initial={false}>
          {results.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}>
              <MotionTile id={t.id} doc={t.doc} assets={resolver} title={t.name} subtitle={<>{t.category} · v{t.version} · {t.params.filter((p: any) => !p.locked).length} editable</>}
                badges={<>{t.status === 'deprecated' ? <StatusBadge status="deprecated" /> : <span />}{t.interaction !== 'none' && <span className="badge"><Icon name="crosshair" size={10} />interactive</span>}</>}
                onHover={preload.playground} onOpen={(from) => heroNavigate(nav, openTo(t.id), from)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function FacetRow({ label, values, labels, value, onPick }: { label: string; values: string[]; labels?: Record<string, string>; value: string; onPick: (v: string) => void }) {
  if (!values.length) return null;
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <span className="eyebrow" style={{ width: 92 }}>{label}</span>
      {values.map((v) => <button key={v} className="chip" aria-pressed={value === v} onClick={() => onPick(v)}>{labels?.[v] ?? v}</button>)}
    </div>
  );
}
