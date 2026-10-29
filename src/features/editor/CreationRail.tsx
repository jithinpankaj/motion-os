import { useEffect, useRef, useState } from 'react';
import type { SceneDocument } from '../../../shared/scene/schema';
import { useCan } from '../../lib/session';
import { Tip } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { ImportDesign, addImageFile } from './LayersPanel';
import { setLayout, useLayout } from './layout';
import { addLayer } from './store';

/**
 * The creation rail: a narrow column of monochrome tools. Shapes and effects are grouped into
 * flyouts (click the small corner arrow, press and hold, or right-click); the group's button adds
 * whichever one you used last. Anything in a flyout can be pinned to sit directly on the rail.
 */
const Glyph = ({ d }: { d: string }) => <svg className="i" viewBox="0 0 24 24"><path d={d} /></svg>;
type Tool = { key: string; label: string; glyph: string; kbd?: string; run: () => void };
const SHAPES: Tool[] = [
  { key: 'rect', label: 'Rectangle', glyph: 'M4 6h16v12H4z', kbd: 'R', run: () => addLayer('shape', {}, 'rect') },
  { key: 'ellipse', label: 'Ellipse', glyph: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', kbd: 'O', run: () => addLayer('shape', {}, 'ellipse') },
  { key: 'polygon', label: 'Polygon', glyph: 'M12 3l8 5v8l-8 5-8-5V8z', run: () => addLayer('shape', {}, 'polygon') },
  { key: 'star', label: 'Star', glyph: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z', run: () => addLayer('shape', {}, 'star') },
];
const EFFECTS: Tool[] = [
  { key: 'gradient', label: 'Gradient', glyph: 'M4 4h16v16H4zM4 14c5-6 11 2 16-4', run: () => addLayer('gradient', { name: 'Gradient background' }) },
  { key: 'particles', label: 'Particles', glyph: 'M6 7h.01M12 5h.01M18 8h.01M8 13h.01M15 12h.01M6 18h.01M12 17h.01M18 16h.01', run: () => addLayer('particles', { name: 'Particles' }) },
];
const TEXT: Tool = { key: 'text', label: 'Text', glyph: 'M5 6h14M12 6v13M9 19h6', kbd: 'T', run: () => addLayer('text', { name: 'Text' }) };
const ALL = [...SHAPES, ...EFFECTS];

export function CreationRail({ doc }: { doc: SceneDocument }) {
  const can = useCan();
  const { pins, lastShape, lastEffect } = useLayout();
  const [open, setOpen] = useState<'shapes' | 'effects' | null>(null);
  const [importing, setImporting] = useState(false);
  const image = useRef<HTMLInputElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const shape = SHAPES.find((t) => t.key === lastShape) ?? SHAPES[0];
  const effect = EFFECTS.find((t) => t.key === lastEffect) ?? EFFECTS[0];
  const use = (t: Tool) => { t.run(); if (SHAPES.includes(t)) setLayout({ lastShape: t.key }); if (EFFECTS.includes(t)) setLayout({ lastEffect: t.key }); setOpen(null); };
  const pin = (k: string) => setLayout({ pins: pins.includes(k) ? pins.filter((p) => p !== k) : [...pins, k] });

  // Single-key shortcuts, like most design tools (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === 'r') use(SHAPES[0]); else if (k === 'o') use(SHAPES[1]); else if (k === 't') use(TEXT);
      else if (k === 'i' && can('asset.upload')) image.current?.click();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Close a flyout on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!rail.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('pointerdown', off); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', esc); };
  }, [open]);

  const hold = useRef(0);
  const group = (name: 'shapes' | 'effects', current: Tool, tools: Tool[], label: string) => (
    <div className="rail-group">
      <Tip label={`${current.label} · hold for more`} kbd={current.kbd} side="right">
        <button className="rail-tool" aria-label={`Add ${current.label.toLowerCase()}`} onClick={() => use(current)}
          onPointerDown={() => { hold.current = window.setTimeout(() => setOpen(name), 380); }} onPointerUp={() => clearTimeout(hold.current)} onPointerLeave={() => clearTimeout(hold.current)}
          onContextMenu={(e) => { e.preventDefault(); setOpen(name); }}>
          <Glyph d={current.glyph} />
        </button>
      </Tip>
      <button className="rail-more" aria-label={`More ${label}`} aria-haspopup="menu" aria-expanded={open === name} onClick={() => setOpen(open === name ? null : name)}><svg viewBox="0 0 6 6" aria-hidden><path d="M6 0v6H0z" /></svg></button>
      {open === name && (
        <div className="rail-flyout metal-graphite" role="menu" aria-label={label}>
          <div className="rail-flyout-h">{label}</div>
          {tools.map((t) => (
            <div key={t.key} className="rail-fly-row">
              <button role="menuitem" className="rail-fly-item" onClick={() => use(t)}><Glyph d={t.glyph} /><span>{t.label}</span>{t.kbd && <span className="kbd">{t.kbd}</span>}</button>
              <button className="rail-pin" aria-pressed={pins.includes(t.key)} aria-label={pins.includes(t.key) ? `Unpin ${t.label}` : `Pin ${t.label} to the rail`} title={pins.includes(t.key) ? 'Unpin' : 'Pin to the rail'} onClick={() => pin(t.key)}>
                <svg className="i" viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <nav className="ed-rail" aria-label="Create" ref={rail}>
      {group('shapes', shape, SHAPES, 'Shapes')}
      <Tip label="Text" kbd="T" side="right"><button className="rail-tool" aria-label="Add text" onClick={() => use(TEXT)}><Glyph d={TEXT.glyph} /></button></Tip>
      {can('asset.upload') && <Tip label="Image" kbd="I" side="right"><button className="rail-tool" aria-label="Add an image" onClick={() => image.current?.click()}><Icon name="image" /></button></Tip>}
      {group('effects', effect, EFFECTS, 'Effects')}
      {pins.length > 0 && <span className="rail-sep" />}
      {pins.map((k) => ALL.find((t) => t.key === k)).filter(Boolean).map((t) => (
        <Tip key={t!.key} label={`${t!.label} (pinned)`} kbd={t!.kbd} side="right"><button className="rail-tool" aria-label={`Add ${t!.label.toLowerCase()}`} onClick={() => use(t!)}><Glyph d={t!.glyph} /></button></Tip>
      ))}
      <span className="grow" />
      {can('asset.upload') && <Tip label="Import a design (PNG, SVG, PDF, PSD, Figma)" side="right"><button className="rail-tool" aria-label="Import a design" onClick={() => setImporting(true)}><Icon name="upload" /></button></Tip>}
      <input ref={image} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImageFile(doc, f); e.target.value = ''; }} />
      {importing && <ImportDesign doc={doc} onClose={() => setImporting(false)} />}
    </nav>
  );
}
