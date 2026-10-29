import { useEffect, useMemo, useReducer, useState } from 'react';
import type { Layer, SceneDocument } from '../../../shared/scene/schema';
import { EASINGS, GRADIENT_MODES, GEOMETRY_KINDS, PARTICLE_SHAPES, TEXT_PRESETS } from '../../../shared/scene/schema';
import { getIn } from '../../../shared/util/paths';
import { Icon } from '../../ui/Icon';
import { NumberField, PropertyGroup, Segmented, Slider, Switch, Tip, toast } from '../../ui/controls';
import { ColorField, GradientEditor, gradientCss } from '../../ui/color';
import { SCENE_FONTS } from '../../engine/fonts';
import { validateShadeSnippet } from '../../engine/shaders';
import { useBrandTokens, colorSwatches, gradientPresets } from '../../lib/brand';
import { api } from '../../lib/api';
import { useStudio, setProp, toggleKeyframe, exposeParam, valueAt, updateLayer, commit, endCoalesce } from './store';

const CANVAS_PRESETS = [[1080, 1350], [1080, 1920], [1080, 1080], [1920, 1080], [1200, 627], [1600, 400], [3840, 2160]];

type Ctx = { layer: Layer; doc: SceneDocument; t: number; readOnly: boolean };

/** Row chrome: label, control, keyframe toggle (◆) and "expose to teams" action. */
function Row({ c, label, path, children, animatable = true, exposable = true, meta }: { c: Ctx; label: string; path: string; children: React.ReactNode; animatable?: boolean; exposable?: boolean; meta?: { min?: number; max?: number; step?: number } }) {
  const track = c.doc.tracks.find((t) => t.layerId === c.layer.id && t.path === path && t.keyframes.length);
  const atKey = track?.keyframes.some((k) => Math.abs(k.t - c.t) < 0.5 / c.doc.canvas.fps);
  const exposed = c.doc.exposed.find((p) => p.targets.some((x) => x.layerId === c.layer.id && x.path === path));
  return (
    <div className="prow">
      <span className="label" title={label}>{label}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
      <span className="prow-actions">
        {animatable && <Tip label={track ? (atKey ? 'Remove keyframe' : 'Add keyframe at playhead') : 'Animate (add keyframe)'}><button className={`icon-btn sm ${track ? 'on' : ''}`} disabled={c.readOnly} onClick={() => toggleKeyframe(c.layer.id, path)} aria-label={`Keyframe ${label}`} style={{ color: track ? 'var(--key)' : undefined }}><svg className="i" viewBox="0 0 24 24"><path d="M12 4l8 8-8 8-8-8z" fill={atKey ? 'currentColor' : 'none'} /></svg></button></Tip>}
        {exposable && <Tip label={exposed ? `Exposed as “${exposed.label}”` : 'Expose to other teams'}><button className={`icon-btn sm ${exposed ? 'on' : ''}`} disabled={c.readOnly} onClick={() => exposeParam(c.layer.id, path, label, meta)} aria-label={`Expose ${label}`} style={{ color: exposed ? 'var(--accent)' : undefined }}><Icon name="link" /></button></Tip>}
      </span>
    </div>
  );
}

function Num({ c, label, path, min, max, step = 0.01, slider = true, animatable, exposable, suffix }: { c: Ctx; label: string; path: string; min: number; max: number; step?: number; slider?: boolean; animatable?: boolean; exposable?: boolean; suffix?: string }) {
  const v = Number(valueAt(c.layer, path, c.doc, c.t) ?? 0);
  const on = (x: number) => setProp(c.layer.id, path, x);
  return (
    <Row c={c} label={label} path={path} animatable={animatable} exposable={exposable} meta={{ min, max, step }}>
      <div className="row" style={{ gap: 6 }}>
        {slider && <Slider label={label} value={v} min={min} max={max} step={step} onChange={on} onCommit={endCoalesce} disabled={c.readOnly || c.layer.locked} />}
        <div style={{ width: slider ? 58 : '100%' }}><NumberField label={label} value={v} onChange={on} onCommit={endCoalesce} step={step} min={min} max={max} suffix={suffix} disabled={c.readOnly || c.layer.locked} prefix={slider ? undefined : '↔'} /></div>
      </div>
    </Row>
  );
}

function Color({ c, label, path, swatches }: { c: Ctx; label: string; path: string; swatches: { label: string; value: string }[] }) {
  const v = String(valueAt(c.layer, path, c.doc, c.t) ?? '#000000');
  return <Row c={c} label={label} path={path}><ColorField label={label} value={v} swatches={swatches} onChange={(x) => setProp(c.layer.id, path, x)} onCommit={endCoalesce} disabled={c.readOnly || c.layer.locked} /></Row>;
}

function Choice({ c, label, path, options, exposable = true }: { c: Ctx; label: string; path: string; options: readonly string[]; exposable?: boolean }) {
  return (
    <Row c={c} label={label} path={path} animatable={false} exposable={exposable}>
      <select className="select sm" aria-label={label} value={String(getIn(c.layer, path))} disabled={c.readOnly || c.layer.locked} onChange={(e) => setProp(c.layer.id, path, e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </Row>
  );
}

function Bool({ c, label, path }: { c: Ctx; label: string; path: string }) {
  return <Row c={c} label={label} path={path} animatable={false} exposable={false}><Switch label={label} checked={!!getIn(c.layer, path)} disabled={c.readOnly || c.layer.locked} onChange={(v) => setProp(c.layer.id, path, v)} /></Row>;
}

const Vec = ({ c, label, base, min, max, step = 0.01 }: { c: Ctx; label: string; base: string; min: number; max: number; step?: number }) => (
  <Row c={c} label={label} path={`${base}.x`} exposable={false} animatable={false}>
    <div className="pgrid3">
      {(['x', 'y', 'z'] as const).map((k) => (
        <div key={k} className="row" style={{ gap: 2 }}>
          <NumberField label={`${label} ${k}`} prefix={k.toUpperCase()} value={Number(valueAt(c.layer, `${base}.${k}`, c.doc, c.t))} min={min} max={max} step={step} onChange={(v) => setProp(c.layer.id, `${base}.${k}`, v)} onCommit={endCoalesce} disabled={c.readOnly || c.layer.locked} />
        </div>
      ))}
    </div>
  </Row>
);

export function Inspector({ readOnly }: { readOnly: boolean }) {
  const { doc, selection, clock } = useStudio();
  const [, tick] = useReducer((x) => x + 1, 0);
  useEffect(() => clock.subscribe(tick), [clock]);
  // While paused, scrubbing updates displayed animated values.
  const tokens = useBrandTokens();
  const swatches = useMemo(() => colorSwatches(tokens), [tokens]);
  const layer = doc?.layers.find((l) => l.id === selection[0]);
  if (!doc) return null;
  if (!layer) return <SceneSettings doc={doc} readOnly={readOnly} swatches={swatches} />;
  const c: Ctx = { layer, doc, t: clock.time, readOnly };
  const is2D = layer.type === 'text' || layer.type === 'image' || layer.type === 'group';

  return (
    <div>
      <div className="row" style={{ padding: '12px 14px 4px', gap: 8 }}>
        <span className="h3 grow ellipsis">{layer.name}</span>
        <span className="badge mono">{layer.type}</span>
        {layer.locked && <span className="badge warn"><Icon name="lock" size={10} />locked</span>}
      </div>
      <PropertyGroup title="Layer" id="layer">
        <Num c={c} label="Opacity" path="opacity" min={0} max={1} exposable />
        <Choice c={c} label="Blend" path="blend" options={['normal', 'add', 'screen', 'multiply']} exposable={false} />
      </PropertyGroup>
      {is2D && (
        <PropertyGroup title="Transform" id="transform">
          <Num c={c} label="X" path="transform.x" min={-0.5} max={1.5} step={0.001} />
          <Num c={c} label="Y" path="transform.y" min={-0.5} max={1.5} step={0.001} />
          <Num c={c} label="Rotation" path="transform.rotation" min={-180} max={180} step={0.5} suffix="°" />
          <Num c={c} label="Scale" path="transform.scale" min={0.1} max={4} step={0.01} />
        </PropertyGroup>
      )}
      {layer.type === 'gradient' && <GradientPanel c={c} swatches={swatches} presets={gradientPresets(tokens)} />}
      {layer.type === 'mesh' && <MeshPanel c={c} swatches={swatches} />}
      {layer.type === 'particles' && <ParticlePanel c={c} swatches={swatches} />}
      {layer.type === 'text' && <TextPanel c={c} swatches={swatches} />}
      {layer.type === 'image' && <ImagePanel c={c} />}
      {(layer.type === 'text' || layer.type === 'image') && <ResponsivePanel c={c} />}
    </div>
  );
}

function GradientPanel({ c, swatches, presets }: { c: Ctx; swatches: any[]; presets: { key: string; label: string; stops: any }[] }) {
  const l = c.layer as Extract<Layer, { type: 'gradient' }>;
  const [shader, setShader] = useState(l.props.customShader ?? '');
  const err = shader ? validateShadeSnippet(shader) : null;
  const dis = c.readOnly || l.locked;
  return (
    <>
      <PropertyGroup title="Gradient" id="gradient">
        <Row c={c} label="Mode" path="props.mode" animatable={false}>
          <select className="select sm" aria-label="Gradient mode" value={l.props.mode} disabled={dis} onChange={(e) => setProp(l.id, 'props.mode', e.target.value)}>{GRADIENT_MODES.map((m) => <option key={m}>{m}</option>)}</select>
        </Row>
        <Row c={c} label="Stops" path="props.stops" animatable={false}>
          <GradientEditor stops={l.props.stops} swatches={swatches} disabled={dis} onChange={(s) => setProp(l.id, 'props.stops', s)} onCommit={endCoalesce} />
        </Row>
        {presets.length > 0 && (
          <div className="row wrap" style={{ gap: 5, paddingLeft: 84 }} aria-label="Brand gradient presets">
            {presets.map((p) => <Tip key={p.key} label={p.label}><button disabled={dis} aria-label={`Apply ${p.label}`} onClick={() => setProp(l.id, 'props.stops', p.stops)} style={{ width: 34, height: 14, borderRadius: 4, border: '1px solid var(--line-2)', background: gradientCss(p.stops), cursor: 'pointer' }} /></Tip>)}
          </div>
        )}
        <Choice c={c} label="Interpolation" path="props.interpolation" options={['oklab', 'smooth', 'linear']} exposable={false} />
        <Num c={c} label="Scale" path="props.scale" min={0.2} max={4} />
        {['linear'].includes(l.props.mode) && <Num c={c} label="Angle" path="props.angle" min={-180} max={180} step={1} suffix="°" />}
        <Num c={c} label="Centre X" path="props.center.x" min={0} max={1} step={0.005} />
        <Num c={c} label="Centre Y" path="props.center.y" min={0} max={1} step={0.005} />
      </PropertyGroup>
      <PropertyGroup title="Motion & texture" id="gradient-motion">
        <Num c={c} label="Noise freq" path="props.noiseFreq" min={0} max={8} />
        <Num c={c} label="Amplitude" path="props.noiseAmp" min={0} max={2} />
        <Num c={c} label="Distortion" path="props.distortion" min={0} max={2} />
        <Num c={c} label="Speed" path="props.speed" min={0} max={6} step={c.doc.canvas.loop ? 1 : 0.05} />
        {c.doc.canvas.loop && <div className="field-hint" style={{ paddingLeft: 84 }}>Loop on: speed rounds to whole cycles so the loop is seamless.</div>}
        <Num c={c} label="Flow dir" path="props.flowAngle" min={-180} max={180} step={1} suffix="°" />
        <Num c={c} label="Grain" path="props.grain" min={0} max={1} />
      </PropertyGroup>
      <PropertyGroup title="Expert · shader function" id="gradient-expert" defaultOpen={false}>
        <div className="field-hint">Body of <span className="mono">vec3 shade(vec2 uv, float t, vec3 base)</span>. No loops, textures, uniforms or directives. Compile errors revert automatically.</div>
        <textarea className="textarea mono" rows={5} aria-label="Custom shader function body" placeholder="return base * (0.9 + 0.1 * sin(uv.x * 40.0 + t));" value={shader} disabled={dis} onChange={(e) => setShader(e.target.value)} aria-invalid={!!err} />
        {err && <div className="field-error">{err}</div>}
        <div className="row">
          <button className="btn sm" disabled={dis || !!err} onClick={() => setProp(l.id, 'props.customShader', shader.trim() || null)}>Apply</button>
          {l.props.customShader && <button className="btn sm ghost" disabled={dis} onClick={() => { setShader(''); setProp(l.id, 'props.customShader', null); }}>Remove</button>}
        </div>
      </PropertyGroup>
    </>
  );
}

function MeshPanel({ c, swatches }: { c: Ctx; swatches: any[] }) {
  const l = c.layer as Extract<Layer, { type: 'mesh' }>;
  const [expert, setExpert] = useState(false);
  return (
    <>
      <PropertyGroup title="Geometry" id="mesh-geo">
        <Row c={c} label="Shape" path="props.geometry.kind" animatable={false}>
          <Segmented label="Geometry" value={l.props.geometry.kind} onChange={(v) => !c.readOnly && setProp(l.id, 'props.geometry.kind', v)} options={GEOMETRY_KINDS.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1, 4) }))} />
        </Row>
        <Num c={c} label="Scale" path="props.scale" min={0.1} max={4} />
        <Vec c={c} label="Position" base="props.position" min={-10} max={10} />
        <Vec c={c} label="Rotation" base="props.rotation" min={-360} max={360} step={1} />
        <Vec c={c} label="Spin/loop" base="props.spin" min={-4} max={4} step={1} />
      </PropertyGroup>
      <PropertyGroup title="Material" id="mesh-mat">
        <Color c={c} label="Colour" path="props.material.color" swatches={swatches} />
        <Color c={c} label="Sheen" path="props.material.color2" swatches={swatches} />
        <Num c={c} label="Roughness" path="props.material.roughness" min={0} max={1} />
        <Num c={c} label="Iridescence" path="props.material.iridescence" min={0} max={1} />
        <Bool c={c} label="Wireframe" path="props.material.wireframe" />
        <AssetPick c={c} label="Texture" path="props.material.textureAssetId" />
        {l.props.material.textureAssetId && <Num c={c} label="Tex mix" path="props.material.textureMix" min={0} max={1} />}
      </PropertyGroup>
      <PropertyGroup title="Deformation" id="mesh-def">
        <Num c={c} label="Amount" path="props.displacement.amount" min={0} max={1} />
        <Num c={c} label="Frequency" path="props.displacement.frequency" min={0} max={6} />
        <Num c={c} label="Speed" path="props.displacement.speed" min={0} max={6} step={1} />
      </PropertyGroup>
      <PropertyGroup title="Light & camera" id="mesh-light">
        <Num c={c} label="Intensity" path="props.light.intensity" min={0} max={4} />
        <Num c={c} label="Ambient" path="props.light.ambient" min={0} max={1.5} />
        <Color c={c} label="Light" path="props.light.color" swatches={swatches} />
        <Num c={c} label="Azimuth" path="props.light.azimuth" min={-180} max={180} step={1} suffix="°" />
        <Num c={c} label="Elevation" path="props.light.elevation" min={-90} max={90} step={1} suffix="°" />
        <div className="field-hint">Alt-drag (or drag empty canvas with the mesh selected) to orbit the camera.</div>
        <button className="btn sm ghost" onClick={() => setExpert(!expert)}><Icon name={expert ? 'chevronDown' : 'chevronRight'} size={12} />Expert controls</button>
        {expert && (
          <>
            <Num c={c} label="Fresnel" path="props.material.fresnel" min={0} max={4} />
            <Row c={c} label="Detail" path="props.geometry.detail" animatable={false} exposable={false}><NumberField label="Geometry detail" value={l.props.geometry.detail} min={4} max={256} step={1} prefix="↔" disabled={c.readOnly} onChange={(v) => setProp(l.id, 'props.geometry.detail', Math.round(v))} /></Row>
            <CameraFields doc={c.doc} readOnly={c.readOnly} />
          </>
        )}
      </PropertyGroup>
    </>
  );
}

function CameraFields({ doc, readOnly }: { doc: SceneDocument; readOnly: boolean }) {
  const cam = doc.canvas.camera;
  const upd = (k: keyof typeof cam, v: number) => commit((d) => ({ ...d, canvas: { ...d.canvas, camera: { ...d.canvas.camera, [k]: v } } }), `cam:${k}`);
  return (
    <div className="pgrid2">
      {(['fov', 'distance', 'yaw', 'pitch'] as const).map((k) => <NumberField key={k} label={`Camera ${k}`} prefix={k[0].toUpperCase()} value={cam[k]} step={k === 'distance' ? 0.1 : 1} min={k === 'fov' ? 10 : k === 'distance' ? 0.5 : -89} max={k === 'fov' ? 120 : k === 'distance' ? 100 : 89} disabled={readOnly} onChange={(v) => upd(k, v)} />)}
    </div>
  );
}

function ParticlePanel({ c, swatches }: { c: Ctx; swatches: any[] }) {
  const l = c.layer as Extract<Layer, { type: 'particles' }>;
  const dis = c.readOnly || l.locked;
  return (
    <>
      <PropertyGroup title="Particles" id="p-main">
        <Row c={c} label="Count" path="props.count" animatable={false} meta={{ min: 500, max: 50000, step: 500 }}>
          <div className="row" style={{ gap: 6 }}>
            <Slider label="Particle count" value={l.props.count} min={100} max={60000} step={100} disabled={dis} onChange={(v) => updateLayer(l.id, (x: any) => ({ ...x, props: { ...x.props, count: v } }), `count:${l.id}`)} onCommit={endCoalesce} />
            <span className="mono faint" style={{ width: 52, textAlign: 'right' }}>{l.props.count.toLocaleString()}</span>
          </div>
        </Row>
        <Num c={c} label="Size" path="props.size" min={0.5} max={16} step={0.1} />
        <Choice c={c} label="Shape" path="props.shape" options={PARTICLE_SHAPES} />
        <Color c={c} label="Colour A" path="props.colorA" swatches={swatches} />
        <Color c={c} label="Colour B" path="props.colorB" swatches={swatches} />
        <Num c={c} label="Lifetime" path="props.lifetime" min={0.5} max={20} step={0.1} suffix="s" />
      </PropertyGroup>
      <PropertyGroup title="Emission & forces" id="p-forces">
        <Num c={c} label="Velocity" path="props.velocity" min={0} max={1} step={0.005} />
        <Num c={c} label="Direction" path="props.direction" min={-180} max={180} step={1} suffix="°" />
        <Num c={c} label="Spread" path="props.spread" min={0} max={360} step={1} suffix="°" />
        <Num c={c} label="Gravity" path="props.gravity" min={-1} max={1} step={0.005} />
        <Num c={c} label="Noise" path="props.noise" min={0} max={2} />
        <Num c={c} label="Emitter X" path="props.emitter.x" min={0} max={1} step={0.005} />
        <Num c={c} label="Emitter Y" path="props.emitter.y" min={0} max={1} step={0.005} />
        <Num c={c} label="Area W" path="props.emitterSize.x" min={0} max={2} />
        <Num c={c} label="Area H" path="props.emitterSize.y" min={0} max={2} />
      </PropertyGroup>
      <PropertyGroup title="Attractors & pointer" id="p-attr">
        {l.props.attractors.map((a, i) => (
          <div key={i} className="row" style={{ gap: 4 }}>
            <span className="label" style={{ width: 70 }}>{a.strength >= 0 ? 'Attractor' : 'Repulsor'} {i + 1}</span>
            {(['x', 'y', 'strength'] as const).map((k) => <NumberField key={k} label={`Attractor ${i + 1} ${k}`} prefix={k[0].toUpperCase()} value={Number(valueAt(l, `props.attractors.${i}.${k}`, c.doc, c.t))} step={0.01} min={k === 'strength' ? -4 : -1} max={k === 'strength' ? 4 : 2} disabled={dis} onChange={(v) => setProp(l.id, `props.attractors.${i}.${k}`, v)} onCommit={endCoalesce} />)}
            <button className="icon-btn sm" aria-label="Remove attractor" disabled={dis} onClick={() => setProp(l.id, 'props.attractors', l.props.attractors.filter((_, j) => j !== i))}><Icon name="x" /></button>
          </div>
        ))}
        <div className="row"><button className="btn sm" disabled={dis || l.props.attractors.length >= 8} onClick={() => setProp(l.id, 'props.attractors', [...l.props.attractors, { x: 0.5, y: 0.5, strength: 0.5 }])}><Icon name="plus" size={12} />Attractor</button>
          <button className="btn sm" disabled={dis || l.props.attractors.length >= 8} onClick={() => setProp(l.id, 'props.attractors', [...l.props.attractors, { x: 0.5, y: 0.5, strength: -0.5 }])}><Icon name="plus" size={12} />Repulsor</button></div>
        <Choice c={c} label="Pointer" path="props.pointer" options={['none', 'attract', 'repel']} />
        <Num c={c} label="Strength" path="props.pointerStrength" min={0} max={4} />
        <div className="field-hint">Pointer interaction is live in previews and embeds; video and image exports render without it.</div>
      </PropertyGroup>
    </>
  );
}

function TextPanel({ c, swatches }: { c: Ctx; swatches: any[] }) {
  const l = c.layer as Extract<Layer, { type: 'text' }>;
  const dis = c.readOnly || l.locked;
  const [fonts, setFonts] = useState<{ id: string; name: string; license: any }[]>([]);
  useEffect(() => { api('/assets', { query: { kind: 'font' } }).then((r) => setFonts(r.assets)).catch(() => {}); }, []);
  const over = l.props.maxChars && [...l.props.text].length > l.props.maxChars;
  return (
    <>
      <PropertyGroup title="Text" id="text">
        <Row c={c} label="Content" path="props.text" animatable={false}>
          <textarea className="textarea" rows={3} aria-label="Text content" value={l.props.text} disabled={dis} aria-invalid={!!over} onChange={(e) => setProp(l.id, 'props.text', e.target.value)} />
        </Row>
        {over && <div className="field-error" style={{ paddingLeft: 84 }}>{[...l.props.text].length}/{l.props.maxChars} characters — truncated on canvas</div>}
        <Row c={c} label="Font" path="props.fontFamily" animatable={false} exposable={false}>
          <select className="select sm" aria-label="Font family" disabled={dis} value={l.props.fontAssetId ? `asset:${l.props.fontAssetId}` : l.props.fontFamily}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('asset:')) {
                const f = fonts.find((x) => x.id === v.slice(6));
                if (f && f.license && !f.license.video) toast('warn', `${f.name} is not licensed for video`, 'Check the licence before exporting MP4 with this font.');
                updateLayer(l.id, (x: any) => ({ ...x, props: { ...x.props, fontAssetId: v.slice(6), fontFamily: f?.name ?? 'Custom' } }));
              } else updateLayer(l.id, (x: any) => ({ ...x, props: { ...x.props, fontAssetId: null, fontFamily: v } }));
            }}>
            <optgroup label="Bundled">{SCENE_FONTS.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}</optgroup>
            {fonts.length > 0 && <optgroup label="Uploaded (licensed)">{fonts.map((f) => <option key={f.id} value={`asset:${f.id}`}>{f.name}</option>)}</optgroup>}
          </select>
        </Row>
        <Num c={c} label="Weight" path="props.weight" min={100} max={900} step={100} animatable={false} />
        <Num c={c} label="Size" path="props.size" min={0.01} max={0.5} step={0.001} />
        <Num c={c} label="Tracking" path="props.tracking" min={-0.15} max={0.6} step={0.005} />
        <Num c={c} label="Line height" path="props.lineHeight" min={0.7} max={2} />
        <Row c={c} label="Align" path="props.align" animatable={false} exposable={false}>
          <Segmented label="Text alignment" value={l.props.align} onChange={(v) => !dis && setProp(l.id, 'props.align', v)} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} />
        </Row>
        <Color c={c} label="Colour" path="props.color" swatches={swatches} />
        <Num c={c} label="Max width" path="props.maxWidth" min={0.1} max={1} animatable={false} />
        <Row c={c} label="Max chars" path="props.maxChars" animatable={false} exposable={false}>
          <NumberField label="Maximum characters" prefix="#" value={l.props.maxChars ?? 0} min={0} max={2000} step={1} disabled={dis} onChange={(v) => setProp(l.id, 'props.maxChars', v > 0 ? Math.round(v) : null)} />
        </Row>
      </PropertyGroup>
      <PropertyGroup title="Animation" id="text-anim">
        <Choice c={c} label="Preset" path="props.animation.preset" options={TEXT_PRESETS} />
        <Num c={c} label="Start" path="props.animation.start" min={0} max={c.doc.canvas.duration} step={0.05} suffix="s" animatable={false} />
        <Num c={c} label="Duration" path="props.animation.duration" min={0.1} max={6} step={0.05} suffix="s" animatable={false} />
        <Num c={c} label="Stagger" path="props.animation.stagger" min={0} max={0.95} animatable={false} />
        <Choice c={c} label="Easing" path="props.animation.easing" options={EASINGS} exposable={false} />
        <Bool c={c} label="Animate out" path="props.animation.exit" />
      </PropertyGroup>
    </>
  );
}

function AssetPick({ c, label, path }: { c: Ctx; label: string; path: string }) {
  const [assets, setAssets] = useState<any[]>([]);
  useEffect(() => { api('/assets', { query: { kind: 'image' } }).then((r) => setAssets(r.assets)).catch(() => {}); }, []);
  const v = getIn(c.layer, path) as string | null;
  return (
    <Row c={c} label={label} path={path} animatable={false}>
      <div className="row wrap" style={{ gap: 5 }}>
        <button className="swatch lg" aria-pressed={!v} aria-label="None" title="None" onClick={() => setProp(c.layer.id, path, null)} disabled={c.readOnly} style={{ background: 'var(--bg-3)', display: 'grid', placeItems: 'center' }}><Icon name="x" size={12} /></button>
        {assets.map((a) => <button key={a.id} className="swatch lg" aria-pressed={v === a.id} aria-label={a.name} title={a.name} disabled={c.readOnly} onClick={() => setProp(c.layer.id, path, a.id)} style={{ backgroundImage: `url(${a.url})`, backgroundSize: 'cover' }} />)}
        {v && !assets.some((a) => a.id === v) && <span className="field-error">Asset missing</span>}
      </div>
    </Row>
  );
}

function ImagePanel({ c }: { c: Ctx }) {
  return (
    <>
      <PropertyGroup title="Image" id="image">
        <AssetPick c={c} label="Asset" path="props.assetId" />
        <Choice c={c} label="Fit" path="props.fit" options={['cover', 'contain', 'fill']} />
        <Num c={c} label="Width" path="props.width" min={0.05} max={2} />
        <Num c={c} label="Height" path="props.height" min={0.05} max={2} />
        <Choice c={c} label="Mask" path="props.mask" options={['none', 'rounded', 'circle', 'fade']} />
        <Num c={c} label="Radius" path="props.radius" min={0} max={0.5} />
      </PropertyGroup>
      <PropertyGroup title="Crop" id="image-crop" defaultOpen={false}>
        <Num c={c} label="Crop X" path="props.crop.x" min={0} max={1} animatable={false} />
        <Num c={c} label="Crop Y" path="props.crop.y" min={0} max={1} animatable={false} />
        <Num c={c} label="Crop W" path="props.crop.w" min={0.05} max={1} animatable={false} />
        <Num c={c} label="Crop H" path="props.crop.h" min={0.05} max={1} animatable={false} />
      </PropertyGroup>
      <PropertyGroup title="Motion" id="image-motion">
        <Num c={c} label="Displace" path="props.displacement" min={0} max={1} />
        <Num c={c} label="Disp speed" path="props.displacementSpeed" min={0} max={6} step={1} />
        <Choice c={c} label="Reveal" path="props.reveal.preset" options={['none', 'fade', 'wipe', 'scale', 'iris']} />
        <Num c={c} label="Start" path="props.reveal.start" min={0} max={c.doc.canvas.duration} step={0.05} suffix="s" animatable={false} />
        <Num c={c} label="Duration" path="props.reveal.duration" min={0.1} max={6} step={0.05} suffix="s" animatable={false} />
        <Choice c={c} label="Easing" path="props.reveal.easing" options={EASINGS} exposable={false} />
      </PropertyGroup>
    </>
  );
}

function ResponsivePanel({ c }: { c: Ctx }) {
  const rule = c.doc.responsive.rules.find((r) => r.layerId === c.layer.id);
  const setRule = (patch: Partial<NonNullable<typeof rule>>) => commit((d) => {
    const rest = d.responsive.rules.filter((r) => r.layerId !== c.layer.id);
    return { ...d, responsive: { ...d.responsive, rules: [...rest, { layerId: c.layer.id, safeArea: false, scaleWith: 'min', ...rule, ...patch }] } };
  });
  const fmt = useStudio((s) => s.previewFormat);
  const ov = fmt ? c.doc.responsive.overrides[fmt]?.[c.layer.id] : undefined;
  return (
    <PropertyGroup title="Responsive" id="responsive" defaultOpen={false}>
      <div className="prow"><span className="label">Safe area</span><Switch label="Keep inside safe area" checked={!!rule?.safeArea} disabled={c.readOnly} onChange={(v) => setRule({ safeArea: v })} /><span /></div>
      <div className="prow"><span className="label">Scale with</span>
        <select className="select sm" aria-label="Scale with" value={rule?.scaleWith ?? 'min'} disabled={c.readOnly} onChange={(e) => setRule({ scaleWith: e.target.value as any })}><option value="min">Shortest side</option><option value="width">Width</option><option value="height">Height</option></select><span /></div>
      {fmt ? (
        <>
          <div className="field-hint">Overrides for <b>{fmt}</b> (current preview). Leave blank to inherit.</div>
          <div className="pgrid3">
            {(['x', 'y', 'scale'] as const).map((k) => (
              <NumberField key={k} label={`${fmt} ${k} override`} prefix={k[0].toUpperCase()} value={ov?.[k] ?? (k === 'scale' ? c.layer.transform.scale : c.layer.transform[k])} step={0.005} min={-1} max={4} disabled={c.readOnly}
                onChange={(v) => commit((d) => ({ ...d, responsive: { ...d.responsive, overrides: { ...d.responsive.overrides, [fmt]: { ...(d.responsive.overrides[fmt] ?? {}), [c.layer.id]: { ...(d.responsive.overrides[fmt]?.[c.layer.id] ?? {}), [k]: v } } } } }), `ov:${fmt}:${k}`)} />
            ))}
          </div>
          {ov && <button className="btn sm ghost" onClick={() => commit((d) => { const o = { ...(d.responsive.overrides[fmt] ?? {}) }; delete o[c.layer.id]; return { ...d, responsive: { ...d.responsive, overrides: { ...d.responsive.overrides, [fmt]: o } } }; })}>Reset override</button>}
        </>
      ) : <div className="field-hint">Choose a preview format above the canvas to set per-channel position overrides.</div>}
    </PropertyGroup>
  );
}

function SceneSettings({ doc, readOnly, swatches }: { doc: SceneDocument; readOnly: boolean; swatches: any[] }) {
  const upd = (patch: Partial<SceneDocument['canvas']>, k?: string) => commit((d) => ({ ...d, canvas: { ...d.canvas, ...patch } }), k);
  return (
    <div>
      <div style={{ padding: '12px 14px 4px' }}><span className="h3">Scene</span><div className="faint" style={{ fontSize: 12 }}>Nothing selected — editing scene settings.</div></div>
      <PropertyGroup title="Canvas" id="scene-canvas">
        <div className="prow"><span className="label">Size</span>
          <select className="select sm" aria-label="Canvas size preset" disabled={readOnly} value={`${doc.canvas.width}x${doc.canvas.height}`} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); upd({ width: w, height: h }); }}>
            {!CANVAS_PRESETS.some(([w, h]) => w === doc.canvas.width && h === doc.canvas.height) && <option value={`${doc.canvas.width}x${doc.canvas.height}`}>Custom {doc.canvas.width}×{doc.canvas.height}</option>}
            {CANVAS_PRESETS.map(([w, h]) => <option key={`${w}x${h}`} value={`${w}x${h}`}>{w}×{h}</option>)}
          </select><span /></div>
        <div className="prow"><span className="label">W × H</span><div className="pgrid2">
          <NumberField label="Width" prefix="W" value={doc.canvas.width} min={16} max={4096} step={1} disabled={readOnly} onChange={(v) => upd({ width: Math.round(v) }, 'w')} />
          <NumberField label="Height" prefix="H" value={doc.canvas.height} min={16} max={4096} step={1} disabled={readOnly} onChange={(v) => upd({ height: Math.round(v) }, 'h')} />
        </div><span /></div>
        <div className="prow"><span className="label">Background</span><ColorField label="Background" value={doc.canvas.background} swatches={swatches} disabled={readOnly} onChange={(v) => upd({ background: v }, 'bg')} /><span /></div>
      </PropertyGroup>
      <PropertyGroup title="Time" id="scene-time">
        <div className="prow"><span className="label">Duration</span><NumberField label="Duration" prefix="⏱" suffix="s" value={doc.canvas.duration} min={0.5} max={120} step={0.1} disabled={readOnly} onChange={(v) => upd({ duration: v }, 'dur')} /><span /></div>
        <div className="prow"><span className="label">Frame rate</span><select className="select sm" aria-label="Frame rate" disabled={readOnly} value={doc.canvas.fps} onChange={(e) => upd({ fps: Number(e.target.value) })}>{[24, 25, 30, 50, 60].map((f) => <option key={f}>{f}</option>)}</select><span /></div>
        <div className="prow"><span className="label">Seamless loop</span><Switch label="Seamless loop" checked={doc.canvas.loop} disabled={readOnly} onChange={(v) => upd({ loop: v })} /><span /></div>
        <div className="prow"><span className="label">Random seed</span><div className="row" style={{ gap: 4 }}><NumberField label="Seed" prefix="#" value={doc.seed} step={1} min={0} max={2 ** 31} disabled={readOnly} onChange={(v) => commit((d) => ({ ...d, seed: Math.round(v) }))} /><button className="icon-btn sm" aria-label="New random seed" disabled={readOnly} onClick={() => commit((d) => ({ ...d, seed: Math.floor(Math.random() * 1e6) }))}><Icon name="refresh" /></button></div><span /></div>
      </PropertyGroup>
      <PropertyGroup title="Accessibility & delivery" id="scene-a11y">
        <div className="prow"><span className="label">Reduced motion</span><select className="select sm" aria-label="Reduced motion behaviour" disabled={readOnly} value={doc.fallback.reducedMotion} onChange={(e) => commit((d) => ({ ...d, fallback: { ...d.fallback, reducedMotion: e.target.value as any } }))}><option value="static">Static fallback frame</option><option value="reduced">Reduced (fades, no travel)</option></select><span /></div>
        <div className="prow"><span className="label">Static frame</span><NumberField label="Static fallback frame time" prefix="t" suffix="s" value={doc.fallback.staticFrame} min={0} max={doc.canvas.duration} step={0.05} disabled={readOnly} onChange={(v) => commit((d) => ({ ...d, fallback: { ...d.fallback, staticFrame: v } }), 'sf')} /><span /></div>
        <div className="prow"><span className="label">Poster frame</span><NumberField label="Poster frame time" prefix="t" suffix="s" value={doc.export.posterTime} min={0} max={doc.canvas.duration} step={0.05} disabled={readOnly} onChange={(v) => commit((d) => ({ ...d, export: { posterTime: v } }), 'pt')} /><span /></div>
        <div className="prow"><span className="label">Focal point</span><div className="pgrid2">
          <NumberField label="Focal X" prefix="X" value={doc.responsive.focalPoint.x} min={0} max={1} step={0.01} disabled={readOnly} onChange={(v) => commit((d) => ({ ...d, responsive: { ...d.responsive, focalPoint: { ...d.responsive.focalPoint, x: v } } }), 'fx')} />
          <NumberField label="Focal Y" prefix="Y" value={doc.responsive.focalPoint.y} min={0} max={1} step={0.01} disabled={readOnly} onChange={(v) => commit((d) => ({ ...d, responsive: { ...d.responsive, focalPoint: { ...d.responsive.focalPoint, y: v } } }), 'fy')} />
        </div><span /></div>
      </PropertyGroup>
      <PropertyGroup title="Camera" id="scene-camera" defaultOpen={false}><CameraFields doc={doc} readOnly={readOnly} /></PropertyGroup>
    </div>
  );
}
