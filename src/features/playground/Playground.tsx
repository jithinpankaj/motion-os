import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import type { SceneDocument } from '../../../shared/scene/schema';
import { applyParameters, defaultValues, type ParamValues } from '../../../shared/params';
import { adaptScene } from '../../../shared/adapt';
import { CHANNEL_FORMATS, formatById, type ChannelFormat } from '../../../shared/formats';
import type { AssistantAnswer } from '../../../shared/assistant';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useCan, useWorkspace } from '../../lib/session';
import { useReducedMotion } from '../../lib/prefs';
import { takePoster } from '../../lib/transition';
import { Clock } from '../../engine/clock';
import { MotionCanvas } from '../../components/MotionCanvas';
import { HubPreview } from '../../components/MotionCard';
import { FormatFrame } from '../../components/FormatFrame';
import { ParamControl } from '../../components/ParamControl';
import { ExportPanel } from '../../components/ExportPanel';
import { Icon } from '../../ui/Icon';
import { EmptyState, Modal, Segmented, StatusBadge, Tabs, Tip, toast } from '../../ui/controls';
import '../studio/studio.css';

type Hist = { past: ParamValues[]; present: ParamValues; future: ParamValues[] };

export default function Playground() {
  const { templateId } = useParams();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<{ template: any; version: any; versions: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hist, setHist] = useState<Hist | null>(null);
  const [compare, setCompare] = useState<string[] | null>(null);
  const [tab, setTab] = useState<'customise' | 'developer'>('customise');
  const [exporting, setExporting] = useState(false);
  const [motionMode, setMotionMode] = useState<'full' | 'reduced' | 'static'>('full');
  const [showSafe, setShowSafe] = useState(false);
  const [poster] = useState(() => (templateId ? takePoster(templateId) : null));
  const [posterOn, setPosterOn] = useState(!!poster);
  const clock = useMemo(() => new Clock(), [templateId]);
  const [playing, setPlaying] = useState(true);
  const ws = useWorkspace();
  const can = useCan();
  const nav = useNavigate();
  const reduced = useReducedMotion();
  const formatId = sp.get('format') ?? 'instagram-feed';
  const format = formatById(formatId) ?? CHANNEL_FORMATS[0];
  const lastCommit = useRef(0);

  useEffect(() => clock.subscribe(() => setPlaying(clock.playing)), [clock]);
  useEffect(() => { if (posterOn) { const t = setTimeout(() => setPosterOn(false), 500); return () => clearTimeout(t); } }, [posterOn]);
  useEffect(() => {
    api(`/templates/${templateId}`, { query: { version: sp.get('version') } }).then((r) => {
      setData(r);
      const saved = (() => { try { return JSON.parse(localStorage.getItem(`mos.play.${r.version.id}`) ?? 'null'); } catch { return null; } })();
      const base = { ...defaultValues(r.version.doc), ...(saved ?? {}) };
      // drop stale/invalid saved values silently by re-validating
      const { applied } = applyParameters(r.version.doc, base, { roles: ws?.roles ?? [] });
      setHist({ past: [], present: { ...defaultValues(r.version.doc), ...applied }, future: [] });
    }).catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, sp.get('version')]);

  const doc: SceneDocument | null = data?.version.doc ?? null;
  const assets = useMemo(() => (data ? apiResolver({ type: 'template_version', id: data.version.id }) : apiResolver()), [data]);
  const resolved = useMemo(() => (doc && hist ? applyParameters(doc, hist.present, { roles: ws?.roles ?? [] }) : null), [doc, hist, ws]);
  const adapted = useMemo(() => (resolved ? adaptScene(resolved.scene, format) : null), [resolved, format]);

  const change = useCallback((key: string, v: unknown) => {
    setHist((h) => {
      if (!h) return h;
      const now = performance.now();
      const merge = now - lastCommit.current < 700;
      lastCommit.current = now;
      const present = { ...h.present, [key]: v };
      return { past: merge ? h.past : [...h.past.slice(-80), h.present], present, future: [] };
    });
  }, []);
  useEffect(() => { if (hist && data) try { localStorage.setItem(`mos.play.${data.version.id}`, JSON.stringify(hist.present)); } catch {} }, [hist, data]);
  const undo = () => setHist((h) => (h && h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h));
  const redo = () => setHist((h) => (h && h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/input|textarea|select/i.test((e.target as HTMLElement).tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (e.key === ' ') { e.preventDefault(); clock.toggle(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [clock]);

  if (error) return <div className="empty" style={{ height: '100vh' }}><Icon name="alert" /><div className="h2">Template unavailable</div><div>{error}</div><Link className="btn" to="/explore">Back to library</Link></div>;
  if (!data || !doc || !hist || !resolved || !adapted) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><div className="spinner" /></div>;

  const groups = [...new Set(doc.exposed.map((p) => p.group || 'Settings'))];
  const deprecated = data.template.status === 'deprecated';
  const newer = data.template.publishedVersionId && data.template.publishedVersionId !== data.version.id;
  const setFormat = (id: string) => { const n = new URLSearchParams(sp); n.set('format', id); setSp(n, { replace: true }); };

  return (
    <div style={{ display: 'grid', gridTemplateRows: '52px 1fr', height: '100vh' }}>
      <div className="st-top" style={{ gap: 10, gridArea: 'auto' }}>
        <Tip label="Back to library"><button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><Icon name="chevronLeft" /></button></Tip>
        <div className="col" style={{ gap: 0 }}><span style={{ fontWeight: 580 }}>{data.template.name}</span><span className="faint mono" style={{ fontSize: 10.5 }}>v{data.version.version} · pinned · {data.template.category}</span></div>
        {deprecated && <StatusBadge status="deprecated" label="deprecated — prefer a newer template" />}
        {newer && <Link className="badge info" to={`/play/${templateId}?format=${formatId}`}>newer version available</Link>}
        <div className="grow" />
        <Tip label="Undo" kbd="⌘Z"><button className="icon-btn" onClick={undo} disabled={!hist.past.length} aria-label="Undo"><Icon name="undo" /></button></Tip>
        <Tip label="Redo" kbd="⇧⌘Z"><button className="icon-btn" onClick={redo} disabled={!hist.future.length} aria-label="Redo"><Icon name="redo" /></button></Tip>
        <button className="btn ghost" onClick={() => setHist({ past: [...hist.past, hist.present], present: defaultValues(doc), future: [] })}>Reset</button>
        {can('campaign.edit') && <button className="btn" onClick={() => nav(`/campaigns?new=1&template=${templateId}`)}><Icon name="campaigns" size={14} />Use in campaign</button>}
        <button className="btn primary" onClick={() => setExporting(true)} disabled={resolved.errors.length > 0}><Icon name="download" size={14} />Export</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0,1fr)', minHeight: 0 }}>
        <aside className="scroll" style={{ borderRight: '1px solid var(--line)', minHeight: 0 }} aria-label="Customise">
          {can('template.code') && <Tabs label="Mode" value={tab} onChange={setTab} tabs={[{ value: 'customise', label: 'Customise' }, { value: 'developer', label: 'Developer' }]} />}
          {tab === 'customise' ? (
            <div className="col" style={{ padding: 16, gap: 20 }}>
              {groups.map((g) => (
                <section key={g} className="col" style={{ gap: 14 }}>
                  <div className="eyebrow">{g}</div>
                  {doc.exposed.filter((p) => (p.group || 'Settings') === g).map((p) => (
                    <ParamControl key={p.key} p={p} value={hist.present[p.key]} roles={ws?.roles ?? []} assets={assets} onChange={(v) => change(p.key, v)} />
                  ))}
                </section>
              ))}
              {resolved.errors.length > 0 && <div className="field-error" role="alert">{resolved.errors.map((e) => e.message).join(' · ')}</div>}
              <Assistant versionId={data.version.id} values={hist.present} format={format.id} onApply={(k, v) => change(k, v)} />
              <section className="col" style={{ gap: 10 }}>
                <div className="eyebrow">Playback & accessibility</div>
                <div className="row"><button className="btn sm" onClick={() => clock.toggle()}><Icon name={playing ? 'pause' : 'play'} size={13} />{playing ? 'Pause' : 'Play'}</button><button className="btn sm" onClick={() => clock.restart()}><Icon name="restart" size={13} />Restart</button></div>
                <Segmented label="Motion preview" value={reduced && motionMode === 'full' ? 'reduced' : motionMode} onChange={setMotionMode} options={[{ value: 'full', label: 'Full motion' }, { value: 'reduced', label: 'Reduced' }, { value: 'static', label: 'Static' }]} />
                <div className="field-hint">Reduced-motion viewers see {doc.fallback.reducedMotion === 'static' ? `a static frame at ${doc.fallback.staticFrame}s` : 'fades without travel'} — set by the designer.</div>
              </section>
            </div>
          ) : <DeveloperPanel templateId={templateId!} versionId={data.version.id} />}
        </aside>
        <main style={{ position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'radial-gradient(circle at 50% 35%, #111115, #08080a 70%)' }}>
          <div className="row" style={{ padding: '10px 14px', gap: 8, flexWrap: 'wrap' }}>
            <div className="row wrap" style={{ gap: 5 }} role="radiogroup" aria-label="Channel">
              {CHANNEL_FORMATS.map((f) => <button key={f.id} role="radio" aria-checked={!compare && f.id === format.id} className="chip" aria-pressed={!compare && f.id === format.id} onClick={() => { setCompare(null); setFormat(f.id); }}>{f.name}</button>)}
            </div>
            <div className="grow" />
            <label className="checkbox"><input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} />Safe areas</label>
            <button className={`btn sm ${compare ? 'primary' : ''}`} onClick={() => setCompare(compare ? null : ['instagram-feed', 'instagram-story', 'linkedin-feed', 'website-hero'])}><Icon name="compare" size={13} />Compare formats</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <AnimatePresence mode="wait">
              {compare ? (
                <motion.div key="compare" className="scroll" style={{ position: 'absolute', inset: 0, padding: 20 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <CompareGrid scene={resolved.scene} assets={assets} formats={compare} setFormats={setCompare} onFocus={(id) => { setCompare(null); setFormat(id); }} showSafe={showSafe} />
                </motion.div>
              ) : (
                <motion.div key="single" style={{ position: 'absolute', inset: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <SinglePreview format={format} scene={adapted} clock={clock} assets={assets} motion={reduced && motionMode === 'full' ? 'reduced' : motionMode} showSafe={showSafe} poster={posterOn ? poster : null} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>
      <Modal open={exporting} onClose={() => setExporting(false)} title={`Export · ${format.name}`} subtitle="Your values are re-validated on the server against the pinned template version before rendering." wide>
        <ExportPanel doc={resolved.scene} channel={format.id} name={`${data.template.name} ${format.name}`} source={{ kind: 'template', templateId, versionId: data.version.id, values: hist.present }} time={clock.time} onQueued={() => setExporting(false)} />
      </Modal>
    </div>
  );
}

function SinglePreview({ format, scene, clock, assets, motion: mode, showSafe, poster }: { format: ChannelFormat; scene: SceneDocument; clock: Clock; assets: any; motion: any; showSafe: boolean; poster: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 600 });
  useEffect(() => { const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height })); ro.observe(box.current!); return () => ro.disconnect(); }, []);
  const chromeH = format.chrome === 'ig-post' ? 110 : format.chrome === 'linkedin' ? 130 : format.chrome.startsWith('web') ? 70 : format.chrome.startsWith('app') ? 160 : 0;
  const aspect = format.width / format.height;
  const w = Math.max(160, Math.min(size.w - 60, (size.h - 60 - chromeH) * aspect, format.chrome === 'app-popup' || format.chrome === 'app-banner' ? 380 : 2000));
  return (
    <div ref={box} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
      <div style={{ viewTransitionName: 'motion-hero' } as any}>
        <FormatFrame format={format} width={w} showSafe={showSafe}>
          <MotionCanvas doc={scene} clock={clock} assets={assets} motion={mode} label={`${format.name} preview`} style={{ position: 'absolute', inset: 0 }} />
          {poster && <img src={poster} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
        </FormatFrame>
      </div>
    </div>
  );
}

/** Side-by-side formats share one WebGL context; only the hovered one renders at full rate. */
function CompareGrid({ scene, assets, formats, setFormats, onFocus, showSafe }: { scene: SceneDocument; assets: any; formats: string[]; setFormats: (f: string[]) => void; onFocus: (id: string) => void; showSafe: boolean }) {
  const [hot, setHot] = useState<string | null>(null);
  const docs = useMemo(() => Object.fromEntries(formats.map((id) => [id, adaptScene(scene, formatById(id)!)])), [scene, formats]);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row wrap" style={{ gap: 5 }}>
        {CHANNEL_FORMATS.map((f) => <button key={f.id} className="chip" aria-pressed={formats.includes(f.id)} onClick={() => setFormats(formats.includes(f.id) ? formats.filter((x) => x !== f.id) : [...formats, f.id])}>{f.name}</button>)}
      </div>
      <div className="row wrap" style={{ gap: 24, alignItems: 'flex-start' }}>
        {formats.map((id) => {
          const f = formatById(id)!;
          const w = f.width / f.height > 2 ? 420 : f.width > f.height ? 340 : 230;
          return (
            <div key={id} className="col" style={{ gap: 8 }} onPointerEnter={() => setHot(id)} onPointerLeave={() => setHot(null)}>
              <div className="row between"><span style={{ fontWeight: 540 }}>{f.name}</span><span className="faint mono" style={{ fontSize: 10.5 }}>{f.width}×{f.height}</span></div>
              <FormatFrame format={f} width={w} showSafe={showSafe}>
                <HubPreview doc={docs[id]} assets={assets} active={hot === id} label={`${f.name} preview`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
              </FormatFrame>
              <button className="btn sm ghost" onClick={() => onFocus(id)}>Open {f.name}</button>
            </div>
          );
        })}
      </div>
      {!formats.length && <EmptyState icon="compare" title="Pick formats to compare" />}
      <div className="field-hint">Hover a preview to render it at full quality; others refresh at low resolution to save GPU.</div>
    </div>
  );
}

function Assistant({ versionId, values, format, onApply }: { versionId: string; values: ParamValues; format: string; onApply: (k: string, v: unknown) => void }) {
  const [q, setQ] = useState('');
  const [a, setA] = useState<AssistantAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async (query = q) => {
    if (!query.trim()) return;
    setBusy(true);
    try { setA(await api('/assistant', { body: { query, versionId, values, format } })); } catch (e) { toast('danger', 'Assistant unavailable', errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="surface col" style={{ padding: 12, gap: 8 }}>
      <div className="row"><Icon name="wand" size={14} /><span className="eyebrow">Assistant</span></div>
      <div className="row" style={{ gap: 6 }}>
        <input className="input sm" placeholder="“make it calmer”, “warmer”, “adapt for story”" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} aria-label="Ask the assistant" />
        <button className="btn sm" onClick={() => ask()} disabled={busy}>{busy ? <span className="spinner" /> : 'Ask'}</button>
      </div>
      <div className="row wrap" style={{ gap: 4 }}>{['make it calmer', 'more energetic', 'warmer', 'adapt for instagram story'].map((s) => <button key={s} className="chip" style={{ height: 22, fontSize: 11 }} onClick={() => { setQ(s); ask(s); }}>{s}</button>)}</div>
      {a && (
        <div className="col" style={{ gap: 6 }}>
          <div style={{ fontSize: 12.5 }}>{a.text}</div>
          {a.suggestions?.map((s) => (
            <div key={s.key} className="row" style={{ gap: 8, fontSize: 12 }}>
              <div className="grow"><b style={{ fontWeight: 560 }}>{s.label}</b> → <span className="mono">{typeof s.value === 'object' ? 'palette' : String(s.value)}</span><div className="faint">{s.reason}</div></div>
              <button className="btn sm" onClick={() => onApply(s.key, s.value)}>Apply</button>
            </div>
          ))}
          {a.notes?.map((n, i) => <div key={i} className="muted" style={{ fontSize: 12 }}>• {n}</div>)}
        </div>
      )}
    </section>
  );
}

function DeveloperPanel({ templateId, versionId }: { templateId: string; versionId: string }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api(`/templates/${templateId}/delivery`, { query: { version: versionId } }).then(setD).catch((e) => setErr(errorMessage(e))); }, [templateId, versionId]);
  if (err) return <div style={{ padding: 16 }} className="field-error">{err}</div>;
  if (!d) return <div style={{ padding: 16 }}><div className="skel" style={{ height: 200 }} /></div>;
  const json = JSON.stringify(d.config, null, 2);
  const snippet = `import { mountMotion } from './motion-embed';\n\nconst config = await fetch('/motion/${d.config.template.name.toLowerCase().replace(/\W+/g, '-')}.v${d.config.template.version}.json').then(r => r.json());\nconst motion = mountMotion(document.querySelector('#hero'), config, {\n  params: { /* only unlocked parameters */ },\n});\n// motion.pause(), motion.play(), motion.destroy()`;
  return (
    <div className="col" style={{ padding: 16, gap: 14 }}>
      <div><div className="eyebrow">Version-pinned delivery</div><div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>This config embeds v{d.config.template.version} exactly. It will not change when the template is updated.</div></div>
      {d.deprecated && <div className="badge warn">Template deprecated — plan a migration</div>}
      <div className="surface" style={{ padding: 10 }}>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 10px', margin: 0, fontSize: 12 }}>
          <dt className="faint">Layers</dt><dd className="mono" style={{ margin: 0 }}>{d.stats.layers}</dd>
          <dt className="faint">GPU particles</dt><dd className="mono" style={{ margin: 0 }}>{d.stats.particles.toLocaleString()}</dd>
          <dt className="faint">Meshes</dt><dd className="mono" style={{ margin: 0 }}>{d.stats.meshes}</dd>
          <dt className="faint">Config size</dt><dd className="mono" style={{ margin: 0 }}>{(d.stats.configBytes / 1024).toFixed(1)} KB</dd>
          <dt className="faint">Requires</dt><dd className="mono" style={{ margin: 0 }}>WebGL 2</dd>
          <dt className="faint">Reduced motion</dt><dd className="mono" style={{ margin: 0 }}>{d.config.accessibility.reducedMotion} @ {d.config.accessibility.staticFrame}s</dd>
        </dl>
      </div>
      <div className="col" style={{ gap: 4 }}>
        <span className="eyebrow">Compatibility</span>
        {d.compat.items.slice(0, 6).map((i: any, k: number) => <div key={k} className="row" style={{ fontSize: 12, gap: 6 }}><Icon name={i.level === 'ok' ? 'check' : 'alert'} size={12} />{i.feature}</div>)}
      </div>
      <div className="row between"><span className="eyebrow">Configuration</span><button className="btn sm" onClick={() => { navigator.clipboard.writeText(json); toast('ok', 'Configuration copied', `Pinned to v${d.config.template.version}`); }}><Icon name="copy" size={12} />Copy JSON</button></div>
      <pre className="mono scroll" style={{ margin: 0, maxHeight: 220, padding: 10, background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 10.5 }}>{json.slice(0, 1600)}{json.length > 1600 ? '\n…' : ''}</pre>
      <span className="eyebrow">Usage</span>
      <pre className="mono" style={{ margin: 0, padding: 10, background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 10.5, whiteSpace: 'pre-wrap' }}>{snippet}</pre>
      <Link className="btn" to={`/embed-example?template=${templateId}&version=${versionId}`}><Icon name="code" size={14} />Open working local example</Link>
      <div className="field-hint">Hosted CDN delivery and an npm React SDK are planned; today the runtime ships with this app (<span className="mono">src/embed/runtime.ts</span>).</div>
    </div>
  );
}
