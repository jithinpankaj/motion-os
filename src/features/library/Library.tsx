import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useCan } from '../../lib/session';
import { heroNavigate, preload } from '../../lib/transition';
import { MotionTile } from '../../components/MotionTile';
import { EmptyState, StatusBadge, Tabs, timeAgo } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { deserializeScene } from '../../../shared/scene/serialize';

const Explore = lazy(() => import('../explore/Explore'));

/** One place for everything made: your team's motions and the approved brand templates. */
export default function Library() {
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const canMine = can('scene.view');
  const tab = (sp.get('tab') === 'templates' || !canMine ? 'templates' : 'mine') as 'mine' | 'templates';
  return (
    <div className="page-inner">
      <div className="row between wrap" style={{ alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div className="eyebrow">Library</div>
          <h1 className="h1" style={{ marginTop: 8 }}>Everything in motion</h1>
        </div>
        {can('scene.create') && <Link to="/create" className="btn primary lg"><Icon name="plus" />Create</Link>}
      </div>
      <div style={{ marginTop: 20 }}>
        <Tabs value={tab} onChange={(v) => setSp(v === 'mine' ? {} : { tab: v })} label="Library" tabs={[
          ...(canMine ? [{ value: 'mine' as const, label: 'Our motions' }] : []),
          ...(can('library.view') ? [{ value: 'templates' as const, label: 'Brand templates' }] : []),
        ]} />
      </div>
      <div style={{ marginTop: 22 }}>
        {tab === 'mine' ? <Mine /> : <Suspense fallback={<div className="skel" style={{ height: 300 }} />}><Explore embedded /></Suspense>}
      </div>
    </div>
  );
}

function Mine() {
  const [list, setList] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const can = useCan();
  const resolver = apiResolver();
  useEffect(() => { api('/projects').then((r) => setList(r.projects.map((p: any) => ({ ...p, doc: deserializeScene(p.doc) })))).catch((e) => setError(errorMessage(e))); }, []);
  const shown = (list ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  if (error) return <EmptyState icon="alert" title="Couldn’t load motions">{error}</EmptyState>;
  if (!list) return <div className="mgrid">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ aspectRatio: '4/5' }} />)}</div>;
  if (!list.length) return <EmptyState icon="sparkles" title="Nothing here yet" action={can('scene.create') && <Link className="btn primary" to="/create">Animate your first design</Link>}>Upload a design and pick how it moves — it takes a minute.</EmptyState>;
  return (
    <>
      <input className="input" style={{ width: 260, marginBottom: 18 }} placeholder="Search motions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search motions" />
      <div className="mgrid">
        {shown.map((p) => (
          <MotionTile key={p.id} id={p.id} doc={p.doc} assets={resolver} title={p.name} subtitle={`${p.owner ?? ''} · ${timeAgo(p.updated_at)}`}
            badges={<>{p.template_status ? <StatusBadge status={p.template_status} /> : <span className="badge">{p.has_recipe ? 'made in Create' : 'advanced'}</span>}<span /></>}
            onHover={p.has_recipe ? undefined : preload.studio}
            onOpen={(f) => (p.has_recipe ? nav(`/create/${p.id}`) : heroNavigate(nav, `/studio/${p.id}`, f))} />
        ))}
      </div>
    </>
  );
}
