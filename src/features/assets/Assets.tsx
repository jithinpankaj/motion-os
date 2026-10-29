import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { api, errorMessage } from '../../lib/api';
import { invalidateAssets } from '../../lib/assets';
import { useCan } from '../../lib/session';
import { EmptyState, Field, Modal, Segmented, StatusBadge, timeAgo, toast, spring } from '../../ui/controls';
import { Icon } from '../../ui/Icon';

const KINDS = [{ value: '', label: 'All' }, { value: 'image', label: 'Images' }, { value: 'logo', label: 'Logos' }, { value: 'svg', label: 'SVG' }, { value: 'video', label: 'Video' }, { value: 'font', label: 'Fonts' }, { value: 'export', label: 'Exports' }];
const kindFromFile = (f: File) => (f.type.startsWith('video') ? 'video' : f.type === 'image/svg+xml' ? 'svg' : /font|woff|ttf|otf/.test(f.type + f.name) ? 'font' : 'image');

export default function Assets() {
  const [assets, setAssets] = useState<any[] | null>(null);
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [upload, setUpload] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const can = useCan();
  const load = () => api('/assets', { query: { kind, q } }).then((r) => setAssets(r.assets)).catch((e) => toast('danger', 'Assets unavailable', errorMessage(e)));
  useEffect(() => { load(); }, [kind]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q]);

  return (
    <div className="page-inner" onDragOver={(e) => { if (can('asset.upload')) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setUpload(f); }}>
      <div className="row between wrap" style={{ alignItems: 'flex-end' }}>
        <div><div className="eyebrow">Shared library</div><h1 className="h1" style={{ marginTop: 8 }}>Assets</h1><p className="muted" style={{ margin: '6px 0 0', maxWidth: 560 }}>One copy of each file, referenced everywhere. Usage is tracked and published outputs stay pinned to exact versions.</p></div>
        {can('asset.upload') && <label className="btn primary lg"><Icon name="upload" />Upload<input type="file" hidden accept="image/*,video/mp4,video/webm,.svg,.woff,.woff2,.ttf,.otf" onChange={(e) => e.target.files?.[0] && setUpload(e.target.files[0])} /></label>}
      </div>
      <div className="row wrap" style={{ marginTop: 22, gap: 10 }}>
        <Segmented label="Asset type" value={kind} onChange={setKind} options={KINDS} />
        <input className="input" style={{ width: 240 }} placeholder="Search name or tag" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search assets" />
      </div>
      {drag && <div className="surface" style={{ marginTop: 16, padding: 30, textAlign: 'center', borderStyle: 'dashed', borderColor: 'var(--accent)' }}>Drop to upload</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, marginTop: 22 }}>
        {!assets && Array.from({ length: 8 }, (_, i) => <div key={i} className="skel" style={{ aspectRatio: '1' }} />)}
        {assets?.map((a) => (
          <motion.button layout key={a.id} className="mcard" onClick={() => setSel(a.id)} transition={spring}>
            <div className="mcard-media" style={{ aspectRatio: '1', background: a.kind === 'image' || a.kind === 'logo' || a.kind === 'svg' ? `center / cover url(${a.url}) var(--bg-2)` : 'var(--bg-2)', display: 'grid', placeItems: 'center' }}>
              {a.kind === 'font' && <span style={{ fontSize: 34 }}>Aa</span>}
              {(a.kind === 'video' || a.kind === 'export') && <Icon name="film" size={26} />}
              <div className="mcard-badges"><span className="badge">{a.kind}</span>{a.usage > 0 ? <span className="badge info">{a.usage} uses</span> : <span />}</div>
            </div>
            <div className="mcard-meta"><div className="ellipsis" style={{ fontWeight: 540 }}>{a.name}</div><div className="faint" style={{ fontSize: 11.5 }}>{a.width ? `${a.width}×${a.height} · ` : ''}v{a.version} · {(a.bytes / 1e6).toFixed(2)} MB</div></div>
          </motion.button>
        ))}
      </div>
      {assets && !assets.length && <EmptyState icon="assets" title="No assets here">Upload images, logos, fonts or video. Files are validated by content, not by name.</EmptyState>}
      <AnimatePresence>{sel && <AssetDrawer id={sel} onClose={() => setSel(null)} onChanged={load} />}</AnimatePresence>
      <UploadDialog file={upload} onClose={() => setUpload(null)} onDone={() => { setUpload(null); invalidateAssets(); load(); }} />
    </div>
  );
}

function UploadDialog({ file, onClose, onDone }: { file: File | null; onClose: () => void; onDone: () => void }) {
  const [meta, setMeta] = useState({ name: '', kind: 'image', tags: '', holder: '', web: true, video: false, app: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (file) { setMeta((m) => ({ ...m, name: file.name.replace(/\.[^.]+$/, ''), kind: kindFromFile(file) })); setErr(null); } }, [file]);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await api('/assets', { raw: file!, query: { name: meta.name, kind: meta.kind, tags: meta.tags, license: meta.kind === 'font' ? JSON.stringify({ holder: meta.holder, web: meta.web, video: meta.video, app: meta.app }) : undefined } });
      toast('ok', 'Uploaded', meta.name); onDone();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!file} onClose={onClose} title="Upload asset" subtitle={file ? `${file.name} · ${(file.size / 1e6).toFixed(2)} MB` : ''} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !meta.name || (meta.kind === 'font' && !meta.holder)} onClick={go}>{busy ? <span className="spinner" /> : 'Upload'}</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="pgrid2">
          <Field label="Name"><input className="input" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Field>
          <Field label="Type"><select className="select" value={meta.kind} onChange={(e) => setMeta({ ...meta, kind: e.target.value })}>{['image', 'logo', 'svg', 'video', 'font'].map((k) => <option key={k}>{k}</option>)}</select></Field>
        </div>
        <Field label="Tags" hint="Comma separated"><input className="input" value={meta.tags} onChange={(e) => setMeta({ ...meta, tags: e.target.value })} /></Field>
        {meta.kind === 'font' && (
          <div className="surface col" style={{ padding: 12, gap: 8 }}>
            <span className="eyebrow">Licence</span>
            <Field label="Licence holder"><input className="input" value={meta.holder} onChange={(e) => setMeta({ ...meta, holder: e.target.value })} placeholder="Foundry or organisation" /></Field>
            <div className="row" style={{ gap: 14 }}>{(['web', 'video', 'app'] as const).map((k) => <label key={k} className="checkbox"><input type="checkbox" checked={meta[k]} onChange={(e) => setMeta({ ...meta, [k]: e.target.checked })} />Licensed for {k}</label>)}</div>
            <div className="field-hint">Exports flag fonts whose licence does not cover the output medium.</div>
          </div>
        )}
        {err && <div className="field-error" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

function AssetDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const can = useCan();
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => api(`/assets/${id}`).then(setD).catch((e) => toast('danger', 'Asset unavailable', errorMessage(e)));
  useEffect(() => { load(); }, [id]);
  const replace = async (updateDrafts: boolean) => {
    try { await api(`/assets/${id}/replace`, { raw: replaceFile!, query: { updateDrafts } }); toast('ok', 'New version uploaded', updateDrafts ? 'Drafts now use the new file.' : 'Existing drafts keep the previous version.'); setReplaceFile(null); invalidateAssets(); load(); onChanged(); } catch (e) { toast('danger', 'Replace failed', errorMessage(e)); }
  };
  const del = async () => { if (!confirm('Delete this asset? Drafts using it will show a missing-image placeholder.')) return; try { await api(`/assets/${id}`, { method: 'DELETE' }); onClose(); onChanged(); } catch (e) { toast('danger', 'Cannot delete', errorMessage(e)); } };
  const drafts = d?.usage.filter((u: any) => u.ref_type === 'scene') ?? [];
  return (
    <motion.aside className="panel" aria-label="Asset details" style={{ position: 'fixed', top: 64, right: 16, bottom: 16, width: 380, zIndex: 40, display: 'flex', flexDirection: 'column', boxShadow: '0 30px 80px rgba(0,0,0,.55)' }} initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={spring}>
      <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}><span className="h3 ellipsis">{d?.asset.name ?? '…'}</span><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
      {d && (
        <div className="scroll col" style={{ padding: 14, gap: 14 }}>
          {['image', 'logo', 'svg'].includes(d.asset.kind) && <img src={d.asset.url} alt={d.asset.name} style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />}
          <dl style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '5px 10px', margin: 0, fontSize: 12.5 }}>
            <dt className="faint">Type</dt><dd style={{ margin: 0 }}>{d.asset.kind} · {d.asset.mime}</dd>
            {d.asset.width && <><dt className="faint">Size</dt><dd style={{ margin: 0 }}>{d.asset.width}×{d.asset.height}</dd></>}
            <dt className="faint">Version</dt><dd style={{ margin: 0 }}>v{d.asset.version}</dd>
            <dt className="faint">Tags</dt><dd style={{ margin: 0 }}>{d.asset.tags.join(', ') || '—'}</dd>
            <dt className="faint">Uploaded</dt><dd style={{ margin: 0 }}>{d.asset.createdBy} · {timeAgo(d.asset.createdAt)}</dd>
            {d.asset.license && <><dt className="faint">Licence</dt><dd style={{ margin: 0 }}>{d.asset.license.holder} — {['web', 'video', 'app'].filter((k) => d.asset.license[k]).join(', ') || 'none'}</dd></>}
          </dl>
          <div className="col" style={{ gap: 6 }}>
            <span className="eyebrow">Used in ({d.usage.length})</span>
            {d.usage.map((u: any, i: number) => (
              <div key={i} className="row" style={{ fontSize: 12.5, gap: 8 }}>
                <Icon name={u.ref_type === 'scene' ? 'studio' : 'sparkles'} size={13} />
                {u.project_id ? <Link to={`/studio/${u.project_id}`} className="grow ellipsis">{u.label ?? u.ref_id}</Link> : <span className="grow ellipsis">{u.label ?? u.ref_id}</span>}
                {u.pinned ? <span className="badge">pinned v{u.pinned_version}</span> : <span className="badge info">follows latest</span>}
              </div>
            ))}
            {!d.usage.length && <span className="faint">Not used yet.</span>}
          </div>
          <div className="col" style={{ gap: 6 }}>
            <span className="eyebrow">Versions</span>
            {d.versions.map((v: any) => <div key={v.id} className="row" style={{ fontSize: 12 }}><span className="mono">v{v.version}</span><span className="grow faint">{v.width ? `${v.width}×${v.height}` : v.mime}</span><span className="faint">{timeAgo(v.created_at)}</span></div>)}
          </div>
          {can('asset.upload') && <><button className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" size={13} />Replace with new version</button><input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && setReplaceFile(e.target.files[0])} /></>}
          {can('asset.manage') && <button className="btn ghost danger" onClick={del}><Icon name="trash" size={13} />Delete</button>}
        </div>
      )}
      <Modal open={!!replaceFile} onClose={() => setReplaceFile(null)} title="Update dependent drafts?" subtitle={`${drafts.filter((u: any) => !u.pinned).length} draft scene(s) follow this asset. Published templates are pinned and will not change.`}
        footer={<><button className="btn" onClick={() => replace(false)}>Keep drafts on current version</button><button className="btn primary" onClick={() => replace(true)}>Update drafts</button></>}>
        <div className="col" style={{ gap: 4 }}>{drafts.map((u: any, i: number) => <div key={i} className="row" style={{ fontSize: 12.5 }}><Icon name="studio" size={13} /><span className="grow">{u.label}</span>{u.pinned && <StatusBadge status="draft" label={`pinned v${u.pinned_version}`} />}</div>)}{!drafts.length && <span className="faint">No drafts reference this asset.</span>}</div>
      </Modal>
    </motion.aside>
  );
}
