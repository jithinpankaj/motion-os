import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useBrandKit } from '../../lib/brand';
import { useCan } from '../../lib/session';
import { importDesignFile, importFigma, pdfPages, detectKind, type ImportedDesign } from '../../lib/designImport';
import { MotionCanvas } from '../../components/MotionCanvas';
import { HubPreview } from '../../components/MotionCard';
import { ExportPanel } from '../../components/ExportPanel';
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

export default function Create() {
  const { id: editId } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const { kit, loaded, brandId } = useBrandKit();
  const resolver = apiResolver();
  const [step, setStep] = useState<Step>('start');
  const [design, setDesign] = useState<Design | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [r, setR] = useState<Omit<Recipe, 'design'>>({ style: 'build', personality: 'balanced', headline: '', showLogo: false, keepBackground: null, duration: 8, format: 'original' });
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<{ id: string; revision: number; editedElsewhere?: boolean } | null>(null);
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
      setName(res.project.name);
      setSaved({ id: editId, revision: res.scene.revision, editedElsewhere: res.project.recipeRevision !== res.scene.revision });
      setStep('tune');
    }).catch((e) => toast('danger', 'Could not open motion', errorMessage(e)));
  }, [editId, nav]);

  const fmt = r.format === 'original' ? null : formatById(r.format);
  const doc = useMemo(() => buildMotion({ design, brand: kit, style: r.style, personality: r.personality, headline: r.headline, showLogo: r.showLogo, keepBackground: r.keepBackground ?? undefined, duration: r.duration, width: fmt?.width, height: fmt?.height, name: name || design?.name || 'Brand motion' }), [design, kit, r, fmt, name]);

  const onImported = (d: ImportedDesign) => {
    setDesign(d);
    setNotes(d.notes);
    setName(d.name);
    setR((x) => ({ ...x, style: d.layers.length > 1 ? 'build' : 'zoom' }));
    setStep('style');
  };
  const startWithBrand = () => {
    setDesign(null); setNotes([]); setName('Brand motion');
    setR((x) => ({ ...x, style: 'backdrop', headline: x.headline || 'Your message here', showLogo: !!kit.logoAssetId, format: 'instagram-feed' }));
    setStep('style');
  };

  const save = async (opts: { force?: boolean } = {}) => {
    if (!saved && !can('scene.create')) return;
    setSaving(true);
    const recipe: Recipe = { ...r, design: design ? { name: design.name, width: Math.round(design.width), height: Math.round(design.height), background: design.background, layers: design.layers } : null };
    try {
      if (saved && !opts.force && saved.editedElsewhere) { setSaving(false); setConfirmOverwrite(true); return; }
      if (saved) {
        const out = await api(`/projects/${saved.id}/recipe`, { method: 'PUT', body: { recipe, doc, baseRevision: saved.revision } });
        setSaved({ id: saved.id, revision: out.revision });
      } else {
        const out = await api('/projects', { body: { name: doc.meta.name, scene: doc, recipe, brandId: brandId ?? undefined } });
        setSaved({ id: out.id, revision: 1 });
        window.history.replaceState(null, '', `/create/${out.id}`);
      }
      setStep('done');
    } catch (e) {
      toast('danger', 'Could not save', e instanceof ApiError && e.status === 409 ? 'Someone else changed this motion. Reload the page to get their version.' : errorMessage(e));
    } finally { setSaving(false); }
  };
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  if (!can('scene.create') && !editId) {
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
              <button className={`step ${i < at ? 'done' : ''}`} aria-current={i === at ? 'step' : undefined} disabled={i >= at || (s.key === 'start' && !!editId)} onClick={() => setStep(s.key)}>
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
          <TuneStep design={design} setDesign={setDesign} kit={kit} r={r} setR={setR} name={name} setName={setName} doc={doc} resolver={resolver}
            saving={saving} onSave={() => save()} isUpdate={!!saved} editedElsewhere={!!saved?.editedElsewhere} projectId={saved?.id}
            onPersonality={() => { touchedPersonality.current = true; }} />
        )}
        {step === 'done' && saved && <DoneStep doc={doc} resolver={resolver} projectId={saved.id} name={doc.meta.name} onEdit={() => setStep('tune')} onNew={() => { nav('/create'); window.location.reload(); }} />}
      </div>

      <Modal open={confirmOverwrite} onClose={() => setConfirmOverwrite(false)} title="Replace advanced edits?" subtitle="This motion was changed in the advanced editor after it was made here. Saving from Create rebuilds it from these settings and replaces those changes (older versions stay in its history)."
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
  name: string; setName: (s: string) => void; doc: any; resolver: any; saving: boolean; onSave: () => void; isUpdate: boolean; editedElsewhere: boolean; projectId?: string; onPersonality: () => void;
}) {
  const { design, setDesign, kit, r, setR, doc } = p;
  const clock = useMemo(() => new Clock(), []);
  const [picker, setPicker] = useState(false);
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
      <div className="stage">
        <div className="stage-frame" style={{ aspectRatio: String(ratio), width: ratio >= 1 ? '100%' : undefined, height: ratio < 1 ? 'min(calc(100vh - 260px), 720px)' : undefined }}>
          <MotionCanvas doc={doc} clock={clock} assets={p.resolver} label={`${doc.meta.name} preview`} style={{ position: 'absolute', inset: 0 }} />
        </div>
      </div>
      <div className="tune">
        <div className="tune-group"><span className="label">Name</span><input className="input" value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder="Spring launch post" aria-label="Motion name" /></div>
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
          <span className="label">Where will it go?</span>
          <div className="row wrap" style={{ gap: 6 }}>{FORMATS.filter((f) => f !== 'original' || design).map((f) => <button key={f} className="chip" aria-pressed={r.format === f} onClick={() => set('format', f)}>{formatLabel(f)}{f !== 'original' && <span className="faint mono" style={{ fontSize: 9.5 }}>{formatById(f)!.width}×{formatById(f)!.height}</span>}</button>)}</div>
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
          <button className="btn primary lg grow" disabled={p.saving} onClick={p.onSave}>{p.saving ? <span className="spinner" /> : p.isUpdate ? 'Save changes' : 'Save motion'}</button>
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

