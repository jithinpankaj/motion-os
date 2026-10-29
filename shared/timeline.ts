import type { Keyframe, Layer, SceneDocument, Track } from './scene/schema';
import { ease } from './util/easing';
import { isHex, mixHex } from './util/color';
import { getIn, setIn } from './util/paths';

/** Wrap or clamp a time value into the scene's range. */
export function normaliseTime(doc: SceneDocument, t: number): number {
  const d = doc.canvas.duration;
  if (doc.canvas.loop) return ((t % d) + d) % d;
  return Math.min(Math.max(t, 0), d);
}

export function sortedKeyframes(track: Track): Keyframe[] {
  return track.keyframes.slice().sort((a, b) => a.t - b.t);
}

/** Evaluate a single track at time t. Pure function of (track, t). */
export function evaluateTrack(track: Track, t: number): number | string | undefined {
  const ks = sortedKeyframes(track);
  if (!ks.length) return undefined;
  if (t <= ks[0].t) return ks[0].value;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last.value;
  let i = 0;
  while (i < ks.length - 1 && ks[i + 1].t < t) i++;
  const a = ks[i], b = ks[i + 1];
  const span = b.t - a.t;
  // Easing on a keyframe describes the segment leaving it.
  const p = span <= 0 ? 1 : ease(a.easing, (t - a.t) / span);
  if (typeof a.value === 'number' && typeof b.value === 'number') return a.value + (b.value - a.value) * p;
  if (isHex(a.value) && isHex(b.value)) return mixHex(a.value, b.value, p);
  return p < 1 ? a.value : b.value;
}

/**
 * Resolve every animated property at time t. Layers without tracks are returned by reference,
 * animated layers are shallow-copied along the animated paths only (structural sharing).
 */
export function evaluateLayers(doc: SceneDocument, time: number): Layer[] {
  const t = normaliseTime(doc, time);
  if (!doc.tracks.length) return doc.layers;
  const byLayer = new Map<string, Track[]>();
  for (const tr of doc.tracks) {
    if (!tr.keyframes.length) continue;
    const arr = byLayer.get(tr.layerId);
    arr ? arr.push(tr) : byLayer.set(tr.layerId, [tr]);
  }
  return doc.layers.map((layer) => {
    const tracks = byLayer.get(layer.id);
    if (!tracks) return layer;
    let out: Layer = layer;
    for (const tr of tracks) {
      const v = evaluateTrack(tr, t);
      if (v === undefined) continue;
      const current = getIn(out, tr.path);
      if (current === undefined || typeof current !== typeof v) continue; // ignore invalid paths
      out = setIn(out, tr.path, v);
    }
    return out;
  });
}

/** Seconds per frame and frame index helpers for frame stepping & exports. */
export const frameTime = (doc: SceneDocument, frame: number) => frame / doc.canvas.fps;
export const frameAt = (doc: SceneDocument, t: number) => Math.round(t * doc.canvas.fps);
export const frameCount = (doc: SceneDocument) => Math.max(1, Math.round(doc.canvas.duration * doc.canvas.fps));

/** Integer loop cycles so procedural motion closes seamlessly at the loop point. */
export const loopCycles = (speed: number) => Math.max(1, Math.round(speed));
