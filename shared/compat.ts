import type { Layer, SceneDocument } from './scene/schema';
import { luminance } from './util/color';
import { evaluateLayers } from './timeline';

export type FeatureClass = 'native' | 'vector' | 'raster' | 'fallback';
export type ExportFormatId = 'png' | 'webp' | 'mp4' | 'scene-json' | 'embed' | 'webm' | 'gif' | 'svg' | 'lottie' | 'dotlottie' | 'react-sdk' | 'gltf';

export const EXPORT_FORMATS: { id: ExportFormatId; label: string; kind: 'image' | 'video' | 'data' | 'vector' | 'code' | '3d'; implemented: boolean; note: string }[] = [
  { id: 'mp4', label: 'MP4 (H.264)', kind: 'video', implemented: true, note: 'Deterministic frame render, WebCodecs encoder' },
  { id: 'png', label: 'PNG frame', kind: 'image', implemented: true, note: 'Exact frame, lossless' },
  { id: 'webp', label: 'WebP frame', kind: 'image', implemented: true, note: 'Exact frame, lossy/lossless' },
  { id: 'scene-json', label: 'Motion Scene JSON', kind: 'data', implemented: true, note: 'Native, versioned, re-importable' },
  { id: 'embed', label: 'WebGL embed config', kind: 'code', implemented: true, note: 'Version-pinned config + local runtime (hosted delivery: later phase)' },
  { id: 'webm', label: 'WebM', kind: 'video', implemented: false, note: 'Planned — encoder path shares the MP4 pipeline' },
  { id: 'gif', label: 'GIF', kind: 'video', implemented: false, note: 'Planned — palette quantisation worker' },
  { id: 'svg', label: 'SVG', kind: 'vector', implemented: false, note: 'Planned — vector-compatible layers only' },
  { id: 'lottie', label: 'Lottie JSON', kind: 'vector', implemented: false, note: 'Planned — requires a real converter; never a renamed scene file' },
  { id: 'dotlottie', label: 'dotLottie', kind: 'vector', implemented: false, note: 'Planned — depends on Lottie converter' },
  { id: 'react-sdk', label: 'React SDK', kind: 'code', implemented: false, note: 'Planned — package of the embed runtime' },
  { id: 'gltf', label: 'glTF / GLB', kind: '3d', implemented: false, note: 'Planned — static mesh geometry only' },
];

export type CompatItem = { layerId?: string; feature: string; cls: FeatureClass; level: 'ok' | 'info' | 'warn' | 'error'; message: string };
export type CompatReport = { format: ExportFormatId; implemented: boolean; status: 'supported' | 'partial' | 'unsupported'; items: CompatItem[]; flashing: string[] };

export function classifyLayer(l: Layer): { cls: FeatureClass; feature: string }[] {
  switch (l.type) {
    case 'gradient': {
      const procedural = !['linear', 'radial'].includes(l.props.mode) || l.props.noiseAmp > 0.15 || l.props.distortion > 0.05;
      const out: { cls: FeatureClass; feature: string }[] = [{ cls: procedural ? 'native' : 'vector', feature: `${l.props.mode} gradient${procedural ? ' (procedural shader)' : ''}` }];
      if (l.props.grain > 0) out.push({ cls: 'raster', feature: 'film grain' });
      if (l.props.customShader) out.push({ cls: 'native', feature: 'custom shader function' });
      return out;
    }
    case 'mesh':
      return [{ cls: 'native', feature: `3D ${l.props.geometry.kind}${l.props.displacement.amount > 0 ? ' with vertex displacement' : ''}` }];
    case 'particles':
      return [{ cls: 'native', feature: `${l.props.count.toLocaleString('en')} GPU particles` }, ...(l.props.pointer !== 'none' ? [{ cls: 'fallback' as const, feature: `pointer ${l.props.pointer}` }] : [])];
    case 'text':
      return [{ cls: l.props.animation.preset === 'scramble' ? 'fallback' : 'vector', feature: `text (${l.props.animation.preset})` }];
    case 'image':
      return [{ cls: l.props.displacement > 0 ? 'native' : 'raster', feature: `image${l.props.displacement > 0 ? ' with displacement' : ''}` }, ...(l.props.mask !== 'none' ? [{ cls: 'vector' as const, feature: `${l.props.mask} mask` }] : [])];
    case 'group':
      return [];
  }
}

/** Rough photosensitivity check: count large luminance swings of the background per second. */
export function detectFlashing(scene: SceneDocument): string[] {
  const out: string[] = [];
  const steps = Math.min(240, Math.ceil(scene.canvas.duration * 30));
  for (const l of scene.layers) {
    if (!l.visible) continue;
    let prev: number | null = null, swings = 0;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * scene.canvas.duration;
      const r = evaluateLayers(scene, t).find((x) => x.id === l.id)!;
      const lum = layerLuminance(r) * r.opacity;
      if (prev !== null && Math.abs(lum - prev) > 0.2) swings++;
      prev = lum;
    }
    const perSecond = swings / 2 / scene.canvas.duration;
    if (perSecond > 3) out.push(`${l.name}: ~${perSecond.toFixed(1)} flashes/s exceeds the 3 per second threshold (WCAG 2.3.1)`);
  }
  for (const l of scene.layers) {
    if (l.type === 'gradient' && l.visible && l.props.speed > 6) {
      const lums = l.props.stops.map((s) => luminance(s.color));
      if (Math.max(...lums) - Math.min(...lums) > 0.6) out.push(`${l.name}: fast, high-contrast gradient motion may be harmful; consider speed ≤ 6`);
    }
  }
  return out;
}

export function analyzeCompatibility(scene: SceneDocument, format: ExportFormatId): CompatReport {
  const meta = EXPORT_FORMATS.find((f) => f.id === format)!;
  const items: CompatItem[] = [];
  const visible = scene.layers.filter((l) => l.visible && l.type !== 'group');
  for (const l of visible) {
    for (const f of classifyLayer(l)) {
      const base = { layerId: l.id, feature: `${l.name}: ${f.feature}`, cls: f.cls };
      if (meta.kind === 'image' || meta.kind === 'video') {
        if (f.cls === 'fallback' && f.feature.startsWith('pointer')) items.push({ ...base, level: 'warn', message: 'Interactivity is lost; rendered without pointer input.' });
        else items.push({ ...base, level: 'ok', message: meta.kind === 'video' ? 'Rendered frame-by-frame (rasterised).' : 'Rasterised at export resolution.' });
      } else if (meta.id === 'scene-json' || meta.id === 'embed') {
        items.push({ ...base, level: 'ok', message: 'Preserved natively.' });
      } else if (meta.kind === 'vector') {
        if (f.cls === 'vector') items.push({ ...base, level: 'ok', message: 'Vector-compatible.' });
        else if (f.cls === 'raster') items.push({ ...base, level: 'warn', message: 'Would be rasterised into an embedded image sequence.' });
        else if (f.cls === 'fallback') items.push({ ...base, level: 'warn', message: 'Needs a fallback approximation; visual differences expected.' });
        else items.push({ ...base, level: 'error', message: 'Procedural WebGL feature with no vector equivalent.' });
      } else if (meta.id === 'gltf') {
        items.push({ ...base, level: l.type === 'mesh' ? 'warn' : 'error', message: l.type === 'mesh' ? 'Static geometry only; shader displacement is baked or lost.' : 'Not representable in glTF.' });
      } else {
        items.push({ ...base, level: 'info', message: 'Rendered via the WebGL runtime.' });
      }
    }
  }
  const fonts = scene.layers.filter((l) => l.type === 'text' && l.visible).map((l: any) => l.props.fontFamily);
  if (fonts.length && (meta.kind === 'vector')) items.push({ feature: `fonts: ${[...new Set(fonts)].join(', ')}`, cls: 'vector', level: 'info', message: 'Text would need to be converted to outlines or the font embedded.' });
  if (meta.id === 'mp4' && scene.canvas.loop) items.push({ feature: 'seamless loop', cls: 'raster', level: 'info', message: 'Loop is baked; players must enable looping playback.' });
  if (meta.kind === 'image') items.push({ feature: 'animation', cls: 'raster', level: 'info', message: 'Single frame; motion is not preserved.' });
  const flashing = detectFlashing(scene);
  const hasError = items.some((i) => i.level === 'error');
  const hasWarn = items.some((i) => i.level === 'warn');
  return { format, implemented: meta.implemented, status: !meta.implemented || hasError ? 'unsupported' : hasWarn ? 'partial' : 'supported', items, flashing };
}

function layerLuminance(l: Layer): number {
  switch (l.type) {
    case 'gradient': return l.props.stops.reduce((a, s) => a + luminance(s.color), 0) / l.props.stops.length;
    case 'text': return luminance(l.props.color) * 0.3;
    case 'particles': return ((luminance(l.props.colorA) + luminance(l.props.colorB)) / 2) * 0.3;
    case 'mesh': return luminance(l.props.material.color) * 0.5;
    default: return 0.5;
  }
}
