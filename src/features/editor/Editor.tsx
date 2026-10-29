import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useExports } from '../../lib/exports';
import { useCan } from '../../lib/session';
import { Modal, Segmented, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { deserializeScene } from '../../../shared/scene/serialize';
import type { MotionPlayerHandle } from '../../components/MotionPlayer';
import { ControlWidgets } from '../../components/ControlWidgets';
import { Stage } from './Stage';
import { LeftPanel } from './LeftPanel';
import { CanvasSettings, Customise, Inspector } from './Inspector';
import { LIBRARY_CATEGORIES } from '../../../shared/motion/presets';
import { QuickMoves, Timeline } from './Animate';
import { InteractPanel } from './Interact';
import {
  clearDraft, deleteLayer, duplicateLayer, initEditor, readDraft, redo, resolveConflict, save, select, setMode, setPlaying, setProp, undo, useEditor, type Mode,
} from './store';
import './editor.css';

const MODES: { key: Mode; label: string; icon: string; hint: string }[] = [
  { key: 'design', label: 'Design', icon: 'layers', hint: 'Draw and arrange' },
  { key: 'animate', label: 'Animate', icon: 'film', hint: 'Make moves' },
  { key: 'interact', label: 'Interact', icon: 'crosshair', hint: 'Controls and rules' },
  { key: 'try', label: 'Try it', icon: 'play', hint: 'Play with it' },
];

export default function Editor() {
  const { id } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const doc = useEditor((s) => s.doc);
  const mode = useEditor((s) => s.mode);
  const selection = useEditor((s) => s.selection);
  const saveState = useEditor((s) => s.saveState);
  const conflict = useEditor((s) => s.conflict);
  const canUndo = useEditor((s) => s.past.length > 0), canRedo = useEditor((s) => s.future.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ doc: any; at: number } | null>(null);
  const [community, setCommunity] = useState<{ id: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const player = useRef<MotionPlayerHandle | null>(null);
  const [, bump] = useReducer((x) => x + 1, 0);
  const resolver = apiResolver();
  const readOnly = !can('scene.edit');

  useEffect(() => {
    if (!id) return;
    useEditor.setState({ doc: null, projectId: null });
    api(`/projects/${id}`).then((r) => {
      const d = deserializeScene(r.scene.doc);
      initEditor(id, d, r.scene.revision);
      setCommunity(r.community);
      const local = readDraft(id);
      if (local && local.baseRevision === r.scene.revision && JSON.stringify(local.doc) !== JSON.stringify(d)) setDraft({ doc: local.doc, at: local.at });
    }).catch((e) => setError(errorMessage(e)));
  }, [id]);

  // Keyboard: undo/redo, delete, duplicate, nudge, play.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); return; }
      if (typing) return;
      const st = useEditor.getState(), sel = st.selection, d = st.doc;
      if (e.key === ' ' && st.mode === 'animate') { e.preventDefault(); setPlaying(!st.playing); return; }
      if (!sel || !d || st.mode === 'try' || st.mode === 'interact') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteLayer(sel); }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateLayer(sel); }
      if (e.key === 'Escape') select(null);
      const step = e.shiftKey ? 10 : 1;
      const l = d.layers.find((x) => x.id === sel);
      if (l && e.key.startsWith('Arrow')) {
        e.preventDefault();
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setProp(sel, 'transform.x', l.transform.x + ((e.key === 'ArrowRight' ? 1 : -1) * step) / d.canvas.width, 'nudge');
        else setProp(sel, 'transform.y', l.transform.y + ((e.key === 'ArrowDown' ? 1 : -1) * step) / d.canvas.height, 'nudge');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onRuntimeChange = useCallback(() => bump(), []);
  if (error) return <div className="empty" style={{ height: '100%' }}><div className="h2">Couldn’t open this file</div><div>{error}</div><Link to="/" className="btn">Back to your files</Link></div>;
  if (!doc) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><div className="spinner" /></div>;
  const layer = doc.layers.find((l) => l.id === selection) ?? null;

  return (
    <div className="ed" style={mode === 'animate' ? undefined : { gridTemplateRows: '54px minmax(0, 1fr)' }}>
      <header className="ed-top">
        <button className="icon-btn" aria-label="Back to files" onClick={() => nav('/')}><Icon name="chevronLeft" /></button>
        <div className="col" style={{ gap: 0, minWidth: 0, maxWidth: 220 }}>
          <span className="ellipsis" style={{ fontWeight: 600, fontSize: 13.5 }}>{doc.meta.name}</span>
          <span className="faint" style={{ fontSize: 11 }}>{saveLabel(saveState)}{readOnly ? ' · view only' : ''}</span>
        </div>
        <div className="grow" />
        <nav className="modes" aria-label="Editor mode">
          {MODES.map((m) => <button key={m.key} aria-pressed={mode === m.key} title={m.hint} onClick={() => setMode(m.key)}><Icon name={m.icon as any} size={13} />{m.label}</button>)}
        </nav>
        <div className="grow" />
        <button className="icon-btn" aria-label="Undo" disabled={!canUndo} onClick={undo}><Icon name="undo" /></button>
        <button className="icon-btn" aria-label="Redo" disabled={!canRedo} onClick={redo}><Icon name="redo" /></button>
        {can('export.create') && <button className="btn" onClick={() => setExporting(true)}><Icon name="download" size={14} />Export</button>}
        {can('community.publish') && <button className="btn primary" onClick={() => setSharing(true)}><Icon name="globe" size={14} />{community ? 'Update Community post' : 'Add to Community'}</button>}
      </header>

      {mode === 'try' ? <div className="ed-left"><div className="sec"><div className="sec-h">Try it</div><div className="empty-hint">This is exactly how it behaves for people. Use the controls on the right, and click or hover things on the canvas.</div></div></div> : <LeftPanel doc={doc} />}
      <Stage doc={doc} assets={resolver} playerRef={player} onRuntimeChange={onRuntimeChange} />
      <aside className="ed-right" aria-label="Properties">
        {mode === 'design' && (layer ? <Inspector doc={doc} layer={layer} /> : <CanvasSettings doc={doc} />)}
        {mode === 'animate' && <><QuickMoves layer={layer} />{layer && <Inspector doc={doc} layer={layer} />}</>}
        {mode === 'interact' && <InteractPanel doc={doc} />}
        {mode === 'try' && <Customise doc={doc} />}
        {mode === 'try' && <div className="sec"><div className="sec-h">Controls</div><ControlWidgets doc={doc} runtime={player.current?.runtime ?? null} onReset={() => player.current?.reset()} /></div>}
      </aside>
      {mode === 'animate' && <Timeline doc={doc} />}

      <Modal open={!!draft} onClose={() => { if (id) clearDraft(id); setDraft(null); }} title="Recover unsaved changes?" subtitle={draft ? `Changes from ${new Date(draft.at).toLocaleString()} weren’t saved to the server.` : ''}
        footer={<><button className="btn ghost" onClick={() => { if (id) clearDraft(id); setDraft(null); }}>Discard</button><button className="btn primary" onClick={() => { const d = deserializeScene(draft!.doc); useEditor.setState({ doc: d, saveState: 'dirty' }); save(true); setDraft(null); }}>Recover</button></>}><div /></Modal>
      <Modal open={!!conflict} onClose={() => {}} title="Someone else saved this file" subtitle={`${conflict?.updatedBy ?? 'Another person'} saved a newer version while you were editing.`}
        footer={<><button className="btn" onClick={() => resolveConflict('theirs')}>Use their version</button><button className="btn primary" onClick={() => resolveConflict('mine')}>Keep mine</button></>}><div className="empty-hint">“Keep mine” saves your version over theirs (theirs stays in the history).</div></Modal>
      {sharing && id && <ShareDialog projectId={id} name={doc.meta.name} category={doc.meta.category} existing={community} onClose={() => setSharing(false)} onDone={(c) => { setCommunity(c); setSharing(false); }} />}
      {exporting && id && <ExportDialog projectId={id} doc={doc} onClose={() => setExporting(false)} />}
    </div>
  );
}

const saveLabel = (s: string) => ({ saved: 'All changes saved', dirty: 'Saving soon…', saving: 'Saving…', offline: 'Offline — kept on this device', conflict: 'Needs your attention', error: 'Couldn’t save' } as Record<string, string>)[s] ?? s;

function ShareDialog({ projectId, name, category: initial, existing, onClose, onDone }: { projectId: string; name: string; category?: string; existing: { id: string } | null; onClose: () => void; onDone: (c: { id: string }) => void }) {
  const [title, setTitle] = useState(name);
  const [category, setCategory] = useState<string>(LIBRARY_CATEGORIES.includes(initial as any) ? initial! : '');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await save(true);
      const r = await api('/community', { body: { projectId, title, description, ...(category ? { category } : {}), tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 6) } });
      toast('ok', r.updated ? 'Community post updated' : 'Shared with the community', 'Anyone on this server can now try and remix it.', { label: 'View', run: () => window.open(`/community/${r.id}`, '_self') });
      onDone({ id: r.id });
    } catch (e) { toast('danger', 'Couldn’t share', errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={existing ? 'Update your Community post' : 'Add to the Community'} subtitle="Everyone on this server can find it by category, try it and remix their own copy. Your file stays yours — they get a copy."
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || title.trim().length < 2} onClick={go}>{busy ? <span className="spinner" /> : existing ? 'Update post' : 'Share'}</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <label className="col" style={{ gap: 4 }}><span className="label">Title</span><input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="col" style={{ gap: 4 }}><span className="label">Category</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">No category</option>
            {LIBRARY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="col" style={{ gap: 4 }}><span className="label">What does it do? <span className="faint">(optional)</span></span><textarea className="input" rows={3} style={{ height: 'auto', padding: 8 }} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tap the switch to turn it on." /></label>
        <label className="col" style={{ gap: 4 }}><span className="label">Tags <span className="faint">(comma separated)</span></span><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="toggle, button, ui" /></label>
        <div className="empty-hint">Images and sounds in your file are copied into the post. You can unpublish any time from the post page.</div>
      </div>
    </Modal>
  );
}

function ExportDialog({ projectId, doc, onClose }: { projectId: string; doc: any; onClose: () => void }) {
  const create = useExports((s) => s.create);
  const [what, setWhat] = useState<'mp4' | 'png' | 'scene-json'>('mp4');
  const [anim, setAnim] = useState<string>(doc.machine.animations[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const a = doc.machine.animations.find((x: any) => x.id === anim);
  const go = async () => {
    setBusy(true);
    try {
      const W = doc.canvas.width - (doc.canvas.width % 2), H = doc.canvas.height - (doc.canvas.height % 2);
      const source = { kind: 'project', id: projectId, ...(what !== 'scene-json' && anim ? { animationId: anim } : {}) };
      const settings = what === 'mp4' ? { width: W, height: H, fps: 30, duration: Math.max(0.5, Math.min(120, (a?.duration ?? doc.canvas.duration) * (a && a.loop !== 'once' ? 2 : 1))), startTime: 0, loops: 1, quality: 'high', background: null }
        : what === 'png' ? { width: W, height: H, time: a ? a.duration : 0, background: 'scene' } : {};
      await create({ source, format: what, settings, name: a && what !== 'scene-json' ? `${doc.meta.name} – ${a.name}` : doc.meta.name });
      toast('info', 'Export started', 'It renders in the background — find it under the download icon.');
      onClose();
    } catch (e) { toast('danger', 'Export didn’t start', errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Export" subtitle="Interactive files export one move at a time as video or a still, or whole as a motion file."
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (what !== 'scene-json' && !!doc.machine.animations.length && !anim)} onClick={go}>{busy ? <span className="spinner" /> : 'Export'}</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Segmented value={what} onChange={setWhat} options={[{ value: 'mp4', label: 'Video (MP4)' }, { value: 'png', label: 'Still (PNG)' }, { value: 'scene-json', label: 'Motion file (.json)' }]} label="Export as" />
        {what !== 'scene-json' && doc.machine.animations.length > 0 && (
          <label className="col" style={{ gap: 4 }}><span className="label">Which move?</span>
            <select className="input" value={anim} onChange={(e) => setAnim(e.target.value)}>{doc.machine.animations.map((x: any) => <option key={x.id} value={x.id}>{x.name} · {x.duration}s{x.loop !== 'once' ? ' (repeats)' : ''}</option>)}</select>
          </label>
        )}
        <div className="empty-hint">{what === 'mp4' ? `${doc.canvas.width}×${doc.canvas.height}, 30 fps. Repeating moves are rendered twice so the loop is visible.` : what === 'png' ? 'The last frame of the move.' : 'Everything — layers, moves, controls and rules — to back up or import later.'}</div>
      </div>
    </Modal>
  );
}
