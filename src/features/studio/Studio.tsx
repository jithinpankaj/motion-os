import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import './studio.css';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { Icon } from '../../ui/Icon';
import { Menu, Modal, Popover, StatusBadge, Tabs, Tip, timeAgo, toast } from '../../ui/controls';
import { deserializeScene, serializeScene } from '../../../shared/scene/serialize';
import { deepEqual } from '../../../shared/util/paths';
import { useStudio, initStudio, readDraft, clearDraft, commit, undo, redo, save, resolveConflict, removeLayers, duplicateLayers, groupLayers, selected, setProp, endCoalesce } from './store';
import { SceneTree } from './SceneTree';
import { Viewport } from './Viewport';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { ParamsPanel } from './ParamsPanel';
import { HistoryPanel } from './HistoryPanel';
import { PublishDialog } from './PublishDialog';
import { ExportPanel } from '../../components/ExportPanel';

export default function Studio() {
  const { id } = useParams();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ name: string; template: any } | null>(null);
  const [draftOffer, setDraftOffer] = useState<{ at: number; stale: boolean } | null>(null);
  const [publish, setPublish] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const s = useStudio();
  const can = useCan();
  const nav = useNavigate();
  const readOnly = !can('scene.edit');

  const reload = async () => {
    try {
      const r = await api(`/projects/${id}`);
      initStudio(r.project.id, r.scene.doc, r.scene.revision);
      setMeta({ name: r.project.name, template: r.template });
      const draft = readDraft(r.project.id);
      if (draft && !deepEqual(draft.doc, r.scene.doc)) setDraftOffer({ at: draft.at, stale: draft.baseRevision !== r.scene.revision });
      else if (draft) clearDraft(r.project.id);
    } catch (e) { setLoadError(errorMessage(e)); }
  };
  useEffect(() => { reload(); return () => { if (useStudio.getState().saveState === 'dirty') save(); }; /* eslint-disable-next-line */ }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = /input|textarea|select/i.test(el.tagName) || el.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      const st = useStudio.getState();
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (readOnly) { if (e.key === ' ') { e.preventDefault(); st.clock.toggle(); } return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (st.selection.length) duplicateLayers(st.selection); return; }
      if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); if (st.selection.length) groupLayers(st.selection); return; }
      if (e.key === ' ') { e.preventDefault(); st.clock.toggle(); return; }
      if (e.key === ',' || e.key === '.') { st.clock.step(e.key === '.' ? (e.shiftKey ? 10 : 1) : e.shiftKey ? -10 : -1); return; }
      if (e.key === 'Home') { st.clock.restart(); return; }
      if (e.key === 'f' || e.key === '\\') { useStudio.setState({ focus: !st.focus }); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.selection.length && !st.selectedKey) { e.preventDefault(); removeLayers(st.selection); return; }
      if (e.key.startsWith('Arrow') && st.selection.length) {
        const l = selected();
        if (!l || l.locked || l.type === 'gradient' || l.type === 'mesh') return;
        e.preventDefault();
        const d = st.doc!;
        const step = (e.shiftKey ? 10 : 1);
        const dx = e.key === 'ArrowLeft' ? -step / d.canvas.width : e.key === 'ArrowRight' ? step / d.canvas.width : 0;
        const dy = e.key === 'ArrowUp' ? -step / d.canvas.height : e.key === 'ArrowDown' ? step / d.canvas.height : 0;
        if (dx) setProp(l.id, 'transform.x', +(l.transform.x + dx).toFixed(5), `nudge:${l.id}`);
        if (dy) setProp(l.id, 'transform.y', +(l.transform.y + dy).toFixed(5), `nudge:${l.id}`);
      }
    };
    const onUp = () => endCoalesce();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  }, [readOnly]);

  if (loadError) return <div className="empty" style={{ height: '100vh' }}><Icon name="alert" /><div className="h2">Could not open this project</div><div>{loadError}</div><Link className="btn" to="/studio">Back to projects</Link></div>;
  if (!s.doc || s.projectId !== id) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><div className="spinner" /></div>;

  const exportScene = () => {
    const blob = new Blob([serializeScene(s.doc!, true)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${s.doc!.meta.name.replace(/\W+/g, '-').toLowerCase()}.motion.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const saveLabel = { saved: s.lastSavedAt ? `Saved` : 'Saved', dirty: 'Unsaved changes', saving: 'Saving…', offline: 'Offline — saved on this device', conflict: 'Conflict', error: 'Save failed' }[s.saveState];

  return (
    <div className={`studio ${s.focus ? 'focus' : ''}`}>
      <div className="st-top">
        <Tip label="Back to projects"><Link to="/studio" className="icon-btn" aria-label="Back to projects"><Icon name="chevronLeft" /></Link></Tip>
        <input className="input" aria-label="Scene name" style={{ width: 220, background: 'transparent', borderColor: 'transparent', fontWeight: 560 }} value={s.doc.meta.name} readOnly={readOnly}
          onChange={(e) => commit((d) => ({ ...d, meta: { ...d.meta, name: e.target.value || 'Untitled' } }), 'name')} />
        {meta?.template && <StatusBadge status={meta.template.status} label={`template ${meta.template.status}`} />}
        {readOnly && <span className="badge warn">view only</span>}
        <button className="save-pill" data-s={s.saveState} onClick={() => save(true)} title={s.saveError ?? (s.lastSavedAt ? `Last saved ${timeAgo(s.lastSavedAt)}` : '')} aria-live="polite"><span className="dot" />{saveLabel}</button>
        <div className="grow" />
        <Tip label="Undo" kbd="⌘Z"><button className="icon-btn" disabled={!s.past.length} onClick={undo} aria-label="Undo"><Icon name="undo" /></button></Tip>
        <Tip label="Redo" kbd="⇧⌘Z"><button className="icon-btn" disabled={!s.future.length} onClick={redo} aria-label="Redo"><Icon name="redo" /></button></Tip>
        <Tip label="Focus mode — hide panels" kbd="F"><button className={`icon-btn ${s.focus ? 'on' : ''}`} onClick={() => useStudio.setState({ focus: !s.focus })} aria-label="Toggle focus mode"><Icon name="maximize" /></button></Tip>
        <button ref={menuRef} className="icon-btn" onClick={() => setMenu(true)} aria-label="More actions"><Icon name="more" /></button>
        <Popover anchor={menuRef} open={menu} onClose={() => setMenu(false)} placement="bottom-end">
          <Menu onClose={() => setMenu(false)} items={[
            { label: 'Download scene JSON', icon: 'file', onSelect: exportScene },
            { label: 'Duplicate project', icon: 'copy', disabled: !can('scene.create'), onSelect: async () => { const r = await api(`/projects/${id}/duplicate`, { method: 'POST' }); nav(`/studio/${r.id}`); } },
            { label: 'Version history', icon: 'history', onSelect: () => useStudio.setState({ rightTab: 'history' }) },
            '-',
            { label: 'Delete project', icon: 'trash', danger: true, disabled: !can('scene.delete'), onSelect: async () => { if (!confirm('Delete this project? Published templates stay available.')) return; await api(`/projects/${id}`, { method: 'DELETE' }); clearDraft(id!); nav('/studio'); } },
          ]} />
        </Popover>
        <button className="btn" onClick={() => setExporting(true)}><Icon name="download" size={14} />Export</button>
        {can('template.submit') && <button className="btn primary" onClick={() => { save(true); setPublish(true); }}><Icon name="send" size={14} />Publish</button>}
      </div>

      <aside className="st-tree" aria-label="Scene hierarchy"><SceneTree readOnly={readOnly} /></aside>
      <section className="st-view" aria-label="Canvas"><Viewport readOnly={readOnly} /></section>
      <aside className="st-insp" aria-label="Properties">
        <Tabs label="Right panel" value={s.rightTab} onChange={(v) => useStudio.setState({ rightTab: v })} tabs={[{ value: 'inspect', label: 'Inspect' }, { value: 'params', label: `Parameters${s.doc.exposed.length ? ` · ${s.doc.exposed.length}` : ''}` }, { value: 'history', label: 'History' }]} />
        <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
          {s.rightTab === 'inspect' && <Inspector readOnly={readOnly} />}
          {s.rightTab === 'params' && <ParamsPanel readOnly={readOnly} />}
          {s.rightTab === 'history' && <HistoryPanel projectId={id!} onRestored={reload} />}
        </div>
      </aside>
      <section className="st-time" aria-label="Timeline"><Timeline readOnly={readOnly} /></section>

      <Modal open={!!draftOffer} onClose={() => { setDraftOffer(null); }} title="Recover unsaved changes?" subtitle={`This device has edits from ${draftOffer ? timeAgo(draftOffer.at) : ''} that never reached the server.`}
        footer={<>
          <button className="btn ghost" onClick={() => { clearDraft(id!); setDraftOffer(null); }}>Discard them</button>
          <button className="btn primary" onClick={() => { const d = readDraft(id!); if (d) { commit(() => deserializeScene(d.doc)); toast('ok', 'Unsaved changes restored'); } setDraftOffer(null); }}>Restore changes</button>
        </>}>
        {draftOffer?.stale ? <div className="row warn" style={{ color: 'var(--warn)' }}><Icon name="alert" />Someone saved this scene since then. Restoring will overwrite their version when you save — you can review in History afterwards.</div> : <div className="muted">Your browser kept a local copy (for example after a refresh or connection loss). Nothing is discarded unless you choose so.</div>}
      </Modal>

      <Modal open={s.saveState === 'conflict'} onClose={() => {}} title="This scene changed elsewhere" subtitle={`${s.conflict?.updatedBy ?? 'Another editor'} saved a newer version ${s.conflict ? timeAgo(s.conflict.updatedAt) : ''}.`}
        footer={<>
          <button className="btn" onClick={() => resolveConflict('theirs')}>Load their version</button>
          <button className="btn" onClick={async () => { const r = await api('/projects', { body: { name: `${s.doc!.meta.name} (my changes)`, scene: s.doc } }); resolveConflict('theirs'); nav(`/studio/${r.id}`); toast('ok', 'Your changes were saved as a new project'); }}>Save mine as a copy</button>
          <button className="btn primary" onClick={() => resolveConflict('mine')}>Keep mine</button>
        </>}>
        <div className="muted">Nothing has been overwritten yet. “Keep mine” replaces their save (theirs stays recoverable in History only if they saved a version). “Load their version” keeps yours in undo history.</div>
      </Modal>

      {publish && <PublishDialog projectId={id!} template={meta?.template} onClose={() => setPublish(false)} onChanged={reload} />}
      <Modal open={exporting} onClose={() => setExporting(false)} title="Export" subtitle="Rendered deterministically, frame by frame, in the background." wide>
        <ExportPanel doc={s.doc} source={{ kind: 'project', id }} name={s.doc.meta.name} time={s.clock.time} onQueued={() => setExporting(false)} />
      </Modal>
    </div>
  );
}
