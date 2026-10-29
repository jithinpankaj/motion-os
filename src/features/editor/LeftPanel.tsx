import { useRef, useState } from 'react';
import type { Layer, SceneDocument } from '../../../shared/scene/schema';
import { importDesignFile, importFigma, type ImportedDesign } from '../../lib/designImport';
import { ApiError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { Modal, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { addLayer, commit, deleteLayer, duplicateLayer, moveLayer, select, setProp, useEditor } from './store';
import { createLayer } from '../../../shared/scene/defaults';

const Glyph = ({ d }: { d: string }) => <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d={d} /></svg>;
const TOOLS = [
  { label: 'Rectangle', glyph: 'M4 6h16v12H4z', run: () => addLayer('shape', {}, 'rect') },
  { label: 'Circle', glyph: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', run: () => addLayer('shape', {}, 'ellipse') },
  { label: 'Polygon', glyph: 'M12 3l8 5v8l-8 5-8-5V8z', run: () => addLayer('shape', {}, 'polygon') },
  { label: 'Star', glyph: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z', run: () => addLayer('shape', {}, 'star') },
  { label: 'Text', glyph: 'M5 6h14M12 6v13M9 19h6', run: () => addLayer('text', { name: 'Text' }) },
  { label: 'Gradient', glyph: 'M4 4h16v16H4zM4 14c5-6 11 2 16-4', run: () => addLayer('gradient', { name: 'Gradient background' }) },
  { label: 'Particles', glyph: 'M6 7h.01M12 5h.01M18 8h.01M8 13h.01M15 12h.01M6 18h.01M12 17h.01M18 16h.01', run: () => addLayer('particles', { name: 'Particles' }) },
];
const ICON: Record<string, string> = { shape: 'layers', text: 'type', image: 'image', gradient: 'gradient', particles: 'sparkles', mesh: 'sphere', group: 'group' };

export function LeftPanel({ doc }: { doc: SceneDocument }) {
  const selection = useEditor((s) => s.selection);
  const mode = useEditor((s) => s.mode);
  const can = useCan();
  const [importing, setImporting] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const animated = new Set(doc.machine.animations.flatMap((a) => a.tracks.map((t) => t.layerId)));
  const listening = new Set(doc.machine.rules.flatMap((r) => (r.when.type === 'pointer' ? [r.when.layerId] : [])));

  const addImage = async (file: File) => {
    try {
      const d = await importDesignFile(file);
      placeDesign(doc, d, false);
    } catch (e) { toast('danger', 'Couldn’t add that image', e instanceof Error ? e.message : String(e)); }
  };

  // Layers are listed top-most first, like most design tools.
  const ordered = [...doc.layers].reverse();
  const depth = (l: Layer) => { let n = 0, p = l.parentId; while (p && n < 8) { n++; p = doc.layers.find((x) => x.id === p)?.parentId ?? null; } return n; };
  return (
    <aside className="ed-left" aria-label="Layers">
      {(mode === 'design' || mode === 'animate') && (
        <div className="sec">
          <div className="sec-h">Add</div>
          <div className="tools">
            {TOOLS.map((t) => <button key={t.label} className="tool" onClick={t.run} title={`Add ${t.label.toLowerCase()}`}><Glyph d={t.glyph} />{t.label}</button>)}
            {can('asset.upload') && <button className="tool" onClick={() => imageInput.current?.click()} title="Add an image"><Icon name="image" size={20} />Image</button>}
          </div>
          {can('asset.upload') && <button className="btn sm" onClick={() => setImporting(true)}><Icon name="upload" size={13} />Import a design</button>}
          <input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) addImage(f); e.target.value = ''; }} />
        </div>
      )}
      <div className="sec" style={{ borderBottom: 0 }}>
        <div className="sec-h">Layers <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 450 }}>{doc.layers.length}</span></div>
        {!doc.layers.length && <div className="empty-hint">Nothing here yet. Add a shape or text above.</div>}
        <div className="layers" role="listbox" aria-label="Layers">
          {ordered.map((l) => (
            <div key={l.id} role="option" aria-selected={selection === l.id} className="layer-row" style={{ paddingLeft: 6 + depth(l) * 14 }} onClick={() => select(l.id)}>
              <Icon name={(ICON[l.type] ?? 'layers') as any} size={13} />
              <span className="nm" onDoubleClick={() => { const n = prompt('Rename layer', l.name); if (n?.trim()) setProp(l.id, 'name', n.trim()); }} title="Double-click to rename">{l.name}</span>
              {animated.has(l.id) && <span className="badge-dot" title="Animated in a move" />}
              {listening.has(l.id) && <Icon name="crosshair" size={11} />}
              <span className="act row" style={{ gap: 0 }}>
                <button className="icon-btn sm" aria-label={`Move ${l.name} up`} onClick={(e) => { e.stopPropagation(); moveLayer(l.id, 1); }}><Icon name="chevronDown" size={11} className="flip" /></button>
                <button className="icon-btn sm" aria-label={`Move ${l.name} down`} onClick={(e) => { e.stopPropagation(); moveLayer(l.id, -1); }}><Icon name="chevronDown" size={11} /></button>
                <button className="icon-btn sm" aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} onClick={(e) => { e.stopPropagation(); commit((d) => ({ ...d, layers: d.layers.map((x) => (x.id === l.id ? { ...x, visible: !x.visible } : x)) })); }}><Icon name={l.visible ? 'eye' : 'eyeOff'} size={12} /></button>
              </span>
            </div>
          ))}
        </div>
        {selection && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm grow" onClick={() => duplicateLayer(selection)}><Icon name="copy" size={12} />Duplicate</button>
            <button className="btn sm grow" onClick={() => deleteLayer(selection)}><Icon name="trash" size={12} />Delete</button>
          </div>
        )}
      </div>
      {importing && <ImportDesign doc={doc} onClose={() => setImporting(false)} />}
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

function ImportDesign({ doc, onClose }: { doc: SceneDocument; onClose: () => void }) {
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

