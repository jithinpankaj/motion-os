import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useBrandKit } from '../../lib/brand';
import { useCan, useSession } from '../../lib/session';
import { heroNavigate, preload } from '../../lib/transition';
import { MotionTile } from '../../components/MotionTile';
import { EmptyState, StatusBadge, timeAgo, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { deserializeScene } from '../../../shared/scene/serialize';

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
  const { version: brandVersion, loaded: brandLoaded } = useBrandKit();
  const brandSetUp = brandLoaded && brandVersion > 1;
  if (error) return <div className="page-inner"><EmptyState icon="alert" title="Home could not load">{error}</EmptyState></div>;

  return (
    <div className="page-inner">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}>
        <div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1 className="display" style={{ marginTop: 10 }}>{greet}, {user?.name.split(' ')[0]}.</h1>
        <p className="lead">What would you like to do?</p>
      </motion.div>

      <div className="actions3" style={{ marginTop: 24 }}>
        {can('scene.create') ? (
          <Link to="/create" className="action-card"><span className="ic"><Icon name="wand" /></span><span className="t">Animate a design</span><span className="d">Upload a post, poster or Figma frame and choose how it moves.</span><span className="go">Start <Icon name="chevronRight" size={13} /></span></Link>
        ) : (
          <Link to="/library?tab=templates" className="action-card"><span className="ic"><Icon name="library" /></span><span className="t">Use a brand template</span><span className="d">Change the words and colours of approved motion, then export.</span><span className="go">Browse <Icon name="chevronRight" size={13} /></span></Link>
        )}
        {can('brand.view') && (
          <Link to={can('brand.edit') && !brandSetUp ? '/brand?import=1' : '/brand'} className={`action-card ${brandSetUp ? 'done' : ''}`}><span className="ic"><Icon name={brandSetUp ? 'check' : 'brand'} /></span><span className="t">{brandSetUp ? 'Your brand kit' : 'Import your brand'}</span><span className="d">{brandSetUp ? 'Colours, fonts, logo and personality used by every motion.' : 'Pull colours, fonts, logo and tone from your website, logo or guidelines.'}</span><span className="go">{brandSetUp ? 'Open' : 'Import'} <Icon name="chevronRight" size={13} /></span></Link>
        )}
        {can('analytics.view') && (
          <Link to="/analytics" className="action-card"><span className="ic"><Icon name="chart" /></span><span className="t">See how it’s doing</span><span className="d">Connect Instagram, LinkedIn or Google Analytics and track each motion.</span><span className="go">Open analytics <Icon name="chevronRight" size={13} /></span></Link>
        )}
      </div>

      {approvals.length > 0 && (
        <section className="section">
          <div className="section-h"><h2 className="h2">Waiting for your approval</h2><span className="faint">{approvals.length} waiting</span></div>
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
          <div className="section-h"><h2 className="h2">Your recent motion</h2><Link to="/library" className="muted">Library →</Link></div>
          <div className="mgrid">
            {data.projects.slice(0, 4).map((p: any) => (
              <MotionTile key={p.id} id={p.id} doc={p.doc} assets={resolver} title={p.name} subtitle={`${p.updated_by ?? ''} · ${timeAgo(p.updated_at)}`} onHover={p.has_recipe ? undefined : preload.studio} onOpen={(f) => (p.has_recipe ? nav(`/create/${p.id}`) : heroNavigate(nav, `/studio/${p.id}`, f))} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-h"><h2 className="h2">Brand templates</h2><Link to="/library?tab=templates" className="muted">All templates →</Link></div>
        {!data ? <div className="mgrid">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ aspectRatio: '4/5' }} />)}</div> : data.templates.length ? (
          <div className="mgrid">
            {data.templates.slice(0, 4).map((t: any) => (
              <MotionTile key={t.id} id={t.id} doc={t.doc} assets={resolver} title={t.name} subtitle={t.category} onHover={preload.playground} onOpen={(f) => heroNavigate(nav, `/play/${t.id}`, f)} />
            ))}
          </div>
        ) : <EmptyState icon="sparkles" title="No templates yet">Designers publish reusable templates from the advanced editor. Once approved they appear here.</EmptyState>}
      </section>
    </div>
  );
}
