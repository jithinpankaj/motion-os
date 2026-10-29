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

/** Starting sizes. `motif` picks the little sketch drawn inside each card's artboard. */
const SIZES = [
  { label: 'Square', w: 1080, h: 1080, hint: 'Posts, icons, cards', motif: 'square' },
  { label: 'Portrait', w: 1080, h: 1350, hint: 'Feed posts', motif: 'portrait' },
  { label: 'Story', w: 1080, h: 1920, hint: 'Stories, phone screens', motif: 'story' },
  { label: 'Wide', w: 1920, h: 1080, hint: 'Web banners, slides', motif: 'wide' },
  { label: 'UI element', w: 800, h: 600, hint: 'Buttons, toggles, loaders', motif: 'ui' },
] as const;

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
          <span><b>New here?</b> A five minute guide walks you through Design, Animate, Interact and Preview.</span>
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

      <Modal open={blank} wide onClose={() => setBlank(false)} title="New file" subtitle="Pick a size to start from. You can change it later in the canvas settings.">
        <div className="size-grid">
          {SIZES.map((s) => (
            <button key={s.label} className="size-card" onClick={() => { setBlank(false); create(s.w, s.h, s.label); }}>
              <SizeArt w={s.w} h={s.h} motif={s.motif} />
              <span className="size-meta"><b>{s.label}</b><span>{s.hint}</span><span className="size-dims">{s.w} × {s.h}</span></span>
            </button>
          ))}
          <CustomSize onCreate={(w, h) => { setBlank(false); create(w, h, 'Custom'); }} />
        </div>
      </Modal>
    </div>
  );
}


/** A small artboard at the size's true proportions, with a hint of what usually goes in it. */
function SizeArt({ w, h, motif }: { w: number; h: number; motif: string }) {
  const k = Math.min(78 / w, 92 / h);
  return (
    <span className="size-stage" aria-hidden>
      <span className={`size-board m-${motif}`} style={{ width: Math.round(w * k), height: Math.round(h * k) }}>
        {motif === 'square' && <><i className="dot" /><i className="bar" /><i className="bar short" /></>}
        {motif === 'portrait' && <><i className="img" /><i className="bar" /><i className="bar short" /></>}
        {motif === 'story' && <><i className="notch" /><i className="img tall" /><i className="bar" /></>}
        {motif === 'wide' && <><i className="bar wide" /><i className="bar short" /><i className="pill" /></>}
        {motif === 'ui' && <i className="pill big" />}
      </span>
    </span>
  );
}

/** Any size: width and height in pixels, within what files support. */
function CustomSize({ onCreate }: { onCreate: (w: number, h: number) => void }) {
  const [w, setW] = useState('1200'), [h, setH] = useState('800');
  const n = (v: string) => Math.round(Number(v));
  const ok = [n(w), n(h)].every((v) => Number.isFinite(v) && v >= 16 && v <= 4096);
  const board = ok ? { w: n(w), h: n(h) } : { w: 1, h: 1 };
  return (
    <form className="size-card custom" onSubmit={(e) => { e.preventDefault(); if (ok) onCreate(n(w), n(h)); }}>
      <SizeArt w={board.w} h={board.h} motif="custom" />
      <span className="size-meta">
        <b>Custom</b>
        <span className="size-inputs">
          <input className="input" inputMode="numeric" value={w} onChange={(e) => setW(e.target.value)} aria-label="Width in pixels" />
          <span>×</span>
          <input className="input" inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} aria-label="Height in pixels" />
        </span>
        <button className="btn sm primary" type="submit" disabled={!ok}>{ok ? 'Create' : '16 to 4096 px'}</button>
      </span>
    </form>
  );
}
