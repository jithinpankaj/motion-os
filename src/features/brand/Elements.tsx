import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { elementFromFile, svgToAsset } from '../../lib/designImport';
import { useCan } from '../../lib/session';
import { EmptyState, Field, Modal, Segmented, Slider, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import type { BrandKit } from '../../../shared/brandImport';

export type ElementAsset = { id: string; name: string; url: string; width: number; height: number };

/** Workspace elements: anything uploaded or created as a reusable brand element. */
export function useElements() {
  const [list, setList] = useState<ElementAsset[] | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    api('/assets', { query: { tag: 'element' } }).then((r) => setList(r.assets)).catch(() => setList([]));
  }, [n]);
  return { list, reload: useCallback(() => setN((x) => x + 1), []) };
}

// ---------- shape generator ----------

const SHAPES = ['circle', 'rounded', 'pill', 'blob', 'star', 'sparkle', 'ring', 'arrow', 'wave', 'triangle'] as const;
type Shape = (typeof SHAPES)[number];

function blobPath(seed: number, points = 7) {
  const rand = (i: number) => { const x = Math.sin(seed * 999 + i * 77.7) * 43758.5453; return x - Math.floor(x); };
  const pts = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2, r = 170 + rand(i) * 70;
    return [256 + Math.cos(a) * r, 256 + Math.sin(a) * r];
  });
  let d = '';
  for (let i = 0; i < points; i++) {
    const p0 = pts[(i - 1 + points) % points], p1 = pts[i], p2 = pts[(i + 1) % points], p3 = pts[(i + 2) % points];
    if (i === 0) d += `M${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

function starPath(points: number, inner: number) {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 230 * inner : 230;
    d += `${i ? 'L' : 'M'}${(256 + Math.cos(a) * r).toFixed(1)} ${(256 + Math.sin(a) * r).toFixed(1)}`;
  }
  return d + 'Z';
}

export function shapeSvg(shape: Shape, o: { fill: string; fill2: string; gradient: boolean; roundness: number; seed: number; stroke: number }) {
  const paint = o.gradient ? 'url(#g)' : o.fill;
  const defs = o.gradient ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${o.fill}"/><stop offset="1" stop-color="${o.fill2}"/></linearGradient></defs>` : '';
  const r = Math.round(o.roundness * 120);
  const body = {
    circle: `<circle cx="256" cy="256" r="230" fill="${paint}"/>`,
    rounded: `<rect x="36" y="36" width="440" height="440" rx="${r}" fill="${paint}"/>`,
    pill: `<rect x="16" y="166" width="480" height="180" rx="90" fill="${paint}"/>`,
    blob: `<path d="${blobPath(o.seed)}" fill="${paint}"/>`,
    star: `<path d="${starPath(5, 0.45 + o.roundness * 0.2)}" fill="${paint}" stroke="${paint}" stroke-width="${r / 3}" stroke-linejoin="round"/>`,
    sparkle: `<path d="M256 16C272 180 332 240 496 256 332 272 272 332 256 496 240 332 180 272 16 256 180 240 240 180 256 16Z" fill="${paint}"/>`,
    ring: `<circle cx="256" cy="256" r="${215 - o.stroke / 2}" fill="none" stroke="${paint}" stroke-width="${o.stroke}"/>`,
    arrow: `<path d="M40 256H440M300 116L440 256 300 396" fill="none" stroke="${paint}" stroke-width="${o.stroke}" stroke-linecap="round" stroke-linejoin="round"/>`,
    wave: `<path d="M24 256C84 156 144 156 196 256S308 356 360 256 432 156 488 256" fill="none" stroke="${paint}" stroke-width="${o.stroke}" stroke-linecap="round"/>`,
    triangle: `<path d="M256 40L476 440H36Z" fill="${paint}" stroke="${paint}" stroke-width="${r / 2}" stroke-linejoin="round"/>`,
  }[shape];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}${body}</svg>`;
}

/** Make a simple shape in brand colours and save it as an element. */
export function ElementMaker({ open, onClose, brand, onCreated }: { open: boolean; onClose: () => void; brand: BrandKit; onCreated: (e: { id: string; width: number; height: number; name: string }) => void }) {
  const palette = brand.palette.length ? brand.palette : ['#6b8cff', '#ff6ad5', '#ff5a36', '#16a3a0', '#f5f5f2'];
  const [shape, setShape] = useState<Shape>('blob');
  const [fill, setFill] = useState(brand.colors['color.primary'] ?? palette[0]);
  const [fill2, setFill2] = useState(brand.colors['color.accent'] ?? palette[1] ?? palette[0]);
  const [gradient, setGradient] = useState(false);
  const [roundness, setRoundness] = useState(0.4);
  const [stroke, setStroke] = useState(40);
  const [seed, setSeed] = useState(3);
  const [busy, setBusy] = useState(false);
  const svg = useMemo(() => shapeSvg(shape, { fill, fill2, gradient, roundness, seed, stroke }), [shape, fill, fill2, gradient, roundness, seed, stroke]);
  const save = async () => {
    setBusy(true);
    try {
      const name = `${shape[0].toUpperCase()}${shape.slice(1)} element`;
      const r = await svgToAsset(svg, name);
      toast('ok', 'Element saved', 'It’s in your Brand kit and ready to add to any motion.');
      onCreated({ ...r, name });
      onClose();
    } catch (e) { toast('danger', 'Could not save element', errorMessage(e)); } finally { setBusy(false); }
  };
  const stroked = shape === 'ring' || shape === 'arrow' || shape === 'wave';
  return (
    <Modal open={open} onClose={onClose} title="Create an element" subtitle="Simple shapes in your brand colours. They animate like any other part of a design." wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? <span className="spinner" /> : 'Save element'}</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', gap: 22 }}>
        <div className="logo-box" style={{ height: 220 }} dangerouslySetInnerHTML={{ __html: svg.replace('width="512" height="512"', 'width="170" height="170"') }} />
        <div className="col" style={{ gap: 14 }}>
          <Field label="Shape">
            <div className="row wrap" style={{ gap: 6 }}>{SHAPES.map((s) => <button key={s} className="chip" aria-pressed={shape === s} onClick={() => setShape(s)}>{s}</button>)}</div>
          </Field>
          <Field label="Colour">
            <div className="swatches">{palette.map((c) => <button key={c} className="swatch" aria-pressed={fill === c} aria-label={`Use ${c}`} style={{ background: c }} onClick={() => setFill(c)} />)}</div>
          </Field>
          <Field label="Fill">
            <Segmented value={gradient ? 'gradient' : 'solid'} onChange={(v) => setGradient(v === 'gradient')} options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]} label="Fill" />
          </Field>
          {gradient && <Field label="Second colour"><div className="swatches">{palette.map((c) => <button key={c} className="swatch" aria-pressed={fill2 === c} aria-label={`Blend to ${c}`} style={{ background: c }} onClick={() => setFill2(c)} />)}</div></Field>}
          {stroked ? <Field label="Line weight"><Slider value={stroke} min={8} max={120} step={1} onChange={setStroke} label="Line weight" /></Field>
            : shape === 'blob' ? <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setSeed((x) => x + 1)}><Icon name="refresh" />New blob shape</button>
            : (shape === 'rounded' || shape === 'star' || shape === 'triangle') && <Field label="Roundness"><Slider value={roundness} min={0} max={1} onChange={setRoundness} label="Roundness" /></Field>}
        </div>
      </div>
    </Modal>
  );
}

/** Pick an element to add (or upload / create one first). */
export function ElementPicker({ open, onClose, brand, onPick }: { open: boolean; onClose: () => void; brand: BrandKit; onPick: (e: ElementAsset) => void }) {
  const { list, reload } = useElements();
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const can = useCan();
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try { for (const f of [...files].slice(0, 12)) await elementFromFile(f); reload(); toast('ok', 'Elements added'); }
    catch (e) { toast('danger', 'Upload failed', errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <Modal open={open && !making} onClose={onClose} title="Add an element" subtitle="Logos, stickers, icons, shapes — anything you reuse across motion." wide
        footer={<div className="row grow between"><div className="row">
          {can('asset.upload') && <label className="btn"><Icon name="upload" />{busy ? 'Uploading…' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" multiple hidden onChange={(e) => upload(e.target.files)} /></label>}
          {can('asset.upload') && <button className="btn" onClick={() => setMaking(true)}><Icon name="shapes" />Create a shape</button>}
        </div><button className="btn ghost" onClick={onClose}>Close</button></div>}>
        {!list ? <div className="elements">{[0, 1, 2, 3].map((i) => <div key={i} className="skel element" />)}</div>
          : !list.length ? <EmptyState icon="shapes" title="No elements yet">Upload your logo, icons or stickers, or create a shape in your brand colours.</EmptyState>
          : <div className="elements">{list.map((e) => <button key={e.id} className="element" title={e.name} onClick={() => { onPick(e); onClose(); }}><img src={e.url} alt={e.name} /></button>)}</div>}
      </Modal>
      <ElementMaker open={making} onClose={() => setMaking(false)} brand={brand} onCreated={(e) => { reload(); setMaking(false); onPick({ ...e, url: '' }); onClose(); }} />
    </>
  );
}
