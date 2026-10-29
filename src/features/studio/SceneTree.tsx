import { useRef, useState } from 'react';
import type { Layer, LayerType } from '../../../shared/scene/schema';
import { Icon } from '../../ui/Icon';
import { Menu, Popover, Tip } from '../../ui/controls';
import { useStudio, addLayer, select, updateLayer, removeLayers, duplicateLayers, groupLayers, ungroup, commit } from './store';

export const LAYER_ICON: Record<LayerType, string> = { group: 'folder', gradient: 'gradient', mesh: 'sphere', particles: 'sparkles', text: 'type', image: 'image' };
const ADD: { type: LayerType; label: string }[] = [
  { type: 'gradient', label: 'Gradient' }, { type: 'mesh', label: 'Mesh' }, { type: 'particles', label: 'Particles' },
  { type: 'text', label: 'Text' }, { type: 'image', label: 'Image' }, { type: 'group', label: 'Group' },
];

/** Displayed top-to-bottom = front-to-back (reverse of draw order), nested by group. */
function ordered(layers: Layer[]) {
  const out: { layer: Layer; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const l of layers.slice().reverse()) if (l.parentId === parent) { out.push({ layer: l, depth }); if (l.type === 'group') walk(l.id, depth + 1); }
  };
  walk(null, 0);
  return out;
}

export function SceneTree({ readOnly }: { readOnly: boolean }) {
  const { doc, selection, issues } = useStudio();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [ctx, setCtx] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [drop, setDrop] = useState<{ id: string; mode: 'before' | 'into' } | null>(null);
  const dragId = useRef<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const ctxRef = useRef<HTMLElement | null>(null);
  if (!doc) return null;
  const rows = ordered(doc.layers);

  const onDrop = (target: Layer, mode: 'before' | 'into') => {
    const id = dragId.current;
    setDrop(null);
    if (!id || id === target.id) return;
    commit((d) => {
      // prevent dropping a group into its own subtree
      let p: string | null = target.id;
      while (p) { if (p === id) return d; p = d.layers.find((l) => l.id === p)?.parentId ?? null; }
      const layers = d.layers.slice();
      const from = layers.findIndex((l) => l.id === id);
      const [moved] = layers.splice(from, 1);
      const ti = layers.findIndex((l) => l.id === target.id);
      // "before" in the list (above) means drawn after (on top) of the target
      const parentId = mode === 'into' ? target.id : target.parentId;
      layers.splice(mode === 'into' ? layers.length : ti + 1, 0, { ...moved, parentId });
      return { ...d, layers };
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.layer.id === selection[0]);
    if (e.key === 'ArrowDown') { e.preventDefault(); const r = rows[Math.min(rows.length - 1, i + 1)]; if (r) select([r.layer.id]); }
    if (e.key === 'ArrowUp') { e.preventDefault(); const r = rows[Math.max(0, i - 1)]; if (r) select([r.layer.id]); }
    if (e.key === 'Enter' && selection[0] && !readOnly) setRenaming(selection[0]);
  };

  return (
    <>
      <div className="panel-h">
        <span className="h3 grow">Layers</span>
        {!readOnly && <Tip label="Add layer"><button ref={addRef} className="icon-btn" onClick={() => setAddOpen(true)} aria-label="Add layer"><Icon name="plus" /></button></Tip>}
        <Popover anchor={addRef} open={addOpen} onClose={() => setAddOpen(false)}>
          <Menu onClose={() => setAddOpen(false)} items={ADD.map((a) => ({ label: a.label, icon: LAYER_ICON[a.type], onSelect: () => addLayer(a.type) }))} />
        </Popover>
      </div>
      <div className="scroll" role="tree" aria-label="Scene layers" tabIndex={0} onKeyDown={onKey} style={{ flex: 1, padding: '6px 0' }} onClick={(e) => { if (e.target === e.currentTarget) select([]); }}>
        {!rows.length && <div className="empty" style={{ padding: 24 }}><div className="faint">Empty scene. Add a gradient to start.</div>{!readOnly && <button className="btn sm" onClick={() => addLayer('gradient')}>Add gradient</button>}</div>}
        {rows.map(({ layer: l, depth }) => {
          const sel = selection.includes(l.id);
          const issue = issues.find((x) => x.layerId === l.id);
          return (
            <div key={l.id} role="treeitem" aria-selected={sel} aria-level={depth + 1} className={`tree-row ${!l.visible ? 'dim' : ''} ${drop?.id === l.id ? `drop-${drop.mode}` : ''}`}
              style={{ paddingLeft: 8 + depth * 14 }} draggable={!readOnly && renaming !== l.id}
              onDragStart={(e) => { dragId.current = l.id; e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDrop({ id: l.id, mode: l.type === 'group' && e.clientY > r.top + r.height * 0.35 ? 'into' : 'before' }); }}
              onDragLeave={() => setDrop(null)}
              onDrop={(e) => { e.preventDefault(); onDrop(l, drop?.mode ?? 'before'); }}
              onClick={(e) => select(e.shiftKey || e.metaKey ? (sel ? selection.filter((x) => x !== l.id) : [...selection, l.id]) : [l.id])}
              onDoubleClick={() => !readOnly && setRenaming(l.id)}
              onContextMenu={(e) => { e.preventDefault(); if (readOnly) return; select([l.id]); ctxRef.current = e.currentTarget; setCtx({ id: l.id, el: e.currentTarget }); }}>
              <span className="tree-ic"><Icon name={LAYER_ICON[l.type]} size={14} /></span>
              {renaming === l.id ? (
                <input autoFocus defaultValue={l.name} aria-label="Layer name" onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { updateLayer(l.id, (x) => ({ ...x, name: e.target.value.trim() || x.name })); setRenaming(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); e.stopPropagation(); }} />
              ) : <span className="grow ellipsis">{l.name}</span>}
              {issue && <Tip label={issue.message}><span style={{ color: 'var(--warn)', display: 'grid' }} aria-label={issue.message}><Icon name="alert" size={13} /></span></Tip>}
              {!readOnly && (
                <span className="tr-actions">
                  <button className={`icon-btn sm ${l.locked ? 'on' : ''}`} aria-label={l.locked ? 'Unlock layer' : 'Lock layer'} aria-pressed={l.locked} onClick={(e) => { e.stopPropagation(); updateLayer(l.id, (x) => ({ ...x, locked: !x.locked })); }}><Icon name={l.locked ? 'lock' : 'unlock'} /></button>
                  <button className={`icon-btn sm ${!l.visible ? 'on' : ''}`} aria-label={l.visible ? 'Hide layer' : 'Show layer'} aria-pressed={!l.visible} onClick={(e) => { e.stopPropagation(); updateLayer(l.id, (x) => ({ ...x, visible: !x.visible })); }}><Icon name={l.visible ? 'eye' : 'eyeOff'} /></button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <Popover anchor={ctxRef} open={!!ctx} onClose={() => setCtx(null)}>
        {ctx && (() => {
          const l = doc.layers.find((x) => x.id === ctx.id);
          if (!l) return null;
          const idx = doc.layers.indexOf(l);
          return <Menu onClose={() => setCtx(null)} items={[
            { label: 'Rename', icon: 'type', onSelect: () => setRenaming(l.id) },
            { label: 'Duplicate', icon: 'copy', hint: '⌘D', onSelect: () => duplicateLayers([l.id]) },
            { label: 'Group', icon: 'folder', hint: '⌘G', onSelect: () => groupLayers(selection.length ? selection : [l.id]) },
            ...(l.type === 'group' ? [{ label: 'Ungroup', icon: 'stack', onSelect: () => ungroup(l.id) }] : []),
            '-',
            { label: 'Bring forward', icon: 'chevronDown', disabled: idx === doc.layers.length - 1, onSelect: () => commit((d) => { const a = d.layers.slice(); [a[idx], a[idx + 1]] = [a[idx + 1], a[idx]]; return { ...d, layers: a }; }) },
            { label: 'Send backward', icon: 'chevronDown', disabled: idx === 0, onSelect: () => commit((d) => { const a = d.layers.slice(); [a[idx], a[idx - 1]] = [a[idx - 1], a[idx]]; return { ...d, layers: a }; }) },
            '-',
            { label: 'Delete', icon: 'trash', danger: true, hint: '⌫', onSelect: () => removeLayers([l.id]) },
          ]} />;
        })()}
      </Popover>
    </>
  );
}
