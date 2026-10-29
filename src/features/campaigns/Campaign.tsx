import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { applyParameters, type ParamValues } from '../../../shared/params';
import { resolveVariation } from '../../../shared/inheritance';
import { adaptScene } from '../../../shared/adapt';
import { CHANNEL_FORMATS, formatById } from '../../../shared/formats';
import { deepEqual } from '../../../shared/util/paths';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useCan, useWorkspace } from '../../lib/session';
import { useExports } from '../../lib/exports';
import { HubPreview } from '../../components/MotionCard';
import { FormatFrame } from '../../components/FormatFrame';
import { ParamControl } from '../../components/ParamControl';
import { ApprovalIndicator, EmptyState, Modal, Segmented, StatusBadge, timeAgo, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';

export default function Campaign() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [approval, setApproval] = useState<any>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const ws = useWorkspace();
  const can = useCan();
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    try {
      const d = await api(`/campaigns/${id}`);
      setData(d);
      setActive((a) => a ?? null);
      const ap = await api('/approvals').catch(() => ({ approvals: [] }));
      setApproval(ap.approvals.find((x: any) => x.subject_type === 'campaign' && x.subject_id === id) ?? null);
    } catch (e) { setError(errorMessage(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const doc = data?.version.doc;
  const assets = useMemo(() => apiResolver({ type: 'campaign', id: id! }), [id]);
  const roles = ws?.roles ?? [];
  const variations = useMemo(() => (data ? data.variations.map((v: any) => {
    const { values, sources } = resolveVariation(doc.exposed, data.campaign.masterValues, v.overrides);
    const scene = adaptScene(applyParameters(doc, values, { roles }).scene, formatById(v.channel)!);
    return { ...v, values, sources, scene };
  }) : []), [data, doc, roles]);

  if (error) return <div className="page-inner"><EmptyState icon="alert" title="Campaign unavailable">{error}</EmptyState></div>;
  if (!data) return <div className="page-inner"><div className="skel" style={{ height: 400 }} /></div>;

  const editable = can('campaign.edit');
  // Optimistic local update, debounced persist. Master edits never touch local overrides.
  const persist = (key: string, fn: () => Promise<any>) => {
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => fn().catch((e) => { toast('danger', 'Change rejected', errorMessage(e)); load(); }), 500);
  };
  const setMaster = (k: string, v: unknown) => {
    setData((d: any) => ({ ...d, campaign: { ...d.campaign, masterValues: { ...d.campaign.masterValues, [k]: v } } }));
    persist(`m:${k}`, () => api(`/campaigns/${id}/master`, { method: 'PUT', body: { values: { [k]: v } } }));
  };
  const setOverride = (vid: string, k: string, v: unknown) => {
    setData((d: any) => ({ ...d, variations: d.variations.map((x: any) => (x.id === vid ? { ...x, overrides: { ...x.overrides, [k]: v } } : x)) }));
    persist(`o:${vid}:${k}`, () => api(`/campaigns/${id}/variations/${vid}/overrides/${k}`, { method: 'PUT', body: { value: v } }));
  };
  const resetOverride = async (vid: string, k: string) => {
    setData((d: any) => ({ ...d, variations: d.variations.map((x: any) => { if (x.id !== vid) return x; const { [k]: _, ...rest } = x.overrides; return { ...x, overrides: rest }; }) }));
    clearTimeout(saveTimers.current[`o:${vid}:${k}`]);
    await api(`/campaigns/${id}/variations/${vid}/overrides/${k}`, { method: 'DELETE' }).catch((e) => toast('danger', 'Reset failed', errorMessage(e)));
  };
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast('ok', ok); load(); } catch (e) { toast('danger', 'Action failed', errorMessage(e)); } };
  const v = variations.find((x: any) => x.id === active);
  const c = data.campaign;
  const steps = [
    { label: 'draft', state: c.approvalStatus === 'draft' ? 'current' : 'done' },
    { label: 'review', state: c.approvalStatus === 'review' ? 'current' : c.approvalStatus === 'rejected' ? 'blocked' : c.approvalStatus === 'approved' ? 'done' : 'todo' },
    { label: 'approved', state: c.approvalStatus === 'approved' ? (c.publishingStatus === 'published' ? 'done' : 'current') : 'todo' },
    { label: 'published', state: c.publishingStatus === 'published' ? 'done' : 'todo' },
  ] as any;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0,1fr)', height: '100%', minHeight: 0 }}>
      <aside className="scroll" style={{ borderRight: '1px solid var(--line)', minHeight: 0 }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }} className="col">
          <Link to="/campaigns" className="faint row" style={{ gap: 4, fontSize: 12 }}><Icon name="chevronLeft" size={12} />Campaigns</Link>
          <h1 className="h2">{c.name}</h1>
          <div className="faint" style={{ fontSize: 12 }}>{data.template.name} · pinned v{data.version.version} · {c.owner}</div>
          {data.upgradeAvailable && (
            <div className="surface col" style={{ padding: 10, gap: 6, borderColor: 'rgba(143,176,255,.35)' }}>
              <div className="row" style={{ gap: 6, color: 'var(--info)' }}><Icon name="info" size={14} />Template v{data.template.latestVersion} is available</div>
              <div className="faint" style={{ fontSize: 12 }}>This campaign stays on v{data.version.version} until you upgrade. Values that no longer validate are reported, never silently changed.</div>
              {editable && <button className="btn sm" onClick={() => act(async () => { const r = await api(`/campaigns/${id}/upgrade`, { method: 'POST' }); if (r.dropped.length) toast('warn', `${r.dropped.length} value(s) could not carry over`, r.dropped.map((d: any) => `${d.scope}/${d.key}: ${d.reason}`).join('; ')); }, 'Upgraded to latest version')}>Upgrade to v{data.template.latestVersion}</button>}
            </div>
          )}
          {data.template.status === 'deprecated' && <span className="badge warn">template deprecated</span>}
        </div>
        <div style={{ padding: 16 }} className="col">
          {v ? (
            <>
              <div className="row between"><span className="eyebrow">{formatById(v.channel)?.name} · overrides</span><button className="btn sm ghost" onClick={() => setActive(null)}>Back to master</button></div>
              <div className="field-hint">Values inherit from the master. Changing one here creates a local override that master edits will not overwrite.</div>
              {doc.exposed.map((p: any) => (
                <ParamControl key={p.key} p={p} value={v.values[p.key]} roles={roles} assets={assets} onChange={(val) => editable && setOverride(v.id, p.key, val)}
                  badge={v.sources[p.key] === 'override' ? <span className="badge" style={{ color: 'var(--override)', borderColor: 'rgba(255,159,110,.35)' }}>overridden</span> : <span className="badge faint">{v.sources[p.key] === 'master' ? 'from master' : 'default'}</span>}
                  onReset={v.sources[p.key] === 'override' && editable ? () => resetOverride(v.id, p.key) : undefined} />
              ))}
            </>
          ) : (
            <>
              <div className="eyebrow">Master · shared by all variations</div>
              {doc.exposed.map((p: any) => {
                const shadow = variations.filter((x: any) => x.sources[p.key] === 'override');
                const val = p.key in c.masterValues ? c.masterValues[p.key] : p.default;
                return <ParamControl key={p.key} p={p} value={val} roles={roles} assets={assets} onChange={(x) => editable && setMaster(p.key, x)}
                  badge={shadow.length ? <span className="badge" title={`Overridden in ${shadow.map((s: any) => formatById(s.channel)?.name).join(', ')}`} style={{ color: 'var(--override)' }}>{shadow.length} override{shadow.length > 1 ? 's' : ''}</span> : undefined} />;
              })}
            </>
          )}
        </div>
      </aside>
      <main className="scroll" style={{ minHeight: 0, padding: 24 }}>
        <div className="row wrap" style={{ gap: 10, marginBottom: 20 }}>
          <ApprovalIndicator steps={steps} />
          <div className="grow" />
          {editable && (c.approvalStatus === 'draft' || c.approvalStatus === 'rejected') && <button className="btn" onClick={() => act(() => api(`/campaigns/${id}/submit`, { method: 'POST' }), 'Submitted for approval')}><Icon name="send" size={13} />Submit for approval</button>}
          {approval?.status === 'pending' && approval.canDecide && <><button className="btn" onClick={() => act(() => api(`/approvals/${approval.id}/decide`, { body: { decision: 'rejected' } }), 'Rejected')}>Reject</button><button className="btn" onClick={() => act(() => api(`/approvals/${approval.id}/decide`, { body: { decision: 'approved' } }), 'Approved')}><Icon name="check" size={13} />Approve</button></>}
          {c.approvalStatus === 'approved' && can('campaign.approve') && <button className="btn" onClick={() => act(() => api(`/campaigns/${id}/publish`, { method: 'POST' }), 'Published — outputs are now pinned')}><Icon name="send" size={13} />{c.publishingStatus === 'published' ? 'Publish changes' : 'Publish'}</button>}
          {editable && <button className="btn" onClick={() => setAddOpen(true)}><Icon name="plus" size={13} />Channel</button>}
          <button className="btn primary" onClick={() => setExportOpen(true)}><Icon name="download" size={13} />Export campaign</button>
        </div>
        <div className="row wrap" style={{ gap: 28, alignItems: 'flex-start' }}>
          {variations.map((x: any) => {
            const f = formatById(x.channel)!;
            const w = f.width / f.height > 2.5 ? 460 : f.width >= f.height ? 320 : 230;
            const overrides = Object.keys(x.overrides).length;
            return (
              <motion.div layout key={x.id} className="col" style={{ gap: 8, cursor: 'pointer' }} onPointerEnter={() => setHot(x.id)} onPointerLeave={() => setHot(null)} onClick={() => setActive(x.id)}>
                <div className="row between" style={{ width: w }}>
                  <span style={{ fontWeight: 560, color: active === x.id ? 'var(--text)' : undefined }}>{f.name}</span>
                  <span className="row" style={{ gap: 4 }}>
                    {overrides > 0 && <span className="badge" style={{ color: 'var(--override)' }}>{overrides} local</span>}
                    {x.publishedSnapshot ? <StatusBadge status={x.dirty ? 'outdated' : 'published'} label={x.dirty ? 'unpublished changes' : 'published'} /> : <span className="badge">draft</span>}
                  </span>
                </div>
                <div style={{ borderRadius: 14, boxShadow: active === x.id ? '0 0 0 2px var(--bg), 0 0 0 3.5px var(--accent)' : undefined }}>
                  <FormatFrame format={f} width={w}><HubPreview doc={x.scene} assets={assets} active={hot === x.id || active === x.id} label={`${f.name} variation`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} /></FormatFrame>
                </div>
                {x.publishedAt && <span className="faint" style={{ fontSize: 11 }}>Published {timeAgo(x.publishedAt)} · pinned to v{data.version.version}</span>}
              </motion.div>
            );
          })}
        </div>
      </main>
      <CampaignExport open={exportOpen} onClose={() => setExportOpen(false)} campaignId={id!} variations={variations} duration={doc.canvas.duration} />
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add channel">
        <div className="row wrap" style={{ gap: 6 }}>{CHANNEL_FORMATS.filter((f) => !variations.some((x: any) => x.channel === f.id)).map((f) => <button key={f.id} className="chip" onClick={() => { setAddOpen(false); act(() => api(`/campaigns/${id}/variations`, { body: { channel: f.id } }), `${f.name} added`); }}>{f.name}</button>)}</div>
      </Modal>
    </div>
  );
}

function CampaignExport({ open, onClose, campaignId, variations, duration }: { open: boolean; onClose: () => void; campaignId: string; variations: any[]; duration: number }) {
  const [fmt, setFmt] = useState<'mp4' | 'png'>('mp4');
  const [which, setWhich] = useState<'draft' | 'published'>('draft');
  const [busy, setBusy] = useState(false);
  const create = useExports((s) => s.create);
  const run = async () => {
    setBusy(true);
    try {
      for (const v of variations) {
        if (which === 'published' && !v.publishedSnapshot) continue;
        const f = formatById(v.channel)!;
        const w = f.width - (f.width % 2), h = f.height - (f.height % 2);
        await create({ source: { kind: 'variation', campaignId, variationId: v.id, published: which === 'published' }, format: fmt, channel: v.channel, name: `${f.name}`, settings: fmt === 'mp4' ? { width: w, height: h, fps: 30, duration, quality: 'high', loops: 1, startTime: 0, background: null } : { width: f.width, height: f.height, time: 2.5, background: 'scene' } });
      }
      toast('info', 'Campaign exports queued', 'Each channel renders at its native size in the background.');
      onClose();
    } catch (e) { toast('danger', 'Could not queue exports', errorMessage(e)); } finally { setBusy(false); }
  };
  const pkg = async () => {
    const jobs = useExports.getState().jobs.filter((j) => j.status === 'completed' && j.source?.campaignId === campaignId);
    if (!jobs.length) { toast('warn', 'No completed exports yet'); return; }
    const res = await fetch('/api/integrations/package', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': (await import('../../lib/session')).useSession.getState().wsId! }, body: JSON.stringify({ exportJobIds: jobs.map((j) => j.id), name: 'campaign-package' }) });
    if (!res.ok) { toast('danger', 'Package failed'); return; }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: 'campaign-package.zip' });
    a.click();
  };
  return (
    <Modal open={open} onClose={onClose} title="Export campaign" subtitle={`${variations.length} variations, each rendered at its channel's exact dimensions.`}
      footer={<><button className="btn ghost" onClick={pkg}><Icon name="folder" size={13} />Download package of finished files</button><button className="btn primary" disabled={busy} onClick={run}>{busy ? <span className="spinner" /> : 'Queue exports'}</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Segmented label="Format" value={fmt} onChange={setFmt} options={[{ value: 'mp4', label: 'MP4 video' }, { value: 'png', label: 'PNG poster' }]} />
        <Segmented label="Version" value={which} onChange={setWhich} options={[{ value: 'draft', label: 'Current draft' }, { value: 'published', label: 'Published snapshot' }]} />
        <div className="col" style={{ gap: 4 }}>{variations.map((v) => { const f = formatById(v.channel)!; return <div key={v.id} className="row" style={{ fontSize: 12.5 }}><Icon name="film" size={13} /><span className="grow">{f.name}</span><span className="mono faint">{f.width}×{f.height}</span>{which === 'published' && !v.publishedSnapshot && <span className="badge warn">not published</span>}</div>; })}</div>
      </div>
    </Modal>
  );
}
