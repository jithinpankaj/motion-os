import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useBrandKit } from '../../lib/brand';
import { useCan, useSession } from '../../lib/session';
import { importDesignFile, importFigma, pdfPages, detectKind, type ImportedDesign } from '../../lib/designImport';
import { MotionCanvas } from '../../components/MotionCanvas';
import { HubPreview } from '../../components/MotionCard';
import { ExportPanel } from '../../components/ExportPanel';
import { useExports } from '../../lib/exports';
import { Modal, Segmented, Switch, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { Clock } from '../../engine/clock';
import { ElementPicker } from '../brand/Elements';
import { formatById } from '../../../shared/formats';
import { PERSONALITIES, type Personality } from '../../../shared/brandImport';
import { buildMotion, freeSpot, isBackgroundLayer, MOTION_STYLES, type Design, type Recipe, type StyleKey } from '../../../shared/motionStyles';

type Step = 'start' | 'style' | 'tune' | 'done';
const FORMATS = ['original', 'instagram-feed', 'instagram-story', 'linkedin-feed', 'website-hero', 'presentation-slide'];
const formatLabel = (id: string) => (id === 'original' ? 'Design size' : formatById(id)?.name ?? id);

type CampaignState = { id: string; items: Record<string, { projectId: string; revision: number }>; editedElsewhere: boolean };

export default function Create() {
  const { id: editId, campaignId } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const { kit, loaded, brandId } = useBrandKit();
  const resolver = apiResolver();
  const [step, setStep] = useState<Step>('start');
  const [design, setDesign] = useState<Design | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [r, setR] = useState<Omit<Recipe, 'design'>>({ style: 'build', personality: 'balanced', headline: '', showLogo: false, keepBackground: null, duration: 8, format: 'original' });
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<{ id: string; revision: number; format: string; editedElsewhere?: boolean } | null>(null);
  // Channels this motion is made for. More than one makes it a campaign: one project per channel, saved together.
  const [channels, setChannels] = useState<string[]>(['original']);
  const [campaign, setCampaign] = useState<CampaignState | null>(null);
  const [saving, setSaving] = useState(false);
  const touchedPersonality = useRef(false);

  useEffect(() => { if (loaded && !touchedPersonality.current && !editId) setR((x) => ({ ...x, personality: kit.personality })); }, [loaded, kit.personality, editId]);

  // Reopen a motion made here: restore its recipe and go straight to the adjust step.
  useEffect(() => {
    if (!editId) return;
    api(`/projects/${editId}`).then((res) => {
      const rec = res.project.recipe as Recipe | null;
      if (!rec) { nav(`/studio/${editId}`, { replace: true }); return; }
      touchedPersonality.current = true;
      setDesign(rec.design);
      const { design: _d, ...rest } = rec;
      setR(rest);
      setChannels([rest.format]);
      setName(res.project.name);
      setSaved({ id: editId, revision: res.scene.revision, format: rest.format, editedElsewhere: res.project.recipeRevision !== res.scene.revision });
      setStep('tune');
    }).catch((e) => toast('danger', 'Could not open motion', errorMessage(e)));
  }, [editId, nav]);

  // Reopen a campaign: shared settings from its channels, under the campaign's brand.
  useEffect(() => {
    if (!campaignId) return;
    api(`/motion-campaigns/${campaignId}`).then((res) => {
      const list = res.channels as { id: string; format: string; recipe: Recipe | null; revision: number; recipeRevision: number }[];
      const rec = list.find((c) => c.recipe)?.recipe;
      if (!rec) { toast('danger', 'This campaign has no editable channels'); return; }
      touchedPersonality.current = true;
      const { design: d, ...rest } = rec;
      setDesign(d);
      setR({ ...rest, format: list[0].format });
      setChannels(list.map((c) => c.format));
      setName(res.campaign.name);
      setCampaign({ id: res.campaign.id, items: Object.fromEntries(list.map((c) => [c.format, { projectId: c.id, revision: c.revision }])), editedElsewhere: list.some((c) => c.recipeRevision !== c.revision) });
      const sess = useSession.getState();
      if (res.campaign.brandId && res.campaign.brandId !== sess.brandId && sess.workspaces.find((w) => w.id === sess.wsId)?.brands.some((b) => b.id === res.campaign.brandId)) {
        sess.setBrand(res.campaign.brandId);
        toast('info', `Switched to ${res.campaign.brandName}`, 'This campaign belongs to that brand.');
      }
      setStep('tune');
    }).catch((e) => toast('danger', 'Could not open campaign', errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const isCampaign = !!campaign || channels.length > 1;
  const docs = useMemo(() => Object.fromEntries(channels.map((f) => {
    const fmt = f === 'original' ? null : formatById(f);
    const label = name || design?.name || 'Brand motion';
    return [f, buildMotion({ design, brand: kit, style: r.style, personality: r.personality, headline: r.headline, showLogo: r.showLogo, keepBackground: r.keepBackground ?? undefined, duration: r.duration, width: fmt?.width, height: fmt?.height, name: isCampaign && fmt ? `${label} · ${fmt.name}` : label })];
  })), [design, kit, r.style, r.personality, r.headline, r.showLogo, r.keepBackground, r.duration, channels, name, isCampaign]);
  const doc = docs[r.format] ?? docs[channels[0]];

  const onImported = (d: ImportedDesign) => {
    setDesign(d);
    setNotes(d.notes);
    setName(d.name);
    setR((x) => ({ ...x, style: d.layers.length > 1 ? 'build' : 'zoom', format: 'original' }));
    setChannels(['original']);
    setStep('style');
  };
  const startWithBrand = () => {
    setDesign(null); setNotes([]); setName('Brand motion');
    setR((x) => ({ ...x, style: 'backdrop', headline: x.headline || 'Your message here', showLogo: !!kit.logoAssetId, format: 'instagram-feed' }));
    setChannels(['instagram-feed']);
    setStep('style');
  };

  const save = async (opts: { force?: boolean } = {}) => {
    if (!saved && !can('scene.create')) return;
    setSaving(true);
    const recipe: Recipe = { ...r, design: design ? { name: design.name, width: Math.round(design.width), height: Math.round(design.height), background: design.background, layers: design.layers } : null };
    try {
      if (!opts.force && (saved?.editedElsewhere || campaign?.editedElsewhere)) { setSaving(false); setConfirmOverwrite(true); return; }
      if (isCampaign) {
        const items = channels.map((f) => {
          const known = campaign?.items[f] ?? (saved && saved.format === f ? { projectId: saved.id, revision: saved.revision } : null);
          return { format: f, doc: docs[f], ...(known ? { projectId: known.projectId, baseRevision: known.revision } : {}) };
        });
        const body = { name: name.trim() || design?.name || 'Brand campaign', brandId: brandId ?? undefined, recipe, items };
        const out = campaign ? await api(`/motion-campaigns/${campaign.id}`, { method: 'PUT', body }) : await api('/motion-campaigns', { body });
        setCampaign({ id: out.id, items: Object.fromEntries(out.channels.map((c: any) => [c.format, { projectId: c.projectId, revision: c.revision }])), editedElsewhere: false });
        setSaved(null);
        window.history.replaceState(null, '', `/create/campaign/${out.id}`);
      } else if (saved) {
        const out = await api(`/projects/${saved.id}/recipe`, { method: 'PUT', body: { recipe, doc, baseRevision: saved.revision } });
        setSaved({ id: saved.id, revision: out.revision, format: saved.format });
      } else {
        const out = await api('/projects', { body: { name: doc.meta.name, scene: doc, recipe, brandId: brandId ?? undefined } });
        setSaved({ id: out.id, revision: 1, format: r.format });
        window.history.replaceState(null, '', `/create/${out.id}`);
      }
      setStep('done');
    } catch (e) {
      toast('danger', 'Could not save', e instanceof ApiError && e.status === 409 ? e.message : errorMessage(e));
    } finally { setSaving(false); }
  };
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  if (!can('scene.create') && !editId && !campaignId) {
    return <div className="page-inner"><h1 className="h1">Create</h1><p className="lead">Your role can browse and export approved motion, but not create new motion. Ask a workspace admin for the Marketing or Designer role.</p><Link className="btn" to="/library" style={{ marginTop: 16 }}>Open the library</Link></div>;
  }

  const steps: { key: Step; label: string }[] = [{ key: 'start', label: 'Your design' }, { key: 'style', label: 'Make it move' }, { key: 'tune', label: 'Adjust' }, { key: 'done', label: 'Share' }];
  const at = steps.findIndex((s) => s.key === step);
  return (
    <div className="page-inner" style={{ paddingTop: 28 }}>
      <div className="row between wrap" style={{ gap: 16, alignItems: 'center' }}>
        <div>
          <div className="eyebrow">Create</div>
          <h1 className="h1" style={{ marginTop: 8 }}>{step === 'start' ? 'Bring your design to life' : step === 'style' ? 'Pick how it moves' : step === 'tune' ? 'Make it yours' : 'Ready to share'}</h1>
        </div>
        <nav className="steps" aria-label="Progress">
          {steps.map((s, i) => (
            <span key={s.key} className="row" style={{ gap: 6 }}>
              {i > 0 && <span className="step-sep" />}
              <button className={`step ${i < at ? 'done' : ''}`} aria-current={i === at ? 'step' : undefined} disabled={i >= at || (s.key === 'start' && !!(editId || campaignId))} onClick={() => setStep(s.key)}>
                <span className="n">{i < at ? <Icon name="check" size={11} /> : i + 1}</span>{s.label}
              </button>
            </span>
          ))}
        </nav>
      </div>

      <div style={{ marginTop: 26 }}>
        {step === 'start' && <StartStep onImported={onImported} onBrand={startWithBrand} />}
        {step === 'style' && (
          <StyleStep design={design} kit={kit} r={r} name={name} notes={notes} resolver={resolver}
            onPersonality={(p) => { touchedPersonality.current = true; setR((x) => ({ ...x, personality: p })); }}
            onPick={(style) => { setR((x) => ({ ...x, style })); setStep('tune'); }} />
        )}
        {step === 'tune' && (
          <TuneStep design={design} setDesign={setDesign} kit={kit} r={r} setR={setR} name={name} setName={setName} doc={doc} docs={docs} resolver={resolver}
            channels={channels} setChannels={setChannels} isCampaign={isCampaign} campaignSaved={!!campaign}
            saving={saving} onSave={() => save()} isUpdate={!!saved || !!campaign} editedElsewhere={!!saved?.editedElsewhere || !!campaign?.editedElsewhere} projectId={saved?.id}
            onPersonality={() => { touchedPersonality.current = true; }} />
        )}
        {step === 'done' && campaign && <CampaignDone campaignId={campaign.id} name={name || 'Campaign'} docs={docs} channels={channels} resolver={resolver} onEdit={() => setStep('tune')} />}
        {step === 'done' && saved && <DoneStep doc={doc} resolver={resolver} projectId={saved.id} name={doc.meta.name} onEdit={() => setStep('tune')} onNew={() => { nav('/create'); window.location.reload(); }} />}
      </div>

      <Modal open={confirmOverwrite} onClose={() => setConfirmOverwrite(false)} title="Replace advanced edits?" subtitle="This motion (or a channel of this campaign) was changed in the advanced editor after it was made here. Saving from Create rebuilds it from these settings and replaces those changes (older versions stay in its history)."
        footer={<><button className="btn ghost" onClick={() => setConfirmOverwrite(false)}>Cancel</button>{saved && <Link className="btn" to={`/studio/${saved.id}`}>Open advanced editor</Link>}<button className="btn primary" onClick={() => { setConfirmOverwrite(false); save({ force: true }); }}>Replace and save</button></>}>
        <div />
      </Modal>
    </div>
  );
}

// ---------------- Step 1: design ----------------

function StartStep({ onImported, onBrand }: { onImported: (d: ImportedDesign) => void; onBrand: () => void }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ file: File; thumbs: string[]; count: number } | null>(null);
  const [figma, setFigma] = useState('');
  const [figmaNeedsToken, setFigmaNeedsToken] = useState(false);

  const run = async (file: File, page?: number) => {
    setError(null);
    setBusy('Reading your file…');
    try {
      if (page === undefined && (await detectKind(file)) === 'pdf') {
        const p = await pdfPages(file);
        if (p.count > 1) { setPdf({ file, ...p }); setBusy(null); return; }
      }
      const d = await importDesignFile(file, { page, progress: setBusy });
      setPdf(null);
      onImported(d);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const runFigma = async () => {
    setError(null);
    setBusy('Fetching your frame from Figma…');
    try { onImported(await importFigma(figma)); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'figma_not_connected') setFigmaNeedsToken(true);
      else setError(errorMessage(e));
    } finally { setBusy(null); }
  };

  if (pdf) {
    return (
      <div className="panel" style={{ padding: 20 }}>
        <div className="row between"><div><div className="h3">Which page?</div><div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{pdf.file.name} has {pdf.count} pages{pdf.count > 12 ? ' (first 12 shown)' : ''}.</div></div><button className="btn ghost" onClick={() => setPdf(null)}>Back</button></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12, marginTop: 16 }}>
          {pdf.thumbs.map((t, i) => <button key={i} className="element" style={{ aspectRatio: 'auto', padding: 6, flexDirection: 'column', gap: 6 }} disabled={!!busy} onClick={() => run(pdf.file, i + 1)}><img src={t} alt={`Page ${i + 1}`} /><span className="faint" style={{ fontSize: 11 }}>Page {i + 1}</span></button>)}
        </div>
        {busy && <div className="row" style={{ marginTop: 14 }}><span className="spinner" /><span className="muted">{busy}</span></div>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <p className="lead" style={{ marginTop: 0, marginBottom: 18 }}>Upload a finished design — a post, poster, banner or slide. Layered files (SVG, PDF, Illustrator, Photoshop, Figma) are split into parts so each one can move on its own.</p>
      <label className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) run(f); }}>
        {busy ? <><span className="spinner" /><div className="muted">{busy}</div></> : <>
          <Icon name="upload" size={26} />
          <div className="big">Drop your design here, or click to choose</div>
          <div className="formats">{['PNG', 'JPG', 'WEBP', 'SVG', 'PDF', 'AI', 'PSD'].map((f) => <span key={f}>{f}</span>)}</div>
          <div className="faint" style={{ fontSize: 12 }}>Processed on this device. Only the finished layers are uploaded.</div>
        </>}
        <input type="file" aria-label="Upload a design" disabled={!!busy} accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.pdf,.ai,.psd,image/*,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }} />
      </label>
      {error && <div className="field-error" role="alert" style={{ marginTop: 12 }}>{error}</div>}

      <div className="or">or</div>
      <div className="panel" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: '#1e1e1e', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>F</div>
          <div className="grow"><div style={{ fontWeight: 560 }}>Import a Figma frame</div><div className="faint" style={{ fontSize: 12 }}>Right-click the frame → Copy/Paste as → Copy link to selection</div></div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input className="input grow" placeholder="https://www.figma.com/design/…?node-id=…" value={figma} onChange={(e) => setFigma(e.target.value)} aria-label="Figma frame link" />
          <button className="btn" disabled={!figma.trim() || !!busy} onClick={runFigma}>Import</button>
        </div>
        {figmaNeedsToken && <FigmaConnect onConnected={() => { setFigmaNeedsToken(false); runFigma(); }} />}
      </div>

      <div className="or">or</div>
      <button className="action-card" style={{ minHeight: 0, width: '100%', flexDirection: 'row', alignItems: 'center' }} onClick={onBrand}>
        <span className="ic"><Icon name="brand" /></span>
        <span className="col grow" style={{ gap: 2 }}><span className="t" style={{ fontSize: 15 }}>No design yet? Start from your brand</span><span className="d">A motion built from your brand colours, logo and message.</span></span>
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

export function FigmaConnect({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const can = useCan();
  if (!can('integration.manage')) return <div className="note warn" style={{ marginTop: 12 }}>Figma isn’t connected for this workspace. Ask an admin to add a Figma access token in Settings → Connections.</div>;
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await api('/connections/figma', { method: 'PUT', body: { token } }); toast('ok', 'Figma connected', `Signed in as ${r.account}`); onConnected(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="col" style={{ gap: 10, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <div style={{ fontWeight: 560 }}>Connect Figma once for your workspace</div>
      <ol className="howto">
        <li>In Figma, open <b>Settings → Security → Personal access tokens</b>.</li>
        <li>Generate a token with <code>File content: Read-only</code>.</li>
        <li>Paste it here. It’s stored encrypted and only used to read frames you import.</li>
      </ol>
      <div className="row"><input className="input grow" type="password" placeholder="figd_…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Figma access token" /><button className="btn primary" disabled={busy || token.trim().length < 20} onClick={go}>{busy ? <span className="spinner" /> : 'Connect'}</button></div>
      {err && <div className="field-error" role="alert">{err}</div>}
    </div>
  );
}

// ---------------- Step 2: style ----------------

function StyleStep({ design, kit, r, name, notes, resolver, onPick, onPersonality }: { design: Design | null; kit: any; r: Omit<Recipe, 'design'>; name: string; notes: string[]; resolver: any; onPick: (s: StyleKey) => void; onPersonality: (p: Personality) => void }) {
  const [hot, setHot] = useState<StyleKey | null>(null);
  const styles = MOTION_STYLES.filter((s) => design || !s.needsDesign);
  const fmt = r.format === 'original' ? null : formatById(r.format);
  const docs = useMemo(() => Object.fromEntries(styles.map((s) => [s.key, buildMotion({ design, brand: kit, style: s.key, personality: r.personality, headline: r.headline, showLogo: r.showLogo, duration: r.duration, width: fmt?.width, height: fmt?.height, name })])), [design, kit, r.personality, r.headline, r.showLogo, r.duration, fmt, name]);
  const aspect = (docs[styles[0].key] as any).canvas.width / (docs[styles[0].key] as any).canvas.height;
  return (
    <div className="col" style={{ gap: 20 }}>
      {design && <div className="callout"><Icon name="layers" /><div className="grow"><div style={{ fontWeight: 560 }}>{design.layers.length > 1 ? `Found ${design.layers.length} parts in “${design.name}”` : `“${design.name}” imported as one piece`}</div>{notes.map((n, i) => <div key={i} className="note">{n}</div>)}</div></div>}
      <div className="col" style={{ gap: 8 }}>
        <span className="label">Motion personality {kit.personality === r.personality && <span className="faint">· from your brand kit</span>}</span>
        <div className="row wrap" style={{ gap: 6 }} role="radiogroup" aria-label="Motion personality">
          {PERSONALITIES.map((p) => <button key={p.key} className="chip" role="radio" aria-checked={r.personality === p.key} aria-pressed={r.personality === p.key} title={p.description} onClick={() => onPersonality(p.key)}>{p.label}</button>)}
        </div>
      </div>
      <div className="style-grid" role="radiogroup" aria-label="Motion style">
        {styles.map((s) => (
          <button key={s.key} className="style-card" role="radio" aria-checked={r.style === s.key} onClick={() => onPick(s.key)} onPointerEnter={() => setHot(s.key)} onPointerLeave={() => setHot(null)} onFocus={() => setHot(s.key)}>
            <div className="media" style={{ aspectRatio: String(Math.min(1.8, Math.max(0.56, aspect))) }}>
              <HubPreview doc={docs[s.key]} assets={resolver} active={hot === s.key || r.style === s.key} label={`${s.name} preview`} />
            </div>
            <span className="t">{s.name}</span>
            <span className="d">{s.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- Step 3: tune ----------------

function TuneStep(p: {
  design: Design | null; setDesign: (d: Design | null) => void; kit: any; r: Omit<Recipe, 'design'>; setR: React.Dispatch<React.SetStateAction<Omit<Recipe, 'design'>>>;
  name: string; setName: (s: string) => void; doc: any; docs: Record<string, any>; resolver: any; saving: boolean; onSave: () => void; isUpdate: boolean; editedElsewhere: boolean; projectId?: string; onPersonality: () => void;
  channels: string[]; setChannels: (c: string[]) => void; isCampaign: boolean; campaignSaved: boolean;
}) {
  const { design, setDesign, kit, r, setR, doc } = p;
  const clock = useMemo(() => new Clock(), []);
  const [picker, setPicker] = useState(false);
  const [removed, setRemoved] = useState(false);
  // One channel = a single motion; several = a campaign. "Design size" only works on its own.
  const toggleChannel = (f: string) => {
    if (f === 'original') { p.setChannels(['original']); set('format', 'original'); return; }
    const cur = p.channels.filter((c) => c !== 'original');
    const next = cur.includes(f) ? cur.filter((c) => c !== f) : [...cur, f];
    if (!next.length) return;
    if (cur.includes(f)) setRemoved(true);
    p.setChannels(next);
    set('format', cur.includes(f) ? (r.format === f ? next[0] : r.format) : f);
  };
  const set = <K extends keyof typeof r>(k: K, v: (typeof r)[K]) => setR((x) => ({ ...x, [k]: v }));
  const styles = MOTION_STYLES.filter((s) => design || !s.needsDesign);
  const hasBg = !!design && design.layers.some((l) => isBackgroundLayer(l, design.width, design.height));
  const backdrop = r.style === 'backdrop' || r.style === 'pop' || r.style === 'headline' || !design;
  const ratio = doc.canvas.width / doc.canvas.height;
  const addElement = (e: { id: string; name: string; width: number; height: number }) => {
    const base: Design = design ?? { name: p.name || 'Brand motion', width: doc.canvas.width, height: doc.canvas.height, background: null, layers: [] };
    const min = Math.min(base.width, base.height);
    const long = 0.32;
    const w = e.width >= e.height ? long : (long * e.width) / e.height, h = e.width >= e.height ? (long * e.height) / e.width : long;
    const lw = (w * Math.min(doc.canvas.width, doc.canvas.height)) / min, lh = (h * Math.min(doc.canvas.width, doc.canvas.height)) / min;
    // Drop it into the emptiest spot of the design (backgrounds don't count as occupied).
    const occupied = base.layers.filter((l) => !isBackgroundLayer(l, base.width, base.height));
    const grid = [0.2, 0.5, 0.8].flatMap((y) => [0.22, 0.5, 0.78].map((x) => ({ x, y })));
    const spot = freeSpot(occupied, base.width, base.height, { w: (lw * min) / base.width, h: (lh * min) / base.height }, grid);
    setDesign({ ...base, layers: [...base.layers, { assetId: e.id, name: e.name, x: spot.x, y: spot.y, w: lw, h: lh }] });
  };
  return (
    <div className="create-layout">
      <div className="col" style={{ gap: 12, minWidth: 0 }}>
        <div className="stage">
          <div className="stage-frame" style={{ aspectRatio: String(ratio), width: ratio >= 1 ? '100%' : undefined, height: ratio < 1 ? 'min(calc(100vh - 260px), 720px)' : undefined }}>
            <MotionCanvas doc={doc} clock={clock} assets={p.resolver} label={`${doc.meta.name} preview`} style={{ position: 'absolute', inset: 0 }} />
          </div>
        </div>
        {p.channels.length > 1 && (
          <div className="channel-strip" role="radiogroup" aria-label="Preview channel">
            {p.channels.map((f) => {
              const d = p.docs[f], fm = formatById(f)!;
              return (
                <button key={f} role="radio" aria-checked={r.format === f} className="channel-thumb" onClick={() => set('format', f)}>
                  <span className="frame" style={{ aspectRatio: `${fm.width} / ${fm.height}` }}><HubPreview doc={d} assets={p.resolver} active={false} label={`${fm.name} preview`} /></span>
                  <span className="cl">{fm.name}</span><span className="faint mono" style={{ fontSize: 9.5 }}>{fm.width}×{fm.height}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="tune">
        <div className="tune-group"><span className="label">{p.isCampaign ? 'Campaign name' : 'Name'}</span><input className="input" value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder={p.isCampaign ? 'Spring launch' : 'Spring launch post'} aria-label={p.isCampaign ? 'Campaign name' : 'Motion name'} /></div>
        <div className="tune-group">
          <span className="label">Motion style</span>
          <div className="row wrap" style={{ gap: 6 }}>{styles.map((s) => <button key={s.key} className="chip" aria-pressed={r.style === s.key} title={s.description} onClick={() => set('style', s.key)}>{s.name}</button>)}</div>
        </div>
        <div className="tune-group">
          <span className="label">Message <span className="faint">(optional)</span></span>
          <input className="input" value={r.headline} maxLength={120} placeholder="Add a headline in your brand font" onChange={(e) => set('headline', e.target.value)} aria-label="Headline" />
        </div>
        <div className="tune-group">
          <span className="label">Personality</span>
          <div className="persona" role="radiogroup" aria-label="Motion personality">
            {PERSONALITIES.map((x) => <button key={x.key} role="radio" aria-checked={r.personality === x.key} onClick={() => { p.onPersonality(); set('personality', x.key); }}><span className="pn">{x.label}{kit.personality === x.key && <span className="badge" style={{ fontSize: 9.5 }}>brand</span>}</span><span className="pd">{x.description}</span></button>)}
          </div>
        </div>
        <div className="tune-group">
          <span className="label">Where will it go? <span className="faint">Pick several to make a campaign</span></span>
          <div className="row wrap" style={{ gap: 6 }}>{FORMATS.filter((f) => f !== 'original' || (design && !p.campaignSaved)).map((f) => <button key={f} className="chip" aria-pressed={p.channels.includes(f)} onClick={() => toggleChannel(f)}>{p.channels.includes(f) && f !== 'original' && p.channels.length > 1 && <Icon name="check" size={11} />}{formatLabel(f)}{f !== 'original' && <span className="faint mono" style={{ fontSize: 9.5 }}>{formatById(f)!.width}×{formatById(f)!.height}</span>}</button>)}</div>
          {p.isCampaign && <span className="note">{p.channels.length} sizes from one design, saved together under your current brand. Your design is fitted into each frame and its background fills the rest — check each size in the strip.</span>}
          {p.campaignSaved && removed && <span className="note warn">Sizes you removed are moved to the bin when you save.</span>}
        </div>
        <div className="tune-group">
          <span className="label">Length</span>
          <Segmented value={String(r.duration)} onChange={(v) => set('duration', Number(v))} options={[{ value: '5', label: '5 s' }, { value: '8', label: '8 s' }, { value: '12', label: '12 s' }]} label="Length" />
        </div>
        <div className="tune-group">
          <span className="label">Parts {design && <span className="faint">({design.layers.length})</span>}</span>
          {design && design.layers.length > 0 && (
            <div className="col" style={{ gap: 4, maxHeight: 180, overflow: 'auto' }}>
              {design.layers.map((l, i) => (
                <div key={l.assetId + i} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                  <span className="ellipsis grow">{l.name}</span>
                  {isBackgroundLayer(l, design.width, design.height) && <span className="badge">background</span>}
                  <button className="btn ghost icon sm" aria-label={`Remove ${l.name}`} onClick={() => setDesign({ ...design, layers: design.layers.filter((_, j) => j !== i) })}><Icon name="x" size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setPicker(true)}><Icon name="plus" />Add an element</button>
        </div>
        <div className="tune-group">
          <Switch checked={r.showLogo} onChange={(v) => set('showLogo', v)} label="Show my logo" disabled={!kit.logoAssetId} />
          {!kit.logoAssetId && <span className="note">Add a logo in <Link to="/brand">Brand kit</Link> to use it here.</span>}
          {hasBg && backdrop && <Switch checked={r.keepBackground ?? false} onChange={(v) => set('keepBackground', v)} label="Keep my design’s background" />}
        </div>
        {p.editedElsewhere && <div className="note warn">This motion was edited in the advanced editor. Saving here rebuilds it from these settings.</div>}
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button className="btn primary lg grow" disabled={p.saving} onClick={p.onSave}>{p.saving ? <span className="spinner" /> : p.isCampaign ? (p.isUpdate ? `Save campaign · ${p.channels.length} sizes` : `Save campaign · ${p.channels.length} sizes`) : p.isUpdate ? 'Save changes' : 'Save motion'}</button>
        </div>
        {p.projectId && <Link to={`/studio/${p.projectId}`} className="faint" style={{ fontSize: 12 }}>Open in advanced editor (layers, timeline, keyframes) →</Link>}
      </div>
      <ElementPicker open={picker} onClose={() => setPicker(false)} brand={kit} onPick={(e) => addElement(e)} />
    </div>
  );
}

// ---------------- Step 4: share ----------------

function DoneStep({ doc, resolver, projectId, name, onEdit, onNew }: { doc: any; resolver: any; projectId: string; name: string; onEdit: () => void; onNew: () => void }) {
  const clock = useMemo(() => new Clock(), []);
  const [exporting, setExporting] = useState(false);
  const can = useCan();
  const ratio = doc.canvas.width / doc.canvas.height;
  return (
    <div className="create-layout">
      <div className="stage">
        <div className="stage-frame" style={{ aspectRatio: String(ratio), width: ratio >= 1 ? '100%' : undefined, height: ratio < 1 ? 'min(calc(100vh - 260px), 720px)' : undefined }}>
          <MotionCanvas doc={doc} clock={clock} assets={resolver} label={`${name} preview`} style={{ position: 'absolute', inset: 0 }} />
        </div>
      </div>
      <div className="tune">
        <div className="callout"><Icon name="check" /><div className="grow"><div style={{ fontWeight: 600 }}>Saved to your library</div><div className="note">“{name}” · {doc.canvas.width}×{doc.canvas.height} · {doc.canvas.duration}s loop</div></div></div>
        {can('export.create') && <button className="action-card" style={{ minHeight: 0 }} onClick={() => setExporting(true)}><span className="ic"><Icon name="download" /></span><span className="t" style={{ fontSize: 15 }}>Download</span><span className="d">MP4 video, PNG or WebP still — rendered in the background.</span></button>}
        {can('analytics.view') && <Link to={`/analytics?motion=${projectId}`} className="action-card" style={{ minHeight: 0 }}><span className="ic"><Icon name="chart" /></span><span className="t" style={{ fontSize: 15 }}>Track how it performs</span><span className="d">Link the post or campaign link once it’s live and see results in Analytics.</span></Link>}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn grow" onClick={onEdit}><Icon name="wand" />Adjust</button>
          <button className="btn grow" onClick={onNew}><Icon name="plus" />Make another</button>
        </div>
        <Link to={`/studio/${projectId}`} className="faint" style={{ fontSize: 12 }}>Open in advanced editor →</Link>
      </div>
      <Modal open={exporting} onClose={() => setExporting(false)} title={`Download “${name}”`} wide>
        <ExportPanel doc={doc} source={{ kind: 'project', id: projectId }} name={name} onQueued={() => setExporting(false)} />
      </Modal>
    </div>
  );
}


// ---------------- Step 4 (campaign): export every size, download together, track as a group ----------------

type ChannelInfo = { id: string; format: string; doc: any; export: { at: string; upToDate: boolean; format: string; url: string | null } | null };

function CampaignDone({ campaignId, name, docs, channels, resolver, onEdit }: { campaignId: string; name: string; docs: Record<string, any>; channels: string[]; resolver: any; onEdit: () => void }) {
  const can = useCan();
  const create = useExports((s) => s.create);
  const jobs = useExports((s) => s.jobs);
  const [info, setInfo] = useState<ChannelInfo[] | null>(null);
  const [fmt, setFmt] = useState<'mp4' | 'png'>('mp4');
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const load = () => api(`/motion-campaigns/${campaignId}`).then((r) => setInfo(r.channels)).catch(() => {});
  useEffect(() => { load(); }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Refresh statuses while this campaign's exports are running.
  const running = jobs.filter((j: any) => j.source?.kind === 'project' && info?.some((c) => c.id === j.source.id) && (j.status === 'queued' || j.status === 'processing'));
  const runningKey = running.map((j: any) => j.id).join();
  useEffect(() => { load(); }, [runningKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportAll = async () => {
    if (!info) return;
    setBusy(true);
    try {
      for (const c of info) {
        const d = c.doc;
        const settings = fmt === 'mp4'
          ? { width: d.canvas.width, height: d.canvas.height, fps: d.canvas.fps, duration: d.canvas.duration, startTime: 0, loops: 1, quality: 'high', background: null }
          : { width: d.canvas.width, height: d.canvas.height, time: d.export.posterTime, background: 'scene' };
        await create({ source: { kind: 'project', id: c.id }, format: fmt, settings, channel: c.format, name: d.meta.name });
      }
      toast('info', `${info.length} exports queued`, 'They render one after another in the background.');
    } catch (e) { toast('danger', 'Export not started', errorMessage(e)); } finally { setBusy(false); }
  };
  const downloadZip = async () => {
    setZipping(true);
    try {
      const blob = await api<Blob>(`/motion-campaigns/${campaignId}/package`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name.replace(/[^A-Za-z0-9._-]+/g, '-') || 'campaign'}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) { toast('danger', 'Nothing to download yet', errorMessage(e)); } finally { setZipping(false); }
  };
  const ready = info?.filter((c) => c.export?.upToDate).length ?? 0;
  const progressOf = (id: string) => running.find((j: any) => j.source.id === id);
  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="callout"><Icon name="check" /><div className="grow"><div style={{ fontWeight: 600 }}>Campaign saved — {channels.length} sizes</div><div className="note">“{name}” · every size is its own motion in the Library, grouped under this campaign and your current brand.</div></div></div>
      <div className="channel-strip" style={{ gap: 14 }}>
        {channels.map((f) => { const fm = formatById(f)!; return (
          <div key={f} className="channel-thumb" style={{ cursor: 'default' }}>
            <span className="frame" style={{ aspectRatio: `${fm.width} / ${fm.height}`, height: 180 }}><HubPreview doc={docs[f]} assets={resolver} active label={`${fm.name} preview`} /></span>
            <span className="cl">{fm.name}</span>
          </div>
        ); })}
      </div>
      <div className="kit">
        <section className="panel kit-card">
          <h3>Export every size</h3>
          <Segmented value={fmt} onChange={setFmt} options={[{ value: 'mp4', label: 'MP4 video' }, { value: 'png', label: 'PNG still' }]} label="Export format" />
          <div className="col" style={{ gap: 8 }}>
            {(info ?? []).map((c) => {
              const fm = formatById(c.format), job = progressOf(c.id);
              return (
                <div key={c.id} className="ch-status">
                  <span className={`dot ${c.export?.upToDate ? 'ok' : ''}`} />
                  <span className="ellipsis">{fm?.name ?? c.format} <span className="faint mono" style={{ fontSize: 10 }}>{fm?.width}×{fm?.height}</span></span>
                  <span className="faint" style={{ fontSize: 12 }}>{job ? `${job.status === 'queued' ? 'queued' : `${Math.round((job.progress ?? 0) * 100)}%`}` : c.export ? (c.export.upToDate ? `${c.export.format.toUpperCase()} ready` : 'changed since export') : 'not exported'}</span>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {can('export.create') && <button className="btn primary grow" disabled={busy || !info || running.length > 0} onClick={exportAll}>{busy ? <span className="spinner" /> : running.length ? `Exporting ${running.length}…` : `Export all ${channels.length}`}</button>}
            <button className="btn grow" disabled={!ready || zipping} onClick={downloadZip}><Icon name="download" />{zipping ? 'Preparing…' : `Download ${ready ? `${ready} ` : ''}as .zip`}</button>
          </div>
        </section>
        <section className="panel kit-card">
          <h3>Track as a group</h3>
          <span className="note">Link each size to the post it went out in — or use one tagged website link per size — and Analytics adds them up for the whole campaign.</span>
          {can('analytics.view') && <Link to={`/analytics?campaign=${campaignId}`} className="btn" style={{ alignSelf: 'flex-start' }}><Icon name="chart" />Open campaign analytics</Link>}
          <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
            <button className="btn grow" onClick={onEdit}><Icon name="wand" />Adjust</button>
            <Link to="/library" className="btn grow">Library</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
