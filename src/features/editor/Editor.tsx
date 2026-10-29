import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useExports } from '../../lib/exports';
import { useCan } from '../../lib/session';
import { Modal, Popover, Segmented, Tip, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { deserializeScene } from '../../../shared/scene/serialize';
import type { MotionPlayerHandle } from '../../components/MotionPlayer';
import { ControlWidgets } from '../../components/ControlWidgets';
import { Stage } from './Stage';
import { LayersPanel } from './LayersPanel';
import { CreationRail } from './CreationRail';
import { clamp, setLayout, toggleFocus, useLayout } from './layout';
import { CanvasSettings, Customise, Inspector } from './Inspector';
import { LIBRARY_CATEGORIES } from '../../../shared/motion/presets';
import { QuickMoves, Timeline } from './Animate';
import { Debugger } from './interact/Debugger';
import { AssistantPanel } from './Assistant';
import { Tour, tourSeen } from './Tour';
import { InteractPanel } from './Interact';
import {
  clearDraft, commit, deleteLayer, duplicateLayer, initEditor, readDraft, redo, resolveConflict, save, select, setMode, setPlaying, setProp, undo, useEditor, type Mode,
} from './store';
import './editor.css';

/** The three editing workspaces. Previewing is an action available from any of them, not a fourth mode. */
const MODES: { key: Mode; label: string; hint: string; kbd: string }[] = [
  { key: 'design', label: 'Design', hint: 'Draw and arrange', kbd: '1' },
  { key: 'animate', label: 'Animate', hint: 'Make moves on a timeline', kbd: '2' },
  { key: 'interact', label: 'Interact', hint: 'Decide what happens when people touch it', kbd: '3' },
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
  const { assistant: asking, focus, left, right } = useLayout();
  const setAsking = (v: boolean) => setLayout({ assistant: v, askPrompt: null });
  // Preview remembers which workspace you came from, so stopping it takes you straight back.
  const before = useRef<Mode>('design');
  const preview = () => { const st = useEditor.getState(); if (st.mode === 'try') setMode(before.current); else { before.current = st.mode; setMode('try'); } };
  // First visit: show the tour once (also when opened with ?tour=1 from the Learn page).
  const [tour, setTour] = useState(() => {
    const asked = new URLSearchParams(location.search).has('tour');
    // A ?tour link works once: drop it from the address so a reload doesn't start the tour again.
    if (asked) history.replaceState(history.state, '', location.pathname);
    return asked || !tourSeen();
  });
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
      if (mod && e.key === '\\') { e.preventDefault(); toggleFocus(); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); previewRef.current(); return; }
      if (typing) return;
      if (!mod && !e.altKey && ['1', '2', '3'].includes(e.key) && !e.shiftKey) { setMode(MODES[Number(e.key) - 1].key); return; }
      if (e.key === 'Escape' && useEditor.getState().mode === 'try') { previewRef.current(); return; }
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

  const previewRef = useRef(preview);
  previewRef.current = preview;
  const onRuntimeChange = useCallback(() => bump(), []);
  if (error) return <div className="empty" style={{ height: '100%' }}><div className="h2">Couldn’t open this file</div><div>{error}</div><Link to="/" className="btn">Back to your files</Link></div>;
  if (!doc) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><div className="spinner" /></div>;
  const layer = doc.layers.find((l) => l.id === selection) ?? null;

  const previewing = mode === 'try';
  const showRail = !focus && (mode === 'design' || mode === 'animate');
  const showLeft = !focus && !previewing;
  const showRight = !focus;
  const cols = `${showRail ? '52px' : '0px'} ${showLeft ? `${left}px` : '0px'} minmax(0, 1fr) ${showRight ? `${right}px` : '0px'}`;
  return (
    <div className={`ed${focus ? ' focus' : ''}${previewing ? ' previewing' : ''}`} style={{ gridTemplateColumns: cols, gridTemplateRows: mode === 'animate' ? '56px minmax(0, 1fr) auto' : '56px minmax(0, 1fr)' }}>
      <header className="ed-top">
        <div className="ed-id">
          <Tip label="Back to files"><button className="icon-btn" aria-label="Back to files" onClick={() => nav('/')}><Icon name="chevronLeft" /></button></Tip>
          <div className="ed-title">
            <input className="ed-name" value={doc.meta.name} readOnly={readOnly} size={Math.max(8, Math.min(32, doc.meta.name.length + 1))} aria-label="File name"
              onChange={(e) => commit((d) => ({ ...d, meta: { ...d.meta, name: e.target.value || 'Untitled' } }), 'meta-name')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
            <span className="ellipsis"><i className={`dot ${saveState === 'saved' ? '' : saveState === 'error' || saveState === 'conflict' ? 'bad' : 'busy'}`} />{saveLabel(saveState)}{readOnly ? ' · view only' : ''}</span>
          </div>
        </div>
        <nav className="modes" aria-label="Workspace">
          {MODES.map((m) => <Tip key={m.key} label={m.hint} kbd={m.kbd}><button aria-label={m.label} aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</button></Tip>)}
        </nav>
        <div className="ed-actions">
          <Tip label="Undo" kbd="⌘Z"><button className="icon-btn" aria-label="Undo" disabled={!canUndo} onClick={undo}><Icon name="undo" /></button></Tip>
          <Tip label="Redo" kbd="⇧⌘Z"><button className="icon-btn" aria-label="Redo" disabled={!canRedo} onClick={redo}><Icon name="redo" /></button></Tip>
          <Tip label="How does this work? (tour)"><button className="icon-btn" aria-label="Show the tour" onClick={() => setTour(true)}><Icon name="info" /></button></Tip>
          <span className="vsep" />
          <Tip label={previewing ? 'Back to editing' : 'Preview it as a visitor would'} kbd={previewing ? 'Esc' : '⌘↵'}>
            <button className={`btn preview-btn${previewing ? ' on' : ''}`} aria-label={previewing ? 'Stop preview' : 'Preview'} aria-pressed={previewing} onClick={preview}><Icon name={previewing ? 'x' : 'play'} size={13} />{previewing ? 'Stop preview' : 'Preview'}</button>
          </Tip>
          {can('scene.edit') && <button className="btn ai-trigger" data-tour="ask" aria-pressed={asking} onClick={() => setAsking(!asking)}><span className="ai-orb sm" aria-hidden />Ask Claude</button>}
          {can('community.publish') && <ShareMenu community={community} onShare={() => setSharing(true)} />}
          {can('export.create') && <button className="btn primary" onClick={() => setExporting(true)}><Icon name="download" size={14} />Export</button>}
        </div>
      </header>

      {showRail ? <CreationRail doc={doc} /> : <div />}
      {showLeft ? <div className="ed-col"><LayersPanel doc={doc} /><Resizer side="left" /></div> : <div />}
      <Stage doc={doc} assets={resolver} playerRef={player} onRuntimeChange={onRuntimeChange} />
      {showRight ? (
        <div className="ed-col"><Resizer side="right" /><aside className="ed-right" aria-label={previewing ? 'Preview controls' : 'Properties'}>
          {mode === 'design' && (layer ? <Inspector doc={doc} layer={layer} /> : <CanvasSettings doc={doc} />)}
          {mode === 'animate' && <><QuickMoves layer={layer} />{layer && <Inspector doc={doc} layer={layer} />}</>}
          {mode === 'interact' && <InteractPanel doc={doc} />}
          {previewing && <div className="insp-empty">Previewing: this is exactly how it behaves for people. Hover, click and press keys on the canvas.</div>}
          {previewing && <Customise doc={doc} />}
          {previewing && <div className="sec"><div className="sec-h">Controls</div><ControlWidgets doc={doc} runtime={player.current?.runtime ?? null} onReset={() => player.current?.reset()} showLog={false} /></div>}
          {previewing && player.current?.runtime && <Debugger doc={doc} runtime={player.current.runtime} />}
        </aside></div>
      ) : <div />}
      {mode === 'animate' && <Timeline doc={doc} />}
      {focus && <button className="focus-exit metal-graphite" onClick={toggleFocus}><Icon name="maximize" size={13} />Exit focus mode<span className="kbd">{'⌘\\'}</span></button>}

      <Modal open={!!draft} onClose={() => { if (id) clearDraft(id); setDraft(null); }} title="Recover unsaved changes?" subtitle={draft ? `Changes from ${new Date(draft.at).toLocaleString()} weren’t saved to the server.` : ''}
        footer={<><button className="btn ghost" onClick={() => { if (id) clearDraft(id); setDraft(null); }}>Discard</button><button className="btn primary" onClick={() => { const d = deserializeScene(draft!.doc); useEditor.setState({ doc: d, saveState: 'dirty' }); save(true); setDraft(null); }}>Recover</button></>}><div /></Modal>
      <Modal open={!!conflict} onClose={() => {}} title="Someone else saved this file" subtitle={`${conflict?.updatedBy ?? 'Another person'} saved a newer version while you were editing.`}
        footer={<><button className="btn" onClick={() => resolveConflict('theirs')}>Use their version</button><button className="btn primary" onClick={() => resolveConflict('mine')}>Keep mine</button></>}><div className="empty-hint">“Keep mine” saves your version over theirs (theirs stays in the history).</div></Modal>
      {asking && <AssistantPanel doc={doc} assets={resolver} onClose={() => setAsking(false)} />}
      {tour && <Tour onDone={() => setTour(false)} />}
      {sharing && id && <ShareDialog projectId={id} name={doc.meta.name} category={doc.meta.category} existing={community} onClose={() => setSharing(false)} onDone={(c) => { setCommunity(c); setSharing(false); }} />}
      {exporting && id && <ExportDialog projectId={id} doc={doc} onClose={() => setExporting(false)} />}
    </div>
  );
}

const saveLabel = (s: string) => ({ saved: 'All changes saved', dirty: 'Saving soon…', saving: 'Saving…', offline: 'Offline. Kept on this device', conflict: 'Needs your attention', error: 'Couldn’t save' } as Record<string, string>)[s] ?? s;

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
    <Modal open onClose={onClose} title={existing ? 'Update your Community post' : 'Add to the Community'} subtitle="Everyone on this server can find it by category, try it and remix their own copy. Your file stays yours. They get a copy."
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
      toast('info', 'Export started', 'It renders in the background. Find it under the download icon.');
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
        <div className="empty-hint">{what === 'mp4' ? `${doc.canvas.width}×${doc.canvas.height}, 30 fps. Repeating moves are rendered twice so the loop is visible.` : what === 'png' ? 'The last frame of the move.' : 'Everything. Layers, moves, controls and rules. To back up or import later.'}</div>
      </div>
    </Modal>
  );
}

/** Sharing lives in one menu, so Export can be the single primary action. */
function ShareMenu({ community, onShare }: { community: { id: string } | null; onShare: () => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchor} className="btn" data-tour="share" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="globe" size={14} />Share<Icon name="chevronDown" size={11} /></button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="bottom-end">
        <div className="menu" role="menu" style={{ minWidth: 250 }}>
          <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); onShare(); }}><Icon name="globe" />{community ? 'Update Community post' : 'Add to Community'}</button>
          {community && <a role="menuitem" className="menu-item" href={`/community/${community.id}`}><Icon name="external" />View your post</a>}
          <button role="menuitem" className="menu-item" onClick={() => { void navigator.clipboard?.writeText(location.href); toast('ok', 'Link copied', 'Anyone in this workspace with access can open it.'); setOpen(false); }}><Icon name="link" />Copy link to this file</button>
        </div>
      </Popover>
    </>
  );
}

/** Drag the edge of a side panel to resize it; double-click puts it back. */
function Resizer({ side }: { side: 'left' | 'right' }) {
  const width = useLayout((s) => s[side]);
  const [min, max, def] = side === 'left' ? [200, 380, 248] : [264, 420, 304];
  return (
    <div className={`col-resize ${side}`} role="separator" aria-orientation="vertical" aria-label={`Resize the ${side === 'left' ? 'layers' : 'properties'} panel`} title="Drag to resize · double-click to reset"
      onDoubleClick={() => setLayout({ [side]: def })}
      onPointerDown={(e) => {
        e.preventDefault();
        const x0 = e.clientX, w0 = width;
        const move = (ev: PointerEvent) => setLayout({ [side]: clamp(w0 + (side === 'left' ? 1 : -1) * (ev.clientX - x0), min, max) });
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
        document.body.style.cursor = 'col-resize';
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }} />
  );
}
