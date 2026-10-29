import { useEffect, useMemo, useRef, useState } from 'react';
import type { Layer, SceneDocument } from '../../../shared/scene/schema';
import { importDesignFile, importFigma, type ImportedDesign } from '../../lib/designImport';
import { ApiError, errorMessage } from '../../lib/api';
import { Modal, Popover, Tip, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { addLayer, commit, deleteLayer, duplicateLayer, moveLayer, select, setProp, useEditor } from './store';
import { createLayer } from '../../../shared/scene/defaults';

const ICON: Record<string, string> = { shape: 'shapes', text: 'type', image: 'image', gradient: 'gradient', particles: 'sparkles', mesh: 'sphere', group: 'folder' };

/** Add one image file as a layer. */
export async function addImageFile(doc: SceneDocument, file: File) {
  try { placeDesign(doc, await importDesignFile(file), false); }
  catch (e) { toast('danger', 'Couldn’t add that image', e instanceof Error ? e.message : String(e)); }
}

type Row = { l: Layer; depth: number; hasKids: boolean };
/** Layers can be dragged onto the Interact map to make them react. */
export const LAYER_DRAG = 'application/x-mos-layer';

/**
 * The layer navigator: the file's real hierarchy as a tree (top-most first). Groups collapse;
 * search filters by name and keeps each match's parents; "Focus" narrows the list to the selected
 * layer, its parents and its contents. The structure itself is never changed behind your back.
 */
export function LayersPanel({ doc }: { doc: SceneDocument }) {
  const selection = useEditor((s) => s.selection);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState('');
  const [focusSel, setFocusSel] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Layer | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const tree = useRef<HTMLDivElement>(null);
  const animated = useMemo(() => new Set(doc.machine.animations.flatMap((a) => a.tracks.map((t) => t.layerId))), [doc.machine.animations]);
  const listening = useMemo(() => new Set(doc.machine.rules.flatMap((r) => (r.when.type === 'pointer' && r.when.layerId ? [r.when.layerId] : []))), [doc.machine.rules]);
  const byId = useMemo(() => new Map(doc.layers.map((l) => [l.id, l])), [doc.layers]);
  const kids = useMemo(() => {
    const m = new Map<string | null, Layer[]>();
    for (const l of doc.layers) { const k = l.parentId && byId.has(l.parentId) ? l.parentId : null; m.set(k, [...(m.get(k) ?? []), l]); }
    return m;
  }, [doc.layers, byId]);
  const ancestors = (id: string | null) => { const out: string[] = []; let p = id ? byId.get(id)?.parentId ?? null : null; while (p && byId.has(p) && out.length < 32) { out.push(p); p = byId.get(p)!.parentId; } return out; };

  // Selecting something on the canvas opens its parents and scrolls it into view.
  useEffect(() => {
    if (!selection) return;
    const up = ancestors(selection);
    if (up.some((a) => !open.has(a))) setOpen((o) => new Set([...o, ...up]));
    requestAnimationFrame(() => tree.current?.querySelector(`[data-id="${selection}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const out: Row[] = [];
    const needle = q.trim().toLowerCase();
    const keep = new Set<string>();
    if (needle) for (const l of doc.layers) if (l.name.toLowerCase().includes(needle)) { keep.add(l.id); ancestors(l.id).forEach((a) => keep.add(a)); }
    if (focusSel && selection) {
      keep.clear();
      [selection, ...ancestors(selection)].forEach((a) => keep.add(a));
      const walk = (id: string) => (kids.get(id) ?? []).forEach((c) => { keep.add(c.id); walk(c.id); });
      walk(selection);
    }
    const filtering = !!needle || (focusSel && !!selection);
    const visit = (parent: string | null, depth: number) => {
      for (const l of [...(kids.get(parent) ?? [])].reverse()) {
        if (filtering && !keep.has(l.id)) continue;
        const hasKids = (kids.get(l.id)?.length ?? 0) > 0;
        out.push({ l, depth, hasKids });
        if (hasKids && (filtering || open.has(l.id))) visit(l.id, depth + 1);
      }
    };
    visit(null, 0);
    return out;
  }, [doc.layers, kids, open, q, focusSel, selection]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string, to?: boolean) => setOpen((o) => { const n = new Set(o); (to ?? !n.has(id)) ? n.add(id) : n.delete(id); return n; });
  const groups = doc.layers.filter((l) => (kids.get(l.id)?.length ?? 0) > 0).map((l) => l.id);
  const flip = (l: Layer, key: 'visible' | 'locked') => commit((d) => ({ ...d, layers: d.layers.map((x) => (x.id === l.id ? { ...x, [key]: !x[key] } : x)) }));

  const onKey = (e: React.KeyboardEvent) => {
    if (renaming) return;
    const i = rows.findIndex((r) => r.l.id === selection);
    const r = rows[i];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) select(n.l.id); return; }
    if (!r) return;
    if (e.key === 'ArrowRight' && r.hasKids) { e.preventDefault(); toggle(r.l.id, true); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (r.hasKids && open.has(r.l.id)) toggle(r.l.id, false); else if (r.l.parentId) select(r.l.parentId); }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); setRenaming(r.l.id); }
  };

  return (
    <aside className="ed-left" aria-label="Layers">
      <div className="lp-head">
        <div className="lp-title">Layers <span className="faint">{doc.layers.length}</span></div>
        <Tip label="Expand all"><button className="icon-btn sm" aria-label="Expand all groups" onClick={() => setOpen(new Set(groups))}><Icon name="chevronDown" size={13} /></button></Tip>
        <Tip label="Collapse all"><button className="icon-btn sm" aria-label="Collapse all groups" onClick={() => setOpen(new Set())}><Icon name="chevronRight" size={13} /></button></Tip>
        <Tip label={selection ? 'Focus on selection' : 'Select a layer to focus on it'}><button className="icon-btn sm" aria-label="Focus on selection" aria-pressed={focusSel} disabled={!selection && !focusSel} onClick={() => setFocusSel(!focusSel)}><Icon name="crosshair" size={13} /></button></Tip>
      </div>
      <div className="lp-search">
        <Icon name="search" size={13} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a layer" aria-label="Find a layer" onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} />
        {q && <button className="icon-btn sm" aria-label="Clear search" onClick={() => setQ('')}><Icon name="x" size={11} /></button>}
      </div>
      {focusSel && selection && <button className="lp-focus" onClick={() => setFocusSel(false)}><Icon name="crosshair" size={11} />Showing the selection only<span>Show all</span></button>}
      {!doc.layers.length && <div className="lp-empty">Nothing here yet. Add a shape or text from the rail on the left.</div>}
      {doc.layers.length > 0 && !rows.length && <div className="lp-empty">No layer called “{q}”.</div>}
      <div className="layers" role="tree" aria-label="Layers" tabIndex={0} ref={tree} onKeyDown={onKey}>
        {rows.map(({ l, depth, hasKids }) => (
          <div key={l.id} data-id={l.id} role="treeitem" aria-level={depth + 1} aria-expanded={hasKids ? open.has(l.id) || !!q : undefined} aria-selected={selection === l.id}
            className={`layer-row${l.visible ? '' : ' hidden'}${l.locked ? ' locked' : ''}`} style={{ paddingLeft: 4 + depth * 14 }} onClick={() => select(l.id)}
            draggable={!renaming} onDragStart={(e) => { e.dataTransfer.setData(LAYER_DRAG, l.id); e.dataTransfer.setData('text/plain', l.name); e.dataTransfer.effectAllowed = 'link'; }}
            onContextMenu={(e) => { e.preventDefault(); select(l.id); menuAnchor.current = e.currentTarget; setMenu(l); }}>
            {hasKids
              ? <button className="lp-twist" aria-label={open.has(l.id) ? `Collapse ${l.name}` : `Expand ${l.name}`} onClick={(e) => { e.stopPropagation(); toggle(l.id); }}><Icon name={open.has(l.id) || q ? 'chevronDown' : 'chevronRight'} size={11} /></button>
              : <span className="lp-twist" />}
            <Icon name={(ICON[l.type] ?? 'layers') as any} size={13} />
            {renaming === l.id
              ? <input className="lp-rename" autoFocus defaultValue={l.name} aria-label="Layer name" onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { if (e.target.value.trim()) setProp(l.id, 'name', e.target.value.trim()); setRenaming(null); tree.current?.focus(); }}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setRenaming(null); tree.current?.focus(); } }} />
              : <span className="nm" onDoubleClick={() => setRenaming(l.id)} title="Double-click to rename">{l.name}</span>}
            {animated.has(l.id) && <span className="badge-dot" title="Animated in a move" aria-label="animated" />}
            {listening.has(l.id) && <span title="Something happens when people touch it"><Icon name="crosshair" size={11} /></span>}
            <span className="act">
              <button className={`icon-btn sm${l.locked ? ' on' : ''}`} aria-label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`} onClick={(e) => { e.stopPropagation(); flip(l, 'locked'); }}><Icon name={l.locked ? 'lock' : 'unlock'} size={12} /></button>
              <button className={`icon-btn sm${l.visible ? '' : ' on'}`} aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} onClick={(e) => { e.stopPropagation(); flip(l, 'visible'); }}><Icon name={l.visible ? 'eye' : 'eyeOff'} size={12} /></button>
              <button className="icon-btn sm" aria-label={`More actions for ${l.name}`} onClick={(e) => { e.stopPropagation(); select(l.id); menuAnchor.current = e.currentTarget; setMenu(l); }}><Icon name="more" size={12} /></button>
            </span>
          </div>
        ))}
      </div>
      <Popover anchor={menuAnchor} open={!!menu} onClose={() => setMenu(null)} placement="bottom-end">
        {menu && (
          <div className="menu" role="menu" aria-label={`${menu.name} actions`}>
            <button role="menuitem" className="menu-item" onClick={() => { setRenaming(menu.id); setMenu(null); }}><Icon name="type" />Rename<span className="faint">F2</span></button>
            <button role="menuitem" className="menu-item" onClick={() => { duplicateLayer(menu.id); setMenu(null); }}><Icon name="copy" />Duplicate<span className="faint">⌘D</span></button>
            <button role="menuitem" className="menu-item" onClick={() => { moveLayer(menu.id, 1); setMenu(null); }}><Icon name="chevronDown" className="flip" />Bring forward</button>
            <button role="menuitem" className="menu-item" onClick={() => { moveLayer(menu.id, -1); setMenu(null); }}><Icon name="chevronDown" />Send backward</button>
            <div className="menu-sep" />
            <button role="menuitem" className="menu-item" onClick={() => { flip(menu, 'visible'); setMenu(null); }}><Icon name={menu.visible ? 'eyeOff' : 'eye'} />{menu.visible ? 'Hide' : 'Show'}</button>
            <button role="menuitem" className="menu-item" onClick={() => { flip(menu, 'locked'); setMenu(null); }}><Icon name={menu.locked ? 'unlock' : 'lock'} />{menu.locked ? 'Unlock' : 'Lock'}</button>
            <div className="menu-sep" />
            <button role="menuitem" className="menu-item" style={{ color: 'var(--danger)' }} onClick={() => { deleteLayer(menu.id); setMenu(null); }}><Icon name="trash" />Delete<span className="faint">⌫</span></button>
          </div>
        )}
      </Popover>
    </aside>
  );
}

/** Add an imported design's parts as image layers, fitted into the artboard. */
function placeDesign(doc: SceneDocument, d: ImportedDesign, asGroup: boolean) {
  const W = doc.canvas.width, H = doc.canvas.height, m = Math.min(W, H);
  const s = Math.min(1, (W * 0.9) / d.width, (H * 0.9) / d.height);
  const dm = Math.min(d.width, d.height);
  const ox = (W - d.width * s) / 2, oy = (H - d.height * s) / 2;
  const layers = d.layers.map((p) => {
    const l = createLayer('image', { name: p.name, transform: { x: (ox + p.x * d.width * s) / W, y: (oy + p.y * d.height * s) / H, rotation: 0, scale: 1 } });
    l.props = { ...l.props, assetId: p.assetId, fit: 'contain', mask: 'none', radius: 0, width: Math.min(4, (p.w * dm * s) / m), height: Math.min(4, (p.h * dm * s) / m), reveal: { preset: 'none', start: 0, duration: 1, easing: 'easeOut' } };
    return l;
  });
  void asGroup;
  commit((x) => ({ ...x, layers: [...x.layers, ...layers] }));
  if (layers.length) select(layers[layers.length - 1].id);
  if (d.notes.length) toast('info', `Added ${layers.length} part${layers.length > 1 ? 's' : ''}`, d.notes[0]);
  else toast('ok', `Added ${layers.length} part${layers.length > 1 ? 's' : ''}`, layers.length > 1 ? 'Each part is its own layer, so it can move on its own.' : undefined);
}

export function ImportDesign({ doc, onClose }: { doc: SceneDocument; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [figma, setFigma] = useState('');
  const run = async (fn: () => Promise<ImportedDesign>) => {
    setError(null); setBusy('Reading your design…');
    try { placeDesign(doc, await fn(), true); onClose(); }
    catch (e) { setError(e instanceof ApiError && e.code === 'figma_not_connected' ? 'Connect Figma first in Settings → Connections (one-time personal access token).' : e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(null); }
  };
  return (
    <Modal open onClose={onClose} title="Import a design" subtitle="Layered files are split into parts, so each part can be animated on its own." wide>
      <div className="col" style={{ gap: 14 }}>
        <label className="drop" style={{ minHeight: 170 }}>
          {busy ? <><span className="spinner" /><div className="muted">{busy}</div></> : <>
            <Icon name="upload" size={22} />
            <div className="big" style={{ fontSize: 15 }}>Drop or choose a file</div>
            <div className="formats">{['PNG', 'JPG', 'SVG', 'PDF', 'AI', 'PSD'].map((f) => <span key={f}>{f}</span>)}</div>
          </>}
          <input type="file" aria-label="Upload a design" disabled={!!busy} accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.pdf,.ai,.psd,image/*,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => importDesignFile(f, { progress: setBusy })); e.target.value = ''; }} />
        </label>
        <div className="row">
          <input className="input grow" placeholder="…or paste a Figma frame link" value={figma} onChange={(e) => setFigma(e.target.value)} aria-label="Figma frame link" />
          <button className="btn" disabled={!figma.trim() || !!busy} onClick={() => run(() => importFigma(figma))}>Import</button>
        </div>
        {error && <div className="field-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

