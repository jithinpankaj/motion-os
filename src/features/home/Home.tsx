import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useCan, useSession } from '../../lib/session';
import { heroNavigate, preload } from '../../lib/transition';
import { MotionTile } from '../../components/MotionTile';
import { Avatar, EmptyState, StatusBadge, timeAgo, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { deserializeScene } from '../../../shared/scene/serialize';
import { formatById } from '../../../shared/formats';

const ACTION_LABEL: Record<string, string> = {
  'asset.publish': 'published', 'template.submit': 'submitted for review', 'approval.decision': 'decided on', 'asset.upload': 'uploaded', 'campaign.create': 'created campaign',
  'export.complete': 'exported', 'version.restore': 'restored a version of', 'brand.tokens.update': 'updated brand tokens', 'member.join': 'joined the workspace', 'asset.replace': 'replaced',
  'template.deprecated': 'deprecated', 'campaign.submit': 'submitted campaign', 'integration.connect': 'connected', 'campaign.upgrade': 'upgraded campaign', 'publication.confirmed': 'published to destination',
};

export default function Home() {
  const [data, setData] = useState<any>(null);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const user = useSession((s) => s.user);
  const can = useCan();
  const nav = useNavigate();
  const load = () => {
    api('/home').then((d) => setData({ ...d, templates: d.templates.map((t: any) => ({ ...t, doc: deserializeScene(t.doc) })), projects: d.projects.map((p: any) => ({ ...p, doc: deserializeScene(p.doc) })), campaigns: d.campaigns.map((c: any) => ({ ...c, doc: deserializeScene(c.doc) })) })).catch((e) => setError(errorMessage(e)));
    api('/approvals').then((r) => setApprovals(r.approvals)).catch(() => {});
  };
  useEffect(load, []);
  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    try { await api(`/approvals/${id}/decide`, { body: { decision } }); toast('ok', decision === 'approved' ? 'Approved' : 'Rejected'); load(); } catch (e) { toast('danger', 'Could not record decision', errorMessage(e)); }
  };
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const resolver = apiResolver();
  if (error) return <div className="page-inner"><EmptyState icon="alert" title="Home could not load">{error}</EmptyState></div>;
  const byId = (id: string) => data?.templates.find((t: any) => t.id === id);

  return (
    <div className="page-inner">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}>
        <div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1 className="display" style={{ marginTop: 10 }}>{greet}, {user?.name.split(' ')[0]}.</h1>
        <div className="row wrap" style={{ marginTop: 22, gap: 8 }}>
          {can('scene.create') && <Link to="/studio?new=1" className="btn primary lg"><Icon name="plus" />New motion</Link>}
          {can('library.view') && <Link to="/explore" className="btn lg"><Icon name="explore" />Browse approved motion</Link>}
          {can('campaign.edit') && <Link to="/campaigns?new=1" className="btn lg"><Icon name="campaigns" />Start a campaign</Link>}
        </div>
      </motion.div>

      {approvals.length > 0 && (
        <section className="section">
          <div className="section-h"><h2 className="h2">Pending approvals</h2><span className="faint">{approvals.length} waiting</span></div>
          <div className="panel" style={{ padding: 4 }}>
            {approvals.map((a) => (
              <div key={a.id} className="row" style={{ padding: '10px 12px', gap: 12, borderBottom: '1px solid var(--line)' }}>
                <Icon name={a.subject_type === 'campaign' ? 'campaigns' : 'sparkles'} />
                <div className="grow">
                  <div style={{ fontWeight: 540 }}>{a.subject_name}{a.version ? ` · v${a.version}` : ''}</div>
                  <div className="faint" style={{ fontSize: 12 }}>{a.requested_by_name} requested {timeAgo(a.created_at)}{a.note ? ` — “${a.note}”` : ''}</div>
                </div>
                {a.project_id && can('scene.view') && <Link className="btn sm ghost" to={`/studio/${a.project_id}`}>Review</Link>}
                {a.subject_type === 'campaign' && <Link className="btn sm ghost" to={`/campaigns/${a.subject_id}`}>Review</Link>}
                {a.canDecide ? (
                  <>
                    <button className="btn sm" onClick={() => decide(a.id, 'rejected')}>Reject</button>
                    <button className="btn sm primary" onClick={() => decide(a.id, 'approved')}><Icon name="check" size={13} />Approve</button>
                  </>
                ) : <StatusBadge status="pending" label={a.requested_by === user?.id ? 'awaiting another approver' : 'pending'} />}
              </div>
            ))}
          </div>
        </section>
      )}

      {data?.projects?.length > 0 && (
        <section className="section">
          <div className="section-h"><h2 className="h2">Recently edited</h2><Link to="/studio" className="muted">All projects →</Link></div>
          <div className="mgrid">
            {data.projects.slice(0, 5).map((p: any) => (
              <MotionTile key={p.id} id={p.id} doc={p.doc} assets={resolver} title={p.name} subtitle={`${p.updated_by ?? ''} · ${timeAgo(p.updated_at)}`} onHover={preload.studio} onOpen={(f) => heroNavigate(nav, `/studio/${p.id}`, f)} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-h"><h2 className="h2">Approved motion</h2><Link to="/explore" className="muted">Explore library →</Link></div>
        {!data ? <div className="mgrid">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ aspectRatio: '4/5' }} />)}</div> : data.templates.length ? (
          <div className="mgrid">
            {data.templates.slice(0, 8).map((t: any) => (
              <MotionTile key={t.id} id={t.id} doc={t.doc} assets={resolver} title={t.name} subtitle={`${t.category} · v${t.version}`} badges={data.recentlyPublished.includes(t.id) ? <span className="badge ok">new</span> : undefined}
                onHover={preload.playground} onOpen={(f) => heroNavigate(nav, `/play/${t.id}`, f)} />
            ))}
          </div>
        ) : <EmptyState icon="sparkles" title="No approved motion yet">Designers publish templates from Motion Studio. Once approved they appear here for every team.</EmptyState>}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 28 }} className="section">
        <section>
          <div className="section-h"><h2 className="h2">Active campaigns</h2>{can('campaign.view') && <Link to="/campaigns" className="muted">All campaigns →</Link>}</div>
          {data?.campaigns?.length ? (
            <div className="col" style={{ gap: 8 }}>
              {data.campaigns.map((c: any) => (
                <Link key={c.id} to={`/campaigns/${c.id}`} className="panel row" style={{ padding: 12, gap: 14 }} onPointerEnter={preload.campaign}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(c.channels ?? []).slice(0, 4).map((ch: string) => { const f = formatById(ch)!; return <span key={ch} style={{ width: 22 * Math.min(1.6, f.width / f.height), height: 22, borderRadius: 3, border: '1px solid var(--line-3)', background: 'var(--bg-3)' }} title={f.name} />; })}
                  </div>
                  <div className="grow"><div style={{ fontWeight: 540 }}>{c.name}</div><div className="faint" style={{ fontSize: 12 }}>{(c.channels ?? []).length} channels · updated {timeAgo(c.updated_at)}</div></div>
                  <StatusBadge status={c.approval_status} /><StatusBadge status={c.publishing_status} />
                </Link>
              ))}
            </div>
          ) : <div className="panel"><EmptyState icon="campaigns" title="No campaigns yet">Turn one motion master into variations for every channel.{can('campaign.edit') && <div style={{ marginTop: 12 }}><Link className="btn sm" to="/campaigns?new=1">Create campaign</Link></div>}</EmptyState></div>}
          {data?.recommended?.length > 0 && (
            <>
              <div className="section-h" style={{ marginTop: 32 }}><h2 className="h2">Recommended for you</h2><span className="faint">Less-used approved templates</span></div>
              <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {data.recommended.map((id: string) => { const t = byId(id); return t && <MotionTile key={id} id={`rec-${id}`} doc={t.doc} assets={resolver} title={t.name} subtitle={t.category} aspect="1 / 1" onOpen={(f) => heroNavigate(nav, `/play/${id}`, f)} />; })}
              </div>
            </>
          )}
        </section>
        <section>
          <div className="section-h"><h2 className="h2">Team activity</h2></div>
          <div className="col" style={{ gap: 2 }}>
            {!data && [0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 38 }} />)}
            {data?.activity?.map((a: any, i: number) => (
              <div key={i} className="row" style={{ padding: '7px 0', gap: 10, borderBottom: '1px solid var(--line)' }}>
                <Avatar name={a.actor} />
                <div className="grow" style={{ fontSize: 12.5 }}><b style={{ fontWeight: 560 }}>{a.actor ?? 'System'}</b> <span className="muted">{ACTION_LABEL[a.action] ?? a.action.replace('.', ' ')}</span> {a.data?.name ?? a.data?.filename ?? ''}</div>
                <span className="faint mono" style={{ fontSize: 10.5 }}>{timeAgo(a.created_at)}</span>
              </div>
            ))}
            {data && !data.activity.length && <div className="faint">Quiet so far.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
