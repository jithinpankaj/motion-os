import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useCan } from '../../lib/session';
import { heroNavigate, preload } from '../../lib/transition';
import { MotionTile } from '../../components/MotionTile';
import { HubPreview } from '../../components/MotionCard';
import { EmptyState, Field, Modal, StatusBadge, timeAgo, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { deserializeScene, SceneValidationError } from '../../../shared/scene/serialize';
import { LAUNCH_PRESETS } from '../../../shared/scene/presets';
import { createScene } from '../../../shared/scene/defaults';
import { nullResolver } from '../../engine/assets';

export default function Projects() {
  const [projects, setProjects] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const [q, setQ] = useState('');
  const can = useCan();
  const nav = useNavigate();
  useEffect(() => { api('/projects').then((r) => setProjects(r.projects.map((p: any) => ({ ...p, doc: deserializeScene(p.doc) })))).catch((e) => setError(errorMessage(e))); }, []);
  const resolver = apiResolver();
  const list = (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page-inner">
      <div className="row between wrap" style={{ alignItems: 'flex-end' }}>
        <div><div className="eyebrow">Create</div><h1 className="h1" style={{ marginTop: 8 }}>Motion Studio</h1><p className="muted" style={{ margin: '6px 0 0' }}>Scenes are versioned documents. Publish them as templates to share with every team.</p></div>
        <div className="row">
          <input className="input" style={{ width: 220 }} placeholder="Filter projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter projects" />
          {can('scene.create') && <button className="btn primary lg" onClick={() => setCreating(true)}><Icon name="plus" />New scene</button>}
        </div>
      </div>
      <div className="section" style={{ marginTop: 28 }}>
        {error && <EmptyState icon="alert" title="Projects unavailable">{error}</EmptyState>}
        {!projects && !error && <div className="mgrid">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ aspectRatio: '4/5' }} />)}</div>}
        {projects && !list.length && <EmptyState icon="studio" title={q ? 'No matching projects' : 'No scenes yet'} action={can('scene.create') && <button className="btn" onClick={() => setCreating(true)}>Start from a preset</button>}>Start from one of the launch presets — every preset stays fully editable.</EmptyState>}
        <div className="mgrid">
          {list.map((p) => (
            <MotionTile key={p.id} id={p.id} doc={p.doc} assets={resolver} title={p.name} subtitle={`${p.owner ?? ''} · ${timeAgo(p.updated_at)}`}
              badges={<>{p.template_status ? <StatusBadge status={p.template_status} /> : <span className="badge">draft</span>}<span /></>}
              onHover={preload.studio} onOpen={(f) => heroNavigate(nav, `/studio/${p.id}`, f)} />
          ))}
        </div>
      </div>
      <NewScene open={creating} onClose={() => { setCreating(false); setSp({}, { replace: true }); }} />
    </div>
  );
}

function NewScene({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pick, setPick] = useState<string>('aurora-flow');
  const [name, setName] = useState('');
  const [imported, setImported] = useState<any>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hot, setHot] = useState<string | null>(null);
  const nav = useNavigate();
  const previews = useMemo(() => Object.fromEntries([...LAUNCH_PRESETS.map((p) => [p.key, p.build(`scn_prev_${p.key}`)]), ['blank', createScene({ id: 'scn_prev_blank' })]]), []);
  const onFile = async (file: File) => {
    setImportErr(null);
    try {
      const text = await file.text();
      const doc = deserializeScene(text); // untrusted: migrated + validated before anything renders
      setImported(doc); setPick('import'); setName(doc.meta.name);
    } catch (e) { setImported(null); setImportErr(e instanceof SceneValidationError ? e.message : 'Could not read file'); }
  };
  const create = async () => {
    setBusy(true);
    try {
      const preset = LAUNCH_PRESETS.find((p) => p.key === pick);
      const r = await api('/projects', { body: { name: name || (preset ? previews[pick].meta.name : pick === 'import' ? imported.meta.name : 'Untitled scene'), ...(pick === 'import' ? { scene: imported } : preset ? { preset: pick } : {}) } });
      nav(`/studio/${r.id}`);
    } catch (e) { toast('danger', 'Could not create scene', errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New scene" subtitle="Start from a launch preset, a blank canvas, or import a Motion Scene file." wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (pick === 'import' && !imported)} onClick={create}>{busy ? <span className="spinner" /> : 'Create scene'}</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }} role="radiogroup" aria-label="Starting point">
        {[...LAUNCH_PRESETS.map((p) => p.key), 'blank'].map((k) => (
          <button key={k} role="radio" aria-checked={pick === k} className="mcard" onClick={() => setPick(k)} onPointerEnter={() => setHot(k)} onPointerLeave={() => setHot(null)}>
            <div className="mcard-media" style={{ aspectRatio: '4/5', borderColor: pick === k ? 'var(--text)' : undefined, borderWidth: pick === k ? 1.5 : 1 }}>
              <HubPreview doc={previews[k]} assets={nullResolver} active={hot === k || pick === k} label={`${previews[k].meta.name} preview`} />
            </div>
            <div className="mcard-meta"><div style={{ fontWeight: 560 }}>{k === 'blank' ? 'Blank canvas' : previews[k].meta.name}</div><div className="faint ellipsis" style={{ fontSize: 11.5 }}>{k === 'blank' ? '1080×1350, 8 s seamless loop' : previews[k].meta.description}</div></div>
          </button>
        ))}
      </div>
      <div className="pgrid2" style={{ marginTop: 18 }}>
        <Field label="Name"><input className="input" placeholder="Scene name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Import scene file" hint="Validated and migrated before use" error={importErr}>
          <input type="file" accept=".json,application/json" className="input" style={{ paddingTop: 4 }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </Field>
      </div>
      {imported && <div className="badge ok" style={{ marginTop: 10 }}><Icon name="check" size={11} />Valid scene · {imported.layers.length} layers · schema v{imported.schemaVersion}</div>}
    </Modal>
  );
}
