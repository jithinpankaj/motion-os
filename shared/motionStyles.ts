import { z } from 'zod';
import { createLayer, createScene } from './scene/defaults';
import type { Easing, Keyframe, Layer, SceneDocument, Track } from './scene/schema';
import { personalityOf, type BrandKit, type Personality } from './brandImport';
import { uid } from './util/random';
import { luminance, mixHex } from './util/color';

/**
 * Motion styles for the simple Create flow. Each style turns an imported design (one or more
 * positioned layers) plus the brand kit into an ordinary, fully editable scene document —
 * the same format the advanced editor, exports and embeds use.
 */
export type DesignLayer = {
  assetId: string;
  name: string;
  /** centre, as a fraction of canvas width / height */
  x: number;
  y: number;
  /** size, as a fraction of the canvas's shorter side (matches image layers) */
  w: number;
  h: number;
};
export type Design = { name: string; width: number; height: number; background: string | null; layers: DesignLayer[] };

export type StyleKey = 'build' | 'float' | 'backdrop' | 'pop' | 'zoom' | 'headline';
export const MOTION_STYLES: { key: StyleKey; name: string; description: string; needsDesign: boolean }[] = [
  { key: 'build', name: 'Build in', description: 'Each part of your design arrives in turn, then holds.', needsDesign: true },
  { key: 'float', name: 'Gentle float', description: 'Parts drift softly in a seamless loop.', needsDesign: true },
  { key: 'backdrop', name: 'Brand backdrop', description: 'Your design over a living gradient in your brand colours.', needsDesign: false },
  { key: 'pop', name: 'Pop & sparkle', description: 'The hero element pops in with brand-coloured particles.', needsDesign: false },
  { key: 'zoom', name: 'Slow zoom', description: 'A slow cinematic push-in. Great for photos and posters.', needsDesign: true },
  { key: 'headline', name: 'Headline focus', description: 'Your message animates in, design supports it.', needsDesign: false },
];

export type CreateOptions = {
  design: Design | null;
  brand: BrandKit;
  style: StyleKey;
  personality?: Personality;
  headline?: string;
  showLogo?: boolean;
  keepBackground?: boolean;
  duration?: number;
  /** output canvas; defaults to the design's own aspect */
  width?: number;
  height?: number;
  name?: string;
};

const kf = (t: number, value: number, easing: Easing = 'easeInOut'): Keyframe => ({ id: uid('kf'), t: +t.toFixed(3), value: +value.toFixed(4), easing });
const track = (layerId: string, path: string, keyframes: Keyframe[]): Track => ({ id: uid('tr'), layerId, path, keyframes });

/** A layer is "background" when it covers (almost) the whole canvas. */
export function isBackgroundLayer(l: DesignLayer, width: number, height: number) {
  const min = Math.min(width, height);
  return (l.w * min) / width > 0.92 && (l.h * min) / height > 0.92;
}

/** Fit a design into a (possibly different) output canvas, centred, preserving its aspect. */
function placeDesign(design: Design, W: number, H: number) {
  const s = Math.min(W / design.width, H / design.height);
  const ox = (W - design.width * s) / 2, oy = (H - design.height * s) / 2;
  const dMin = Math.min(design.width, design.height), oMin = Math.min(W, H);
  return design.layers.map((l) => ({
    ...l,
    x: (ox + l.x * design.width * s) / W,
    y: (oy + l.y * design.height * s) / H,
    w: (l.w * dMin * s) / oMin,
    h: (l.h * dMin * s) / oMin,
  }));
}

function brandGradient(brand: BrandKit) {
  if (brand.gradient?.length) return brand.gradient;
  const c = brand.colors;
  const stops = [c['color.night'] ?? '#05060a', c['color.primary'] ?? '#6b8cff', c['color.secondary'] ?? c['color.accent'] ?? '#ff6ad5', c['color.accent'] ?? c['color.primary'] ?? '#ff5a36'];
  return stops.map((color, i) => ({ color, pos: i / (stops.length - 1) }));
}

export function buildMotion(o: CreateOptions): SceneDocument {
  const p = personalityOf(o.personality ?? o.brand.personality);
  const W = o.width ?? (o.design ? fitCanvas(o.design.width, o.design.height).width : 1080);
  const H = o.height ?? (o.design ? fitCanvas(o.design.width, o.design.height).height : 1350);
  const D = o.duration ?? 8;
  const ease: Easing = p.easing as Easing;
  const bg = o.brand.colors['color.night'] ?? '#05060a';
  const doc = createScene({ meta: { name: o.name ?? o.design?.name ?? 'New motion', description: `${MOTION_STYLES.find((s) => s.key === o.style)?.name} · ${p.label}`, tags: ['create', o.style, p.key] } });
  doc.canvas = { ...doc.canvas, width: W, height: H, duration: D, background: o.design?.background ?? bg };
  doc.fallback = { staticFrame: Math.min(D - 0.1, 3), reducedMotion: 'static' };
  doc.export = { posterTime: Math.min(D - 0.1, 3) };
  const layers: Layer[] = [];
  const tracks: Track[] = [];
  const placed = o.design ? placeDesign(o.design, W, H) : [];
  const bgLayers = placed.filter((l) => isBackgroundLayer(l, W, H));
  const parts = placed.filter((l) => !isBackgroundLayer(l, W, H));
  const useBackdrop = o.style === 'backdrop' || o.style === 'pop' || o.style === 'headline' || !o.design;
  const keepBg = o.keepBackground ?? !useBackdrop;

  if (useBackdrop) {
    const g = createLayer('gradient', { name: 'Brand backdrop' });
    g.props = { ...g.props, mode: o.style === 'pop' ? 'organic' : 'aurora', stops: brandGradient(o.brand).slice(0, 6), speed: Math.max(1, Math.round(p.speed)), noiseAmp: 0.35 + 0.3 * p.amplitude, grain: 0.04 };
    layers.push(g);
  }
  const imageLayer = (l: DesignLayer) => {
    const layer = createLayer('image', { name: l.name, transform: { x: l.x, y: l.y, rotation: 0, scale: 1 } });
    layer.props = { ...layer.props, assetId: l.assetId, fit: 'contain', mask: 'none', radius: 0, width: Math.max(0.01, Math.min(4, l.w)), height: Math.max(0.01, Math.min(4, l.h)), reveal: { preset: 'none', start: 0, duration: 1, easing: 'easeOut' } };
    return layer;
  };
  // A kept background covers the whole output frame (cropping if the channel's shape differs), so other
  // sizes never show empty bars; the remaining parts stay where the design put them.
  if (keepBg) for (const l of bgLayers) {
    const bg = imageLayer(l);
    const m = Math.min(W, H);
    bg.transform = { ...bg.transform, x: 0.5, y: 0.5 };
    bg.props = { ...bg.props, fit: 'cover', width: Math.min(4, W / m), height: Math.min(4, H / m) };
    layers.push(bg);
  }
  // A single flat image (no separate parts) is animated as a whole.
  const animated = parts.length ? parts : keepBg ? [] : bgLayers;

  const group = o.style === 'zoom' ? createLayer('group', { name: 'Design' }) : null;
  if (group) layers.splice(useBackdrop ? 1 : 0, 0, group);
  const zoomTargets: Layer[] = [];
  if (group) for (const l of layers) if (l.type === 'image') { l.parentId = group.id; zoomTargets.push(l); }

  // Every part has arrived by ~40% of the loop, however many parts there are.
  const gap = Math.min(0.18 / p.speed, (D * 0.4) / Math.max(1, animated.length)), enter = Math.min(0.9 / p.speed, D * 0.25), outStart = D - 0.6;
  animated.forEach((l, i) => {
    const layer = imageLayer(l);
    if (group) layer.parentId = group.id;
    layers.push(layer);
    const y = layer.transform.y;
    if (o.style === 'build' || o.style === 'backdrop' || o.style === 'headline' || (o.style === 'pop' && i > 0)) {
      const t0 = 0.2 + i * gap;
      const lift = 0.04 * p.amplitude;
      tracks.push(track(layer.id, 'opacity', [kf(t0, 0, ease), kf(t0 + enter * 0.7, 1), kf(outStart, 1, 'easeIn'), kf(D, 0)]));
      tracks.push(track(layer.id, 'transform.y', [kf(t0, y + lift, ease), kf(t0 + enter, y)]));
      if (o.style === 'backdrop') floatTracks(layer, i, D, p.amplitude * 0.5, tracks, t0 + enter);
    } else if (o.style === 'float') {
      floatTracks(layer, i, D, p.amplitude, tracks, 0);
    } else if (o.style === 'pop' && i === 0) {
      const t0 = 0.25;
      tracks.push(track(layer.id, 'transform.scale', [kf(t0, 0.6, 'backOut'), kf(t0 + enter * 1.2, 1), kf(outStart, 1, 'easeIn'), kf(D, 0.9)]));
      tracks.push(track(layer.id, 'opacity', [kf(t0, 0, 'easeOut'), kf(t0 + 0.3, 1), kf(outStart, 1, 'easeIn'), kf(D, 0)]));
    }
  });

  if (group) {
    const s = 1 + 0.08 * p.amplitude;
    tracks.push(track(group.id, 'transform.scale', [kf(0, 1, 'linear'), kf(D, s)]));
    tracks.push(track(group.id, 'transform.x', [kf(0, 0.5, 'easeInOut'), kf(D, 0.5 - 0.015 * p.amplitude)]));
    tracks.push(track(group.id, 'opacity', [kf(0, 0, 'easeOut'), kf(0.5, 1), kf(D - 0.5, 1, 'easeIn'), kf(D, 0)]));
  }

  if (o.style === 'pop') {
    const parts = createLayer('particles', { name: 'Sparkle' });
    const c = o.brand.colors;
    parts.props = { ...parts.props, count: Math.round(2500 * p.amplitude), size: 2.6, colorA: c['color.accent'] ?? '#ffffff', colorB: c['color.paper'] ?? '#ffffff', velocity: 0.05 * p.speed, noise: 0.3, pointer: 'none', emitterSize: { x: 0.9, y: 0.9 } };
    layers.splice(1, 0, parts);
  }

  const headline = (o.headline ?? '').trim() || (o.style === 'headline' ? o.brand.voice[0] ? `${cap(o.brand.voice[0])}, by design.` : 'Your message here' : '');
  if (headline) {
    const t = createLayer('text', { name: 'Headline' });
    const textColor = pickTextColor(o.brand, doc.canvas.background);
    const preset = p.key === 'calm' ? 'fade' : p.key === 'energetic' ? 'word' : p.key === 'playful' ? 'scale' : 'stagger';
    t.props = { ...t.props, text: headline, fontFamily: o.brand.displayFont, weight: 650, size: o.style === 'headline' ? 0.095 : 0.062, color: textColor, maxWidth: 0.84,
      animation: { ...t.props.animation, preset, start: animated.length ? 0.3 + animated.length * gap : 0.3, duration: 1.1 / p.speed, easing: ease, exit: true } };
    // Put the message where the design is emptiest so it never sits on the design's own text.
    const textBox = { w: (0.84 * Math.min(W, H)) / W, h: Math.min(0.3, (t.props.size * 2.4 * Math.min(W, H)) / H) };
    const y = o.style === 'headline' ? 0.5 : parts.length ? freeSpot(parts, W, H, textBox, [{ x: 0.5, y: 0.86 }, { x: 0.5, y: 0.14 }, { x: 0.5, y: 0.5 }]).y : bgLayers.length ? 0.86 : 0.5;
    t.transform = { ...t.transform, y };
    if (o.style === 'headline') for (const l of layers) if (l.type === 'image') { l.transform = { ...l.transform, y: l.transform.y * 0.55 + 0.05, scale: 0.6 }; }
    layers.push(t);
    doc.exposed.push({ key: 'headline', label: 'Headline', description: 'Main message', type: 'text', targets: [{ layerId: t.id, path: 'props.text' }], default: headline, maxLength: 120, group: 'Content' });
  }

  if (o.showLogo && o.brand.logoAssetId) {
    const logo = createLayer('image', { name: 'Logo', transform: { x: 0.5, y: 0.08, rotation: 0, scale: 1 } });
    logo.props = { ...logo.props, assetId: o.brand.logoAssetId, fit: 'contain', mask: 'none', radius: 0, width: 0.24, height: 0.08, reveal: { preset: 'fade', start: 0.1, duration: 0.8 / p.speed, easing: 'easeOut' } };
    layers.push(logo);
  }

  // Keep the result valid if a large design pushes past schema limits.
  doc.layers = layers.slice(0, 200);
  doc.tracks = tracks.filter((t) => doc.layers.some((l) => l.id === t.layerId)).slice(0, 400);
  return doc;
}

function floatTracks(layer: Layer, i: number, D: number, amp: number, out: Track[], from: number) {
  const { x, y } = layer.transform;
  const phase = (i * 2.399) % (Math.PI * 2); // golden-angle offsets so parts never move in lockstep
  const a = 0.012 * amp, r = 1.2 * amp;
  const N = 16;
  const ys: Keyframe[] = [], xs: Keyframe[] = [], rs: Keyframe[] = [];
  for (let k = 0; k <= N; k++) {
    const t = from + ((D - from) * k) / N;
    const th = (2 * Math.PI * k) / N + phase;
    ys.push(kf(t, y + a * Math.sin(th), 'linear'));
    xs.push(kf(t, x + a * 0.5 * Math.cos(th), 'linear'));
    rs.push(kf(t, r * Math.sin(th + 1), 'linear'));
  }
  out.push(track(layer.id, 'transform.y', ys), track(layer.id, 'transform.x', xs), track(layer.id, 'transform.rotation', rs));
}

/** Of the candidate centres, the one whose box overlaps the design's parts least (first wins ties). */
export function freeSpot(parts: DesignLayer[], W: number, H: number, box: { w: number; h: number }, candidates: { x: number; y: number }[]) {
  const min = Math.min(W, H);
  const rects = parts.map((p) => ({ x0: p.x - (p.w * min) / W / 2, x1: p.x + (p.w * min) / W / 2, y0: p.y - (p.h * min) / H / 2, y1: p.y + (p.h * min) / H / 2 }));
  let best = candidates[0], bestA = Infinity;
  for (const c of candidates) {
    const r = { x0: c.x - box.w / 2, x1: c.x + box.w / 2, y0: c.y - box.h / 2, y1: c.y + box.h / 2 };
    const a = rects.reduce((sum, q) => sum + Math.max(0, Math.min(r.x1, q.x1) - Math.max(r.x0, q.x0)) * Math.max(0, Math.min(r.y1, q.y1) - Math.max(r.y0, q.y0)), 0);
    if (a < bestA - 1e-6) { bestA = a; best = c; }
  }
  return best;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function pickTextColor(brand: BrandKit, background: string) {
  const paper = brand.colors['color.paper'] ?? '#f5f5f2', night = brand.colors['color.night'] ?? '#05060a';
  // Over a gradient, judge against a mid-tone of the brand colours.
  const mid = mixHex(background, brand.colors['color.primary'] ?? background, 0.5);
  return Math.abs(luminance(paper) - luminance(mid)) >= Math.abs(luminance(night) - luminance(mid)) ? paper : night;
}

/** Choose a scene canvas with the design's aspect ratio, long side ≤ 1920, even dimensions. */
export function fitCanvas(w: number, h: number) {
  const s = Math.min(1, 1920 / Math.max(w, h));
  const even = (v: number) => Math.max(16, Math.round((v * s) / 2) * 2);
  return { width: even(w), height: even(h) };
}

/** What the simple Create flow saves alongside a motion so it can be reopened and restyled. */
const unit = z.number().refine(Number.isFinite).min(-4).max(5);
export const RecipeSchema = z.object({
  design: z.object({
    name: z.string().max(160),
    width: z.number().int().min(1).max(20000),
    height: z.number().int().min(1).max(20000),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
    layers: z.array(z.object({ assetId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_\-]+$/), name: z.string().max(160), x: unit, y: unit, w: z.number().min(0.0001).max(20), h: z.number().min(0.0001).max(20) })).max(40),
  }).nullable(),
  style: z.enum(['build', 'float', 'backdrop', 'pop', 'zoom', 'headline']),
  personality: z.enum(['calm', 'balanced', 'energetic', 'playful']),
  headline: z.string().max(200),
  showLogo: z.boolean(),
  keepBackground: z.boolean().nullable(),
  duration: z.number().min(2).max(30),
  format: z.string().max(40),
});
export type Recipe = z.infer<typeof RecipeSchema>;
