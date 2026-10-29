import { useEffect, useState, type ReactNode } from 'react';
import type { Layer, SceneDocument } from '../../../shared/scene/schema';
import { GRADIENT_MODES } from '../../../shared/scene/schema';
import { getIn, setIn } from '../../../shared/util/paths';
import { ColorField } from '../../ui/color';
import { Segmented, Slider } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { SCENE_FONTS, ensureFont } from '../../engine/fonts';
import { importDesignFile } from '../../lib/designImport';
import { startDrawing } from './Draw';
import { activeAnimation, commit, deleteKeyframe, layersAt, select, setProp, trackFor, useEditor } from './store';

type Spec = ({ path: string; label: string; anim?: boolean; adv?: boolean }) & (
  | { kind: 'number'; unit?: string; scale?: number; offset?: number; min?: number; max?: number; step?: number }
  | { kind: 'slider'; min: number; max: number; step?: number; unit?: string; scale?: number }
  | { kind: 'color' }
  | { kind: 'select'; options: { value: string | number; label: string }[] });

/**
 * Properties shown for a layer, in friendly units (pixels, degrees, percent), grouped the way
 * designers think: how it looks, its geometry, then where it sits. Fields marked "adv" wait behind
 * the section's "More" toggle.
 */
function specsFor(l: Layer, doc: SceneDocument): { title: string; items: Spec[] }[] {
  const W = doc.canvas.width, H = doc.canvas.height, m = Math.min(W, H);
  const opacity: Spec = { path: 'opacity', label: 'Opacity', kind: 'slider', min: 0, max: 1, step: 0.01, unit: '%', scale: 100, anim: true };
  const transform: { title: string; items: Spec[] } = { title: 'Transform', items: [
    { path: 'transform.x', label: 'X', kind: 'number', unit: 'px', scale: W, anim: true },
    { path: 'transform.y', label: 'Y', kind: 'number', unit: 'px', scale: H, anim: true },
    { path: 'transform.rotation', label: 'Rotation', kind: 'number', unit: '°', anim: true },
    { path: 'transform.scale', label: 'Scale', kind: 'number', unit: '%', scale: 100, anim: true, min: 1 },
    { path: 'transform.scaleX', label: 'Stretch ↔', kind: 'number', unit: '%', scale: 100, anim: true, min: 1, adv: true },
    { path: 'transform.scaleY', label: 'Stretch ↕', kind: 'number', unit: '%', scale: 100, anim: true, min: 1, adv: true },
  ] };
  if (l.type === 'shape') {
    const kind = l.props.kind;
    return [
      { title: 'Appearance', items: [
        { path: 'props.fill.type', label: 'Fill', kind: 'select', options: [{ value: 'solid', label: 'Solid' }, { value: 'linear', label: 'Gradient' }, { value: 'radial', label: 'Radial' }, { value: 'none', label: 'None' }] },
        ...(l.props.fill.type !== 'none' ? [{ path: 'props.fill.color', label: 'Colour', kind: 'color', anim: true } as Spec] : []),
        ...(l.props.fill.type === 'linear' || l.props.fill.type === 'radial' ? [{ path: 'props.fill.color2', label: 'Colour 2', kind: 'color', anim: true } as Spec] : []),
        ...(l.props.fill.type === 'linear' ? [{ path: 'props.fill.angle', label: 'Angle', kind: 'number', unit: '°', anim: true } as Spec] : []),
        { path: 'props.stroke.width', label: 'Outline', kind: 'number', unit: 'px', anim: true, min: 0 },
        ...(l.props.stroke.width > 0 ? [{ path: 'props.stroke.color', label: 'Outline colour', kind: 'color', anim: true } as Spec] : []),
        opacity,
      ] },
      { title: 'Geometry', items: [
        { path: 'props.kind', label: 'Type', kind: 'select', options: [{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Circle / oval' }, { value: 'polygon', label: 'Polygon' }, { value: 'star', label: 'Star' }] },
        { path: 'props.width', label: 'Width', kind: 'number', unit: 'px', anim: true, min: 1 },
        { path: 'props.height', label: 'Height', kind: 'number', unit: 'px', anim: true, min: 1 },
        ...(kind === 'rect' ? [{ path: 'props.radius', label: 'Corners', kind: 'number', unit: 'px', anim: true, min: 0 } as Spec] : []),
        ...(kind === 'polygon' || kind === 'star' ? [{ path: 'props.sides', label: kind === 'star' ? 'Points' : 'Sides', kind: 'slider', min: 3, max: 12, step: 1 } as Spec] : []),
        ...(kind === 'star' ? [{ path: 'props.innerRadius', label: 'Pointiness', kind: 'slider', min: 0.05, max: 0.95, step: 0.01, anim: true } as Spec] : []),
      ] },
      transform,
    ];
  }
  if (l.type === 'text') return [
    { title: 'Typography', items: [
      { path: 'props.fontFamily', label: 'Font', kind: 'select', options: SCENE_FONTS.map((f) => ({ value: f.family, label: `${f.family} · ${f.source}` })) },
      { path: 'props.weight', label: 'Weight', kind: 'select', options: [300, 400, 500, 600, 700, 800].map((w) => ({ value: w, label: String(w) })) },
      { path: 'props.size', label: 'Size', kind: 'number', unit: 'px', scale: m, anim: true, min: 4 },
      { path: 'props.align', label: 'Align', kind: 'select', options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }] },
      { path: 'props.tracking', label: 'Spacing', kind: 'slider', min: -0.1, max: 0.5, step: 0.01, anim: true },
      { path: 'props.color', label: 'Colour', kind: 'color', anim: true },
      opacity,
    ] },
    transform,
  ];
  if (l.type === 'drawing') return [
    { title: 'Drawing', items: [
      { path: 'props.reveal', label: 'Drawn', kind: 'slider', min: 0, max: 1, step: 0.01, unit: '%', scale: 100, anim: true },
      { path: 'props.thickness', label: 'Thickness', kind: 'slider', min: 0.1, max: 4, step: 0.05, anim: true },
      opacity,
    ] },
    transform,
  ];
  if (l.type === 'image') return [
    { title: 'Image', items: [
      { path: 'props.width', label: 'Width', kind: 'number', unit: 'px', scale: m, anim: true, min: 1 },
      { path: 'props.height', label: 'Height', kind: 'number', unit: 'px', scale: m, anim: true, min: 1 },
      { path: 'props.fit', label: 'Fit', kind: 'select', options: [{ value: 'contain', label: 'Fit inside' }, { value: 'cover', label: 'Fill & crop' }, { value: 'fill', label: 'Stretch' }] },
      { path: 'props.mask', label: 'Shape', kind: 'select', options: [{ value: 'none', label: 'As is' }, { value: 'rounded', label: 'Rounded' }, { value: 'circle', label: 'Circle' }, { value: 'fade', label: 'Soft edges' }] },
      ...(l.props.mask === 'rounded' ? [{ path: 'props.radius', label: 'Rounding', kind: 'slider', min: 0, max: 0.5, step: 0.01, anim: true } as Spec] : []),
      opacity,
    ] },
    transform,
  ];
  if (l.type === 'gradient') {
    const mode = l.props.mode;
    const style: Spec = { path: 'props.mode', label: 'Style', kind: 'select', options: GRADIENT_MODES.map((g) => ({ value: g, label: MODE_LABEL[g] ?? g })) };
    const colours = l.props.stops.map((_, i) => ({ path: `props.stops.${i}.color`, label: mode === 'grain' ? (i ? 'Dark specks' : 'Light specks') : mode === 'halftone' && l.props.stops.length === 2 ? (i ? 'Ink' : 'Paper') : `Colour ${i + 1}`, kind: 'color', anim: true } as Spec));
    if (mode === 'grain') return [{ title: 'Grain', items: [
      style, ...colours,
      { path: 'props.grain', label: 'Amount', kind: 'slider', min: 0, max: 1, step: 0.01, unit: '%', scale: 100, anim: true },
      { path: 'props.scale', label: 'Size', kind: 'slider', min: 0.5, max: 4, step: 0.25 },
      { path: 'props.speed', label: 'Flicker', kind: 'slider', min: 0, max: 4, step: 1 },
      opacity,
    ] }];
    if (mode === 'halftone') return [{ title: 'Halftone', items: [
      style, ...colours,
      { path: 'props.scale', label: 'Dot size', kind: 'slider', min: 0.4, max: 4, step: 0.05, anim: true },
      { path: 'props.angle', label: 'Angle', kind: 'number', unit: '°', anim: true },
      { path: 'props.noiseAmp', label: 'Unevenness', kind: 'slider', min: 0, max: 2, step: 0.01, anim: true, adv: true },
      opacity,
    ] }];
    const angled = mode === 'linear' || mode === 'conic' || mode === 'diamond';
    return [{ title: 'Gradient', items: [
      style, ...colours,
      ...(angled ? [{ path: 'props.angle', label: 'Angle', kind: 'number', unit: '°', anim: true } as Spec] : []),
      { path: 'props.scale', label: 'Scale', kind: 'slider', min: 0.2, max: 4, step: 0.05, anim: true },
      { path: 'props.speed', label: 'Speed', kind: 'slider', min: 0, max: 4, step: 1 },
      { path: 'props.noiseAmp', label: 'Movement', kind: 'slider', min: 0, max: 2, step: 0.01, anim: true, adv: true },
      { path: 'props.distortion', label: 'Swirl', kind: 'slider', min: 0, max: 2, step: 0.01, anim: true, adv: true },
      { path: 'props.grain', label: 'Grain', kind: 'slider', min: 0, max: 1, step: 0.01, anim: true, adv: true },
      opacity,
    ] }];
  }
  if (l.type === 'particles') return [{ title: 'Particles', items: [
    { path: 'props.count', label: 'Amount', kind: 'slider', min: 100, max: 30000, step: 100 },
    { path: 'props.size', label: 'Size', kind: 'slider', min: 0.5, max: 16, step: 0.1, anim: true },
    { path: 'props.colorA', label: 'Colour', kind: 'color', anim: true },
    { path: 'props.colorB', label: 'Colour 2', kind: 'color', anim: true },
    { path: 'props.velocity', label: 'Speed', kind: 'slider', min: 0, max: 1, step: 0.01, anim: true, adv: true },
    { path: 'props.noise', label: 'Wander', kind: 'slider', min: 0, max: 2, step: 0.01, anim: true, adv: true },
    opacity,
  ] }];
  return [{ title: 'Appearance', items: [opacity] }, transform];
}

const MODE_LABEL: Record<string, string> = { linear: 'Linear', radial: 'Radial', conic: 'Conic', diamond: 'Diamond', mesh: 'Mesh', aurora: 'Aurora', organic: 'Blobs', noise: 'Noise field', grain: 'Film grain', halftone: 'Halftone' };

/** One collapsible inspector section. Open/closed is remembered per section title. */
const SECTIONS_KEY = 'mos.inspector.closed';
const readClosed = (): string[] => { try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '[]'); } catch { return []; } };
export function Section({ title, children, more, actions }: { title: string; children: ReactNode; more?: ReactNode; actions?: ReactNode }) {
  const [closed, setClosed] = useState(() => readClosed().includes(title));
  const [showMore, setShowMore] = useState(false);
  const flip = () => { const next = !closed; setClosed(next); try { const c = readClosed().filter((t) => t !== title); localStorage.setItem(SECTIONS_KEY, JSON.stringify(next ? [...c, title] : c)); } catch { /* ignore */ } };
  return (
    <section className={`isec${closed ? ' closed' : ''}`}>
      <div className="isec-h">
        <button className="isec-t" aria-expanded={!closed} onClick={flip}><Icon name="chevronDown" size={12} />{title}</button>
        {actions}
      </div>
      {!closed && <div className="isec-b">
        {children}
        {more && <>
          {showMore && more}
          <button className="isec-more" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>{showMore ? 'Fewer options' : 'More options'}</button>
        </>}
      </div>}
    </section>
  );
}

/** Where the selected layer lives: its parent groups, each one click away. */
function Breadcrumb({ doc, layer }: { doc: SceneDocument; layer: Layer }) {
  const path: Layer[] = [];
  let p = layer.parentId;
  while (p && path.length < 12) { const g = doc.layers.find((l) => l.id === p); if (!g) break; path.unshift(g); p = g.parentId; }
  return (
    <nav className="crumbs" aria-label="Layer path">
      <button onClick={() => select(null)}>Canvas</button>
      {path.map((g) => <span key={g.id}><Icon name="chevronRight" size={10} /><button onClick={() => select(g.id)}>{g.name}</button></span>)}
    </nav>
  );
}

export function Inspector({ doc, layer }: { doc: SceneDocument; layer: Layer }) {
  const mode = useEditor((s) => s.mode);
  const playhead = useEditor((s) => s.playhead);
  useEditor((s) => s.activeAnim);
  const anim = mode === 'animate' ? activeAnimation() : null;
  const shown = (anim ? layersAt(doc, anim, playhead) : doc.layers).find((l) => l.id === layer.id) ?? layer;
  useEffect(() => { if (layer.type === 'text') ensureFont(layer.props.fontFamily); }, [layer]);
  const children = layer.type === 'group' ? [...doc.layers].reverse().filter((l) => l.parentId === layer.id) : [];
  return (
    <div className="insp">
      <div className="insp-id">
        <Breadcrumb doc={doc} layer={layer} />
        <input className="insp-name" value={layer.name} onChange={(e) => setProp(layer.id, 'name', e.target.value, `name:${layer.id}`)} aria-label="Layer name" />
        {layer.type === 'text' && <TextBox layer={layer} />}
        {layer.type === 'image' && <ReplaceImage layer={layer} />}
        {layer.type === 'drawing' && <DrawingTools layer={layer} />}
      </div>
      {specsFor(shown, doc).map((g) => {
        const row = (sp: Spec) => <PropRow key={sp.path} spec={sp} layer={shown} anim={anim ? { id: anim.id } : null} playhead={playhead} />;
        const adv = g.items.filter((i) => i.adv);
        return <Section key={g.title} title={g.title} more={adv.length ? adv.map(row) : undefined}>{g.items.filter((i) => !i.adv).map(row)}</Section>;
      })}
      {layer.type === 'group' && (
        <Section title={`Contents · ${children.length}`}>
          {children.map((c) => <button key={c.id} className="child-row" onClick={() => select(c.id)}><Icon name={c.type === 'group' ? 'folder' : c.type === 'text' ? 'type' : 'shapes'} size={12} />{c.name}</button>)}
        </Section>
      )}
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

/** Nothing selected: the file's component controls, then the canvas itself. */
export function CanvasSettings({ doc }: { doc: SceneDocument }) {
  const set = (patch: Partial<SceneDocument['canvas']>, key: string) => commit((d) => ({ ...d, canvas: { ...d.canvas, ...patch } }), key);
  const sizes = [[1080, 1080, 'Square'], [1080, 1350, 'Portrait'], [1080, 1920, 'Story'], [1920, 1080, 'Wide'], [800, 600, 'Card'], [512, 512, 'Icon']] as const;
  return (
    <div className="insp">
      <div className="insp-empty">No layer selected. Pick something on the canvas or in Layers to edit it.</div>
      <Customise doc={doc} />
      <Section title="Canvas">
        <div className="prop"><span className="lbl">Name</span><input className="input" style={{ height: 30 }} value={doc.meta.name} onChange={(e) => commit((d) => ({ ...d, meta: { ...d.meta, name: e.target.value || 'Untitled' } }), 'meta-name')} aria-label="Document name" /><span /></div>
        <div className="prop"><span className="lbl">Background</span><ColorField label="Background" value={doc.canvas.background} onChange={(v) => set({ background: v }, 'bg')} /><span /></div>
        <div className="prop"><span className="lbl">Size</span><span className="faint mono">{doc.canvas.width} × {doc.canvas.height}</span><span /></div>
        <div className="size-chips">{sizes.map(([w, h, n]) => <button key={n} className="chip" aria-pressed={doc.canvas.width === w && doc.canvas.height === h} onClick={() => set({ width: w, height: h }, 'size')}>{n}</button>)}</div>
      </Section>
    </div>
  );
}

/**
 * Component controls: friendly knobs (a colour, a label, an amount) that each change one or more
 * properties at once, so a beginner can restyle a component without finding every layer. A dot
 * marks values that differ from the component's defaults; each can be reset on its own.
 */
export function Customise({ doc }: { doc: SceneDocument }) {
  const params = doc.exposed.filter((p) => (p.type === 'color' || p.type === 'text' || p.type === 'number') && p.targets.length);
  if (!params.length) return null;
  const current = (p: (typeof params)[number]) => {
    const t = p.targets[0];
    const l = doc.layers.find((x) => x.id === t.layerId);
    return l ? getIn(l, t.path) : p.default;
  };
  const set = (p: (typeof params)[number], v: unknown) =>
    commit((d) => ({ ...d, layers: d.layers.map((l) => p.targets.filter((t) => t.layerId === l.id).reduce((acc, t) => setIn(acc, t.path, v), l)) }), `param:${p.key}`);
  const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
  const edited = params.filter((p) => p.default !== undefined && !same(current(p), p.default));
  const groups = [...new Set(params.map((p) => p.group || 'Style'))];
  return (
    <Section title="Component controls" actions={edited.length > 0 && <button className="isec-act" onClick={() => commit((d) => edited.reduce((acc, p) => ({ ...acc, layers: acc.layers.map((l) => p.targets.filter((t) => t.layerId === l.id).reduce((x, t) => setIn(x, t.path, p.default), l)) }), d))}>Reset all</button>}>
      {groups.map((g) => (
        <div key={g} className="cc-group">
          {groups.length > 1 && <div className="cc-h">{g === 'Style' ? 'Appearance' : g}</div>}
          {params.filter((p) => (p.group || 'Style') === g).map((p) => {
            const v = current(p);
            const changed = p.default !== undefined && !same(v, p.default);
            return (
              <div key={p.key} className="prop" title={p.description}>
                <span className="lbl">{changed && <i className="cc-dot" aria-label="edited" />}{p.label}</span>
                {p.type === 'color' && <ColorField label={p.label} value={String(v)} onChange={(c) => set(p, c)} />}
                {p.type === 'text' && <input className="input" style={{ height: 30 }} value={String(v ?? '')} maxLength={p.maxLength ?? 60} onChange={(e) => set(p, e.target.value)} aria-label={p.label} />}
                {p.type === 'number' && <Slider value={Number(v)} min={p.min ?? 0} max={p.max ?? 1} step={p.step ?? 0.01} onChange={(n) => set(p, n)} label={p.label} />}
                {changed ? <button className="kbtn" aria-label={`Reset ${p.label}`} title="Reset to default" onClick={() => set(p, p.default)}><Icon name="restart" size={11} /></button> : <span />}
              </div>
            );
          })}
        </div>
      ))}
    </Section>
  );
}

/** A drawing: keep drawing into it, or recolour every stroke at once. */
function DrawingTools({ layer }: { layer: Extract<Layer, { type: 'drawing' }> }) {
  const colours = [...new Set(layer.props.strokes.map((s) => s.color))];
  return (
    <div className="draw-tools">
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => startDrawing(layer.id)} disabled={!!layer.parentId} title={layer.parentId ? 'Move it out of its group to keep drawing into it' : undefined}><Icon name="draw" size={13} />Edit drawing</button>
        <span className="faint" style={{ fontSize: 12 }}>{layer.props.strokes.length} stroke{layer.props.strokes.length === 1 ? '' : 's'}</span>
      </div>
      {colours.length > 0 && (
        <div className="prop"><span className="lbl">{colours.length > 1 ? 'All strokes' : 'Colour'}</span>
          <ColorField label="Stroke colour" value={colours[0]} onChange={(c) => commit((d) => ({ ...d, layers: d.layers.map((x) => (x.id === layer.id && x.type === 'drawing' ? { ...x, props: { ...x.props, strokes: x.props.strokes.map((s) => ({ ...s, color: c })) } } : x)) }), `draw-colour:${layer.id}`)} />
          <span />
        </div>
      )}
    </div>
  );
}
