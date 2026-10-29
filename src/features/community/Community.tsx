import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { communityResolver } from '../../lib/community';
import { heroNavigate, preload } from '../../lib/transition';
import { MotionTile } from '../../components/MotionTile';
import { EmptyState } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { deserializeScene } from '../../../shared/scene/serialize';
import { previewDoc } from '../../../shared/motion/runtime';

export type Post = { id: string; title: string; description: string; tags: string[]; author: string; isPreset: boolean; remixCount: number; likeCount: number; liked: boolean; publishedAt: string; mine: boolean; doc: any };

import { LIBRARY_CATEGORIES, categoryTag } from '../../../shared/motion/presets';
const CATEGORY_TAGS = new Set(LIBRARY_CATEGORIES.map(categoryTag));

/** The shared gallery: presets from the Motion OS team and everything people publish on this server. */
export default function Community() {
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<{ posts: Post[]; tags: { tag: string; n: number }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(sp.get('q') ?? '');
  const sort = (sp.get('sort') ?? 'recent') as 'recent' | 'popular' | 'presets';
  const tag = sp.get('tag');
  const nav = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => {
      api('/community', { noWorkspace: true, query: { q: q || undefined, tag: tag ?? undefined, sort } })
        .then((r) => setData({ ...r, posts: r.posts.map((p: Post) => ({ ...p, doc: deserializeScene(p.doc) })) }))
        .catch((e) => setError(errorMessage(e)));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q, tag, sort]);
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  return (
    <div className="page-inner home">
      <header className="home-hero">
        <div>
          <div className="eyebrow">Community</div>
          <h1 className="display">Try it,<br />then make it yours.</h1>
          <p className="lead">Interactive motion from everyone on this server. Open one to play with it, then remix your own copy.</p>
        </div>
        <div className="row surface comm-search">
          <Icon name="search" /><input className="grow" style={{ background: 'none', border: 0, outline: 'none' }} placeholder="Search toggles, loaders, cards…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the community" />
        </div>
      </header>
      <div className="comm-filters">
        <div className="row wrap" style={{ gap: 8 }}>
          {(['recent', 'popular', 'presets'] as const).map((s) => <button key={s} className="chip" aria-pressed={sort === s} onClick={() => set('sort', s === 'recent' ? null : s)}>{s === 'recent' ? 'Newest' : s === 'popular' ? 'Popular' : 'Motion OS library'}</button>)}
        </div>
        <div className="row wrap" style={{ gap: 8 }} role="group" aria-label="Categories">
          <button className="chip" aria-pressed={!tag || !CATEGORY_TAGS.has(tag)} onClick={() => set('tag', null)}>All categories</button>
          {LIBRARY_CATEGORIES.map((c) => <button key={c} className="chip" aria-pressed={tag === categoryTag(c)} onClick={() => set('tag', tag === categoryTag(c) ? null : categoryTag(c))}>{c}</button>)}
          {data?.tags.filter((t) => !CATEGORY_TAGS.has(t.tag)).slice(0, 6).map((t) => <button key={t.tag} className="chip" aria-pressed={tag === t.tag} onClick={() => set('tag', tag === t.tag ? null : t.tag)}>#{t.tag}</button>)}
        </div>
      </div>
      <div className="home-section" style={{ marginTop: 56 }}>
        {error && <EmptyState icon="alert" title="Community unavailable">{error}</EmptyState>}
        {!data && !error && <div className="home-grid">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" style={{ aspectRatio: '1' }} />)}</div>}
        {data && !data.posts.length && <EmptyState icon="globe" title="Nothing matches">Try another search, or clear the tag.</EmptyState>}
        <div className="home-grid">{data?.posts.map((p) => <PostCard key={p.id} p={p} onOpen={(f) => heroNavigate(nav, `/community/${p.id}`, f)} />)}</div>
      </div>
    </div>
  );
}

export function PostCard({ p, onOpen }: { p: Post; onOpen: (f: any) => void }) {
  const view = useMemo(() => previewDoc(p.doc), [p.doc]);
  const assets = useMemo(() => communityResolver(p.id), [p.id]);
  // One quiet line under the title: the category for library pieces, the author for everyone else.
  const meta = p.isPreset ? (p.doc.meta.category ?? 'Motion OS library') : `by ${p.author}`;
  return <MotionTile id={`cp-${p.id}`} doc={view} assets={assets} aspect="1 / 1" title={p.title} subtitle={meta} onHover={preload.community} onOpen={onOpen} />;
}
