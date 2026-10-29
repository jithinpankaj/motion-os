import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useCan } from '../../lib/session';
import { HubPreview } from '../../components/MotionCard';
import { EmptyState, Field, Modal, StatusBadge, timeAgo, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { CHANNEL_FORMATS, formatById } from '../../../shared/formats';
import { deserializeScene } from '../../../shared/scene/serialize';

export default function Campaigns() {
  const [list, setList] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sp, setSp] = useSearchParams();
  const can = useCan();
  useEffect(() => { api('/campaigns').then((r) => setList(r.campaigns.map((c: any) => ({ ...c, doc: deserializeScene(c.doc) })))).catch((e) => setError(errorMessage(e))); }, []);
  const resolver = apiResolver();
  return (
    <div className="page-inner">
      <div className="row between wrap" style={{ alignItems: 'flex-end' }}>
        <div><div className="eyebrow">Adapt</div><h1 className="h1" style={{ marginTop: 8 }}>Campaigns</h1><p className="muted" style={{ margin: '6px 0 0', maxWidth: 560 }}>One motion master, many channel variations. Shared changes flow down; local overrides stay put.</p></div>
        {can('campaign.edit') && <button className="btn primary lg" onClick={() => setSp({ new: '1' })}><Icon name="plus" />New campaign</button>}
      </div>
      <div className="section" style={{ marginTop: 28 }}>
        {error && <EmptyState icon="alert" title="Campaigns unavailable">{error}</EmptyState>}
        {!list && !error && <div className="col">{[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 120 }} />)}</div>}
        {list && !list.length && <EmptyState icon="campaigns" title="No campaigns yet" action={can('campaign.edit') && <button className="btn" onClick={() => setSp({ new: '1' })}>Create the first campaign</button>}>Pick an approved template and the channels you need — variations are created for you.</EmptyState>}
        <div className="col" style={{ gap: 12 }}>
          {list?.map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="panel row" style={{ padding: 14, gap: 18 }}>
              <div className="row" style={{ gap: 8 }}>
                {(c.channels ?? []).slice(0, 4).map((ch: string) => { const f = formatById(ch)!; const h = 76; return <div key={ch} style={{ width: h * (f.width / f.height), height: h, maxWidth: 160, borderRadius: 6, overflow: 'hidden', position: 'relative', border: '1px solid var(--line-2)' }}><HubPreview doc={{ ...c.doc, canvas: { ...c.doc.canvas, width: f.width, height: f.height } }} assets={resolver} label={`${c.name} ${f.name}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} /></div>; })}
              </div>
              <div className="grow">
                <div className="row"><span className="h3">{c.name}</span>{c.upgrade_available && <span className="badge info">template update available</span>}</div>
                <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>{c.template_name} · {(c.channels ?? []).length} channels · {c.owner} · {timeAgo(c.updated_at)}</div>
              </div>
              <StatusBadge status={c.approval_status} /><StatusBadge status={c.publishing_status} />
            </Link>
          ))}
        </div>
      </div>
      <NewCampaign open={sp.get('new') === '1'} initialTemplate={sp.get('template')} onClose={() => setSp({})} />
    </div>
  );
}

function NewCampaign({ open, onClose, initialTemplate }: { open: boolean; onClose: () => void; initialTemplate: string | null }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', description: '', templateId: initialTemplate ?? '', channels: ['instagram-feed', 'linkedin-feed', 'website-hero'] });
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  useEffect(() => { if (open) api('/library').then((r) => { const t = r.templates.filter((x: any) => x.status === 'published').map((x: any) => ({ ...x, doc: deserializeScene(x.doc) })); setTemplates(t); setForm((f) => ({ ...f, templateId: f.templateId || t[0]?.id || '' })); }).catch(() => {}); }, [open]);
  const resolver = apiResolver();
  const create = async () => {
    setBusy(true);
    try { const r = await api('/campaigns', { body: form }); toast('ok', 'Campaign created', `${form.channels.length} variations ready`); nav(`/campaigns/${r.id}`); } catch (e) { toast('danger', 'Could not create campaign', errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New campaign" subtitle="Choose a motion family and the channels to adapt it to." wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !form.name.trim() || !form.templateId || !form.channels.length} onClick={create}>{busy ? <span className="spinner" /> : `Create ${form.channels.length} variations`}</button></>}>
      <div className="col" style={{ gap: 16 }}>
        <div className="pgrid2">
          <Field label="Campaign name"><input className="input" value={form.name} placeholder="Spring launch" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Description"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        <Field label="Motion family (approved template)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8 }} role="radiogroup" aria-label="Template">
            {templates.map((t) => (
              <button key={t.id} role="radio" aria-checked={form.templateId === t.id} className="mcard" onClick={() => setForm({ ...form, templateId: t.id })}>
                <div className="mcard-media" style={{ aspectRatio: '4/5', borderColor: form.templateId === t.id ? 'var(--text)' : undefined }}><HubPreview doc={t.doc} assets={resolver} active={form.templateId === t.id} label={t.name} /></div>
                <div className="mcard-meta"><div className="ellipsis" style={{ fontSize: 12, fontWeight: 540 }}>{t.name}</div></div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Channels">
          <div className="row wrap" style={{ gap: 6 }}>{CHANNEL_FORMATS.map((c) => <button key={c.id} className="chip" aria-pressed={form.channels.includes(c.id)} onClick={() => setForm({ ...form, channels: form.channels.includes(c.id) ? form.channels.filter((x) => x !== c.id) : [...form.channels, c.id] })}>{c.name} <span className="faint mono" style={{ fontSize: 10 }}>{c.width}×{c.height}</span></button>)}</div>
        </Field>
      </div>
    </Modal>
  );
}
