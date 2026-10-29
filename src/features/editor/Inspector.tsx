import { useEffect, useState } from 'react';
import type { Layer, SceneDocument } from '../../../shared/scene/schema';
import { GRADIENT_MODES } from '../../../shared/scene/schema';
import { getIn, setIn } from '../../../shared/util/paths';
import { ColorField } from '../../ui/color';
import { Segmented, Slider } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { SCENE_FONTS, ensureFont } from '../../engine/fonts';
import { importDesignFile } from '../../lib/designImport';
import { activeAnimation, commit, deleteKeyframe, layersAt, setProp, trackFor, useEditor } from './store';

type Spec =
  | { path: string; label: string; kind: 'number'; unit?: string; scale?: number; offset?: number; min?: number; max?: number; step?: number; anim?: boolean }
  | { path: string; label: string; kind: 'slider'; min: number; max: number; step?: number; unit?: string; scale?: number; anim?: boolean }
  | { path: string; label: string; kind: 'color'; anim?: boolean }
  | { path: string; label: string; kind: 'select'; options: { value: string | number; label: string }[]; anim?: boolean };

/** Properties shown for a layer, in friendly units (pixels, degrees, percent). */
function specsFor(l: Layer, doc: SceneDocument): { title: string; items: Spec[] }[] {
  const W = doc.canvas.width, H = doc.canvas.height, m = Math.min(W, H);
  const base: { title: string; items: Spec[] } = { title: 'Position', items: [
    { path: 'transform.x', label: 'X', kind: 'number', unit: 'px', scale: W, anim: true },
    { path: 'transform.y', label: 'Y', kind: 'number', unit: 'px', scale: H, anim: true },
    { path: 'transform.rotation', label: 'Rotation', kind: 'number', unit: '°', anim: true },
    { path: 'transform.scale', label: 'Scale', kind: 'number', unit: '%', scale: 100, anim: true, min: 1 },
    { path: 'opacity', label: 'Opacity', kind: 'slider', min: 0, max: 1, step: 0.01, unit: '%', scale: 100, anim: true },
  ] };
  if (l.type === 'shape') {
    const kind = l.props.kind;
    return [
      { title: 'Shape', items: [
        { path: 'props.kind', label: 'Type', kind: 'select', options: [{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Circle / oval' }, { value: 'polygon', label: 'Polygon' }, { value: 'star', label: 'Star' }] },
        { path: 'props.width', label: 'Width', kind: 'number', unit: 'px', anim: true, min: 1 },
        { path: 'props.height', label: 'Height', kind: 'number', unit: 'px', anim: true, min: 1 },
        ...(kind === 'rect' ? [{ path: 'props.radius', label: 'Corners', kind: 'number', unit: 'px', anim: true, min: 0 } as Spec] : []),
        ...(kind === 'polygon' || kind === 'star' ? [{ path: 'props.sides', label: kind === 'star' ? 'Points' : 'Sides', kind: 'slider', min: 3, max: 12, step: 1 } as Spec] : []),
        ...(kind === 'star' ? [{ path: 'props.innerRadius', label: 'Pointiness', kind: 'slider', min: 0.05, max: 0.95, step: 0.01, anim: true } as Spec] : []),
      ] },
      { title: 'Fill', items: [
        { path: 'props.fill.type', label: 'Fill', kind: 'select', options: [{ value: 'solid', label: 'Solid' }, { value: 'linear', label: 'Gradient' }, { value: 'radial', label: 'Radial' }, { value: 'none', label: 'None' }] },
        ...(l.props.fill.type !== 'none' ? [{ path: 'props.fill.color', label: 'Colour', kind: 'color', anim: true } as Spec] : []),
        ...(l.props.fill.type === 'linear' || l.props.fill.type === 'radial' ? [{ path: 'props.fill.color2', label: 'Colour 2', kind: 'color', anim: true } as Spec] : []),
        ...(l.props.fill.type === 'linear' ? [{ path: 'props.fill.angle', label: 'Angle', kind: 'number', unit: '°', anim: true } as Spec] : []),
        { path: 'props.stroke.width', label: 'Outline', kind: 'number', unit: 'px', anim: true, min: 0 },
        ...(l.props.stroke.width > 0 ? [{ path: 'props.stroke.color', label: 'Outline colour', kind: 'color', anim: true } as Spec] : []),
      ] },
      base,
    ];
  }
  if (l.type === 'text') return [
    { title: 'Text', items: [
      { path: 'props.fontFamily', label: 'Font', kind: 'select', options: SCENE_FONTS.map((f) => ({ value: f.family, label: f.family })) },
      { path: 'props.size', label: 'Size', kind: 'number', unit: 'px', scale: m, anim: true, min: 4 },
      { path: 'props.weight', label: 'Weight', kind: 'select', options: [300, 400, 500, 600, 700, 800].map((w) => ({ value: w, label: String(w) })) },
      { path: 'props.color', label: 'Colour', kind: 'color', anim: true },
      { path: 'props.align', label: 'Align', kind: 'select', options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }] },
      { path: 'props.tracking', label: 'Spacing', kind: 'slider', min: -0.1, max: 0.5, step: 0.01, anim: true },
    ] },
    base,
  ];
  if (l.type === 'image') return [
    { title: 'Image', items: [
      { path: 'props.width', label: 'Width', kind: 'number', unit: 'px', scale: m, anim: true, min: 1 },
      { path: 'props.height', label: 'Height', kind: 'number', unit: 'px', scale: m, anim: true, min: 1 },
      { path: 'props.fit', label: 'Fit', kind: 'select', options: [{ value: 'contain', label: 'Fit inside' }, { value: 'cover', label: 'Fill & crop' }, { value: 'fill', label: 'Stretch' }] },
      { path: 'props.mask', label: 'Shape', kind: 'select', options: [{ value: 'none', label: 'As is' }, { value: 'rounded', label: 'Rounded' }, { value: 'circle', label: 'Circle' }, { value: 'fade', label: 'Soft edges' }] },
      ...(l.props.mask === 'rounded' ? [{ path: 'props.radius', label: 'Rounding', kind: 'slider', min: 0, max: 0.5, step: 0.01, anim: true } as Spec] : []),
    ] },
    base,
  ];
  if (l.type === 'gradient') return [{ title: 'Gradient', items: [
    { path: 'props.mode', label: 'Style', kind: 'select', options: GRADIENT_MODES.map((g) => ({ value: g, label: g[0].toUpperCase() + g.slice(1) })) },
    ...l.props.stops.map((_, i) => ({ path: `props.stops.${i}.color`, label: `Colour ${i + 1}`, kind: 'color', anim: true } as Spec)),
    { path: 'props.speed', label: 'Speed', kind: 'slider', min: 0, max: 4, step: 1 },
    { path: 'props.noiseAmp', label: 'Movement', kind: 'slider', min: 0, max: 2, step: 0.01, anim: true },
    { path: 'props.distortion', label: 'Swirl', kind: 'slider', min: 0, max: 2, step: 0.01, anim: true },
    { path: 'props.grain', label: 'Grain', kind: 'slider', min: 0, max: 1, step: 0.01, anim: true },
  ] }, { title: 'Layer', items: [base.items[4]] }];
  if (l.type === 'particles') return [{ title: 'Particles', items: [
    { path: 'props.count', label: 'Amount', kind: 'slider', min: 100, max: 30000, step: 100 },
    { path: 'props.size', label: 'Size', kind: 'slider', min: 0.5, max: 16, step: 0.1, anim: true },
    { path: 'props.colorA', label: 'Colour', kind: 'color', anim: true },
    { path: 'props.colorB', label: 'Colour 2', kind: 'color', anim: true },
    { path: 'props.velocity', label: 'Speed', kind: 'slider', min: 0, max: 1, step: 0.01, anim: true },
    { path: 'props.noise', label: 'Wander', kind: 'slider', min: 0, max: 2, step: 0.01, anim: true },
  ] }, { title: 'Layer', items: [base.items[4]] }];
  return [base];
}

export function Inspector({ doc, layer }: { doc: SceneDocument; layer: Layer }) {
  const mode = useEditor((s) => s.mode);
  const playhead = useEditor((s) => s.playhead);
  useEditor((s) => s.activeAnim);
  const anim = mode === 'animate' ? activeAnimation() : null;
  const shown = (anim ? layersAt(doc, anim, playhead) : doc.layers).find((l) => l.id === layer.id) ?? layer;
  useEffect(() => { if (layer.type === 'text') ensureFont(layer.props.fontFamily); }, [layer]);
  return (
    <div>
      <div className="sec">
        <input className="input" value={layer.name} onChange={(e) => setProp(layer.id, 'name', e.target.value, `name:${layer.id}`)} aria-label="Layer name" />
        {layer.type === 'text' && <TextBox layer={layer} />}
        {layer.type === 'image' && <ReplaceImage layer={layer} />}
      </div>
      {specsFor(shown, doc).map((g) => (
        <div key={g.title} className="sec">
          <div className="sec-h">{g.title}</div>
          {g.items.map((s) => <PropRow key={s.path} spec={s} layer={shown} anim={anim ? { id: anim.id } : null} playhead={playhead} />)}
        </div>
      ))}
    </div>
  );
}

function TextBox({ layer }: { layer: Extract<Layer, { type: 'text' }> }) {
  return <textarea className="input" rows={2} style={{ height: 'auto', padding: 8, resize: 'vertical' }} value={layer.props.text} onChange={(e) => commit((d) => ({ ...d, layers: d.layers.map((l) => (l.id === layer.id ? setIn(l, 'props.text', e.target.value) : l)) }), `text:${layer.id}`)} aria-label="Text" />;
}

function ReplaceImage({ layer }: { layer: Layer }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="btn sm" style={{ alignSelf: 'flex-start' }}>
      <Icon name="image" size={13} />{busy ? 'Uploading…' : 'Replace image'}
      <input type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setBusy(true);
        try { const d = await importDesignFile(f); commit((doc) => ({ ...doc, layers: doc.layers.map((l) => (l.id === layer.id ? setIn(l, 'props.assetId', d.layers[0].assetId) : l)) })); } finally { setBusy(false); }
      }} />
    </label>
  );
}

function PropRow({ spec, layer, anim, playhead }: { spec: Spec; layer: Layer; anim: { id: string } | null; playhead: number }) {
  const raw = getIn(layer, spec.path);
  const key = `${layer.id}:${spec.path}`;
  const set = (v: unknown) => setProp(layer.id, spec.path, v, key);
  const a = anim ? activeAnimation() : null;
  const track = a ? trackFor(a, layer.id, spec.path) : undefined;
  const here = track?.keyframes.find((k) => Math.abs(k.t - playhead) < 0.005);
  const keyBtn = (
    <button className={`kbtn ${here ? 'on' : track ? 'has' : ''}`} disabled={!anim || !spec.anim} title={here ? 'Remove this keyframe' : 'Add a keyframe here'}
      onClick={() => (here && track ? deleteKeyframe(track.id, here.id) : setProp(layer.id, spec.path, raw))}>
      <svg viewBox="0 0 12 12"><path d="M6 1l5 5-5 5-5-5z" fill={here ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" /></svg>
    </button>
  );
  if (spec.kind === 'color') return <div className="prop"><span className="lbl">{spec.label}</span><ColorField label={spec.label} value={String(raw)} onChange={set} />{keyBtn}</div>;
  if (spec.kind === 'select') return (
    <div className="prop"><span className="lbl">{spec.label}</span>
      {spec.options.length <= 3
        ? <Segmented value={String(raw)} onChange={(v) => set(typeof spec.options[0].value === 'number' ? Number(v) : v)} options={spec.options.map((o) => ({ value: String(o.value), label: o.label }))} label={spec.label} />
        : <select className="input" style={{ height: 28, fontSize: 12 }} value={String(raw)} onChange={(e) => set(typeof spec.options[0].value === 'number' ? Number(e.target.value) : e.target.value)} aria-label={spec.label}>{spec.options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}</select>}
      {keyBtn}
    </div>
  );
  const scale = spec.scale ?? 1;
  if (spec.kind === 'slider') return (
    <div className="prop"><span className="lbl">{spec.label}</span>
      <div className="row" style={{ gap: 6 }}><Slider value={Number(raw)} min={spec.min} max={spec.max} step={spec.step ?? 0.01} onChange={(v) => set(v)} label={spec.label} /><span className="faint mono" style={{ fontSize: 10.5, width: 34, textAlign: 'right' }}>{+(Number(raw) * scale).toFixed(scale === 1 && (spec.step ?? 1) < 1 ? 2 : 0)}{spec.unit ?? ''}</span></div>
      {keyBtn}
    </div>
  );
  return (
    <div className="prop"><span className="lbl">{spec.label}</span>
      <NumberBox value={Number(raw) * scale} unit={spec.unit} onChange={(v) => set(Math.max(spec.min ?? -Infinity, Math.min(spec.max ?? Infinity, v / scale)))} label={spec.label} />
      {keyBtn}
    </div>
  );
}

/** Number box that accepts typing and dragging the label-free field with arrow keys. */
function NumberBox({ value, unit, onChange, label }: { value: number; unit?: string; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState(String(+value.toFixed(1)));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(String(+value.toFixed(1))); }, [value, focus]);
  return (
    <div className="mini">
      <input aria-label={label} inputMode="decimal" value={text} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onChange={(e) => { setText(e.target.value); const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(n); }}
        onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const n = value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1); onChange(n); setText(String(+n.toFixed(1))); } }} />
      {unit && <span className="u">{unit}</span>}
    </div>
  );
}

/** Artboard settings when nothing is selected. */
export function CanvasSettings({ doc }: { doc: SceneDocument }) {
  const set = (patch: Partial<SceneDocument['canvas']>, key: string) => commit((d) => ({ ...d, canvas: { ...d.canvas, ...patch } }), key);
  const sizes = [[1080, 1080, 'Square'], [1080, 1350, 'Portrait'], [1080, 1920, 'Story'], [1920, 1080, 'Wide'], [800, 600, 'Card'], [512, 512, 'Icon']] as const;
  return (
    <div>
      <div className="sec">
        <div className="sec-h">Canvas</div>
        <input className="input" value={doc.meta.name} onChange={(e) => commit((d) => ({ ...d, meta: { ...d.meta, name: e.target.value || 'Untitled' } }), 'meta-name')} aria-label="File name" />
        <div className="prop"><span className="lbl">Background</span><ColorField label="Background" value={doc.canvas.background} onChange={(v) => set({ background: v }, 'bg')} /><span /></div>
        <div className="prop"><span className="lbl">Size</span><span className="faint mono" style={{ fontSize: 11.5 }}>{doc.canvas.width} × {doc.canvas.height}</span><span /></div>
        <div className="row wrap" style={{ gap: 5 }}>{sizes.map(([w, h, n]) => <button key={n} className="chip" aria-pressed={doc.canvas.width === w && doc.canvas.height === h} onClick={() => set({ width: w, height: h }, 'size')}>{n}</button>)}</div>
      </div>
      <div className="sec"><div className="empty-hint">Select a layer to edit it, or add one from the left. Tip: drag on the canvas to move things; corners resize; the dot on top rotates.</div></div>
    </div>
  );
}
