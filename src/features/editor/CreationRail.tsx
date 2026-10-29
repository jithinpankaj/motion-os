import { useEffect, useRef, useState } from 'react';
import type { SceneDocument } from '../../../shared/scene/schema';
import { useCan } from '../../lib/session';
import { Tip } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { ImportDesign, addImageFile } from './LayersPanel';
import { setLayout, useLayout } from './layout';
import { addLayer } from './store';
import { GRADIENTS, TEXTURES, addEffect } from './effects';
import { finishDrawing, startDrawing } from './Draw';

type Group = 'shapes' | 'gradients' | 'effects';

/**
 * The creation rail: a narrow column of monochrome tools. Shapes and effects are grouped into
 * flyouts (click the small corner arrow, press and hold, or right-click); the group's button adds
 * whichever one you used last. Anything in a flyout can be pinned to sit directly on the rail.
 */
type Tool = { key: string; label: string; glyph: string; kbd?: string; hint?: string; swatch?: string; run: () => void };
const Glyph = ({ d }: { d: string }) => <Icon name={d} />;
const SHAPES: Tool[] = [
  { key: 'rect', label: 'Rectangle', glyph: 'rect', kbd: 'R', run: () => addLayer('shape', {}, 'rect') },
  { key: 'ellipse', label: 'Ellipse', glyph: 'ellipse', kbd: 'O', run: () => addLayer('shape', {}, 'ellipse') },
  { key: 'polygon', label: 'Polygon', glyph: 'polygon', run: () => addLayer('shape', {}, 'polygon') },
  { key: 'star', label: 'Star', glyph: 'star', run: () => addLayer('shape', {}, 'star') },
];
const GRADIENT_TOOLS: Tool[] = GRADIENTS.map((p) => ({ key: p.key, label: p.label, hint: p.hint, glyph: 'gradient', swatch: p.swatch, run: () => addEffect(p) }));
const TEXTURE_GLYPH: Record<string, string> = { tFilm: 'grain', tPaper: 'grain', tNoise: 'noise', tHalftone: 'halftone' };
const EFFECTS: Tool[] = [
  ...TEXTURES.map((p) => ({ key: p.key, label: p.label, hint: p.hint, glyph: TEXTURE_GLYPH[p.key] ?? 'grain', swatch: p.swatch, run: () => addEffect(p) })),
  { key: 'particles', label: 'Particles', hint: 'Drifting points of light', glyph: 'particles', swatch: 'radial-gradient(#fff 1px, transparent 1.6px) 0 0 / 6px 6px, radial-gradient(circle, #7c4dff, #0a0f2c)', run: () => addLayer('particles', { name: 'Particles' }) },
];
const TEXT: Tool = { key: 'text', label: 'Text', glyph: 'text', kbd: 'T', run: () => addLayer('text', { name: 'Text' }) };
const ALL = [...SHAPES, ...GRADIENT_TOOLS, ...EFFECTS];

export function CreationRail({ doc }: { doc: SceneDocument }) {
  const can = useCan();
  const { pins, lastShape, lastEffect, lastGradient, drawing } = useLayout();
  const [open, setOpen] = useState<Group | null>(null);
  const [importing, setImporting] = useState(false);
  const image = useRef<HTMLInputElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const shape = SHAPES.find((t) => t.key === lastShape) ?? SHAPES[0];
  const effect = EFFECTS.find((t) => t.key === lastEffect) ?? EFFECTS[0];
  const gradient = GRADIENT_TOOLS.find((t) => t.key === lastGradient) ?? GRADIENT_TOOLS[0];
  const use = (t: Tool) => { t.run(); if (SHAPES.includes(t)) setLayout({ lastShape: t.key }); if (EFFECTS.includes(t)) setLayout({ lastEffect: t.key }); if (GRADIENT_TOOLS.includes(t)) setLayout({ lastGradient: t.key }); setOpen(null); };
  const pin = (k: string) => setLayout({ pins: pins.includes(k) ? pins.filter((p) => p !== k) : [...pins, k] });

  // Single-key shortcuts, like most design tools (ignored while typing; only P while drawing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); if (useLayout.getState().drawing) finishDrawing(); else startDrawing(); return; }
      if (useLayout.getState().drawing) return;
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
  const group = (name: Group, current: Tool, tools: Tool[], label: string) => (
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
              <button role="menuitem" className="rail-fly-item" onClick={() => use(t)} title={t.hint}>{t.swatch ? <i className="rail-swatch" style={{ background: t.swatch }} aria-hidden /> : <Glyph d={t.glyph} />}<span>{t.label}</span>{t.kbd && <span className="kbd">{t.kbd}</span>}</button>
              <button className="rail-pin" aria-pressed={pins.includes(t.key)} aria-label={pins.includes(t.key) ? `Unpin ${t.label}` : `Pin ${t.label} to the rail`} title={pins.includes(t.key) ? 'Unpin' : 'Pin to the rail'} onClick={() => pin(t.key)}>
                <Icon name="pin" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <nav className="ed-rail" aria-label="Create" ref={rail}>
      <Tip label={drawing ? 'Stop drawing' : 'Draw'} kbd="P" side="right"><button className="rail-tool" aria-label="Draw" aria-pressed={drawing} onClick={() => (drawing ? finishDrawing() : startDrawing())}><Icon name="draw" /></button></Tip>
      <span className="rail-sep" />
      {group('shapes', shape, SHAPES, 'Shapes')}
      <Tip label="Text" kbd="T" side="right"><button className="rail-tool" aria-label="Add text" onClick={() => use(TEXT)}><Glyph d={TEXT.glyph} /></button></Tip>
      {can('asset.upload') && <Tip label="Image" kbd="I" side="right"><button className="rail-tool" aria-label="Add an image" onClick={() => image.current?.click()}><Icon name="image" /></button></Tip>}
      {group('gradients', gradient, GRADIENT_TOOLS, 'Gradients')}
      {group('effects', effect, EFFECTS, 'Texture & effects')}
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
