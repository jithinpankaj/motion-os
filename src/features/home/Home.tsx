import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { PlushButton } from '../../components/PlushButton';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useCan, useSession } from '../../lib/session';
import { heroNavigate, preload } from '../../lib/transition';
import { MotionTile } from '../../components/MotionTile';
import { EmptyState, Modal, timeAgo, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { deserializeScene } from '../../../shared/scene/serialize';
import { previewDoc } from '../../../shared/motion/runtime';
import { PostCard, type Post } from '../community/Community';

const SIZES = [
  { label: 'Square', w: 1080, h: 1080, hint: 'Posts, icons, cards' },
  { label: 'Portrait', w: 1080, h: 1350, hint: 'Feed posts' },
  { label: 'Story', w: 1080, h: 1920, hint: 'Stories, phone screens' },
  { label: 'Wide', w: 1920, h: 1080, hint: 'Web banners, slides' },
  { label: 'UI element', w: 800, h: 600, hint: 'Buttons, toggles, loaders' },
];

/** Your files, plus the two ways to start: from scratch or from a preset. */
export default function Home() {
  const user = useSession((s) => s.user);
  const can = useCan();
  const nav = useNavigate();
  const [files, setFiles] = useState<any[] | null>(null);
  const [presets, setPresets] = useState<Post[]>([]);
  const [recent, setRecent] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [blank, setBlank] = useState(false);
  const [q, setQ] = useState('');
  const resolver = apiResolver();
  const load = () => {
    if (can('scene.view')) api('/projects').then((r) => setFiles(r.projects.map((p: any) => ({ ...p, doc: deserializeScene(p.doc) })))).catch((e) => setError(errorMessage(e)));
    else setFiles([]);
    api('/community', { noWorkspace: true, query: { sort: 'presets' } }).then((r) => setPresets(r.posts.map((p: Post) => ({ ...p, doc: deserializeScene(p.doc) })))).catch(() => {});
    api('/community', { noWorkspace: true, query: { sort: 'recent' } }).then((r) => setRecent(r.posts.filter((p: Post) => !p.isPreset).slice(0, 4).map((p: Post) => ({ ...p, doc: deserializeScene(p.doc) })))).catch(() => {});
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (files ?? []).filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase())), [files, q]);

  const remix = async (p: Post) => {
    try { const r = await api(`/community/${p.id}/remix`, { method: 'POST' }); nav(`/edit/${r.id}`); } catch (e) { toast('danger', 'Couldn’t start from that preset', errorMessage(e)); }
  };
  const create = async (w: number, h: number, label: string) => {
    try { const r = await api('/projects', { body: { name: `Untitled ${label.toLowerCase()}`, width: w, height: h } }); nav(`/edit/${r.id}`); } catch (e) { toast('danger', 'Couldn’t create a file', errorMessage(e)); }
  };
  const del = async (id: string, name: string) => {
    if (!confirm(`Move “${name}” to the bin?`)) return;
    try { await api(`/projects/${id}`, { method: 'DELETE' }); setFiles((f) => f?.filter((x) => x.id !== id) ?? null); } catch (e) { toast('danger', 'Couldn’t delete', errorMessage(e)); }
  };

  const [learnHidden, setLearnHidden] = useState(() => { try { return localStorage.getItem('mos.learn.hidden') === '1'; } catch { return false; } });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <div className="page-inner home">
      <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }} className="home-hero">
        <div>
          <div className="eyebrow">{greeting}, {user?.name.split(' ')[0]}</div>
          <h1 className="display">What are we<br />animating today?</h1>
          <p className="lead">Draw something, give it moves, and make it react to clicks, toggles and sliders.</p>
        </div>
        {can('scene.create') && <PlushButton label="New file" icon={<Icon name="plus" size={17} />} onClick={() => setBlank(true)} />}
      </motion.header>
      {!learnHidden && (
        <div className="learn-banner">
          <Icon name="library" size={16} />
          <span><b>New here?</b> A five minute guide walks you through Design, Animate, Interact and Try it.</span>
          <Link to="/learn" className="btn sm primary">Show me how</Link>
          <button className="icon-btn sm" aria-label="Hide this tip" onClick={() => { try { localStorage.setItem('mos.learn.hidden', '1'); } catch { /* private mode */ } setLearnHidden(true); }}><Icon name="x" size={12} /></button>
        </div>
      )}

      {can('scene.create') && presets.length > 0 && (
        <section className="home-section">
          <div className="home-section-h">
            <div><h2 className="h2">Start from a preset</h2><p className="home-note">Clicking one makes your own copy to edit.</p></div>
            <Link to="/community?sort=presets" className="ed-more">All presets<Icon name="chevronRight" size={13} /></Link>
          </div>
          <div className="home-grid">
            {presets.slice(0, 4).map((p) => <PostCard key={p.id} p={p} onOpen={() => remix(p)} />)}
          </div>
        </section>
      )}

      <section className="home-section">
        <div className="home-section-h">
          <div><h2 className="h2">Your files</h2>{files && files.length > 0 && <p className="home-note">{files.length} {files.length === 1 ? 'file' : 'files'}</p>}</div>
          {files && files.length > 6 && <input className="input" style={{ width: 240 }} placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search files" />}
        </div>
        {error && <EmptyState icon="alert" title="Couldn’t load your files">{error}</EmptyState>}
        {!files && !error && <div className="home-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ aspectRatio: '1' }} />)}</div>}
        {files && !files.length && <EmptyState icon="sparkles" title="No files yet" action={can('scene.create') && <button className="btn primary" onClick={() => setBlank(true)}>Start from scratch</button>}>Start from scratch or pick a preset above.</EmptyState>}
        <div className="home-grid">
          {shown.map((f) => (
            <div key={f.id} className="home-file">
              <MotionTile id={f.id} doc={previewDoc(f.doc)} assets={resolver} aspect="1 / 1" title={f.name}
                subtitle={`Edited ${timeAgo(f.updated_at)}`}
                onHover={preload.editor} onOpen={(from) => heroNavigate(nav, `/edit/${f.id}`, from)} />
              {can('scene.delete') && <button className="icon-btn sm home-del" aria-label={`Delete ${f.name}`} onClick={() => del(f.id, f.name)}><Icon name="trash" size={12} /></button>}
            </div>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="home-section">
          <div className="home-section-h">
            <div><h2 className="h2">New in the community</h2><p className="home-note">Fresh work from everyone on this server.</p></div>
            <Link to="/community" className="ed-more">Community<Icon name="chevronRight" size={13} /></Link>
          </div>
          <div className="home-grid">{recent.map((p) => <PostCard key={p.id} p={p} onOpen={(from) => heroNavigate(nav, `/community/${p.id}`, from)} />)}</div>
        </section>
      )}

      <Modal open={blank} onClose={() => setBlank(false)} title="New file" subtitle="Pick a size. You can change it later.">
        <div className="col" style={{ gap: 8 }}>
          {SIZES.map((s) => (
            <button key={s.label} className="move" style={{ padding: 12 }} onClick={() => { setBlank(false); create(s.w, s.h, s.label); }}>
              <span style={{ width: 34, display: 'grid', placeItems: 'center' }}><span style={{ display: 'block', width: 30 * Math.min(1, s.w / s.h), height: 30 * Math.min(1, s.h / s.w), border: '1.5px solid var(--text-2)', borderRadius: 3 }} /></span>
              <span className="grow">{s.label}<small>{s.hint} · {s.w}×{s.h}</small></span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

