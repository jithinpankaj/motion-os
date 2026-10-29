import type { Animation, Easing, Keyframe, Layer, SceneDocument, Track } from '../scene/schema';
import { uid } from '../util/random';

/**
 * One-click moves: friendly presets that write ordinary keyframes for a layer, starting from how
 * the layer looks right now. Everything they create stays editable on the timeline.
 */
export type MoveKey = 'fadeIn' | 'fadeOut' | 'pop' | 'popOut' | 'slideIn' | 'slideUp' | 'spin' | 'bounce' | 'pulse' | 'wiggle' | 'shake' | 'float' | 'grow' | 'squash' | 'colorTo' | 'flip';
export type MoveDef = { key: MoveKey; name: string; hint: string; icon: string; loop: Animation['loop']; duration: number; needsColor?: boolean };

export const MOVES: MoveDef[] = [
  { key: 'fadeIn', name: 'Fade in', hint: 'Appears gently', icon: 'eye', loop: 'once', duration: 0.6 },
  { key: 'fadeOut', name: 'Fade out', hint: 'Disappears gently', icon: 'eyeOff', loop: 'once', duration: 0.6 },
  { key: 'pop', name: 'Pop in', hint: 'Grows in with a little bounce', icon: 'sparkles', loop: 'once', duration: 0.5 },
  { key: 'popOut', name: 'Pop out', hint: 'Shrinks away', icon: 'minus', loop: 'once', duration: 0.35 },
  { key: 'slideIn', name: 'Slide in', hint: 'Comes in from the left', icon: 'chevronRight', loop: 'once', duration: 0.7 },
  { key: 'slideUp', name: 'Rise up', hint: 'Comes up from below', icon: 'chevronDown', loop: 'once', duration: 0.7 },
  { key: 'spin', name: 'Spin', hint: 'One full turn', icon: 'refresh', loop: 'loop', duration: 1.2 },
  { key: 'bounce', name: 'Bounce', hint: 'Hops up and lands', icon: 'chevronDown', loop: 'loop', duration: 0.9 },
  { key: 'pulse', name: 'Pulse', hint: 'Breathes bigger and smaller', icon: 'gauge', loop: 'loop', duration: 1.2 },
  { key: 'wiggle', name: 'Wiggle', hint: 'Tilts side to side', icon: 'move', loop: 'once', duration: 0.6 },
  { key: 'shake', name: 'Shake', hint: 'Says “no” quickly', icon: 'move', loop: 'once', duration: 0.45 },
  { key: 'float', name: 'Float', hint: 'Drifts up and down softly', icon: 'orbit', loop: 'pingpong', duration: 1.6 },
  { key: 'grow', name: 'Grow wider', hint: 'Stretches out (great for bars)', icon: 'maximize', loop: 'once', duration: 0.8 },
  { key: 'squash', name: 'Squash', hint: 'Squishes on impact', icon: 'minus', loop: 'once', duration: 0.4 },
  { key: 'colorTo', name: 'Change colour', hint: 'Blends to another colour', icon: 'brand', loop: 'once', duration: 0.5, needsColor: true },
  { key: 'flip', name: 'Flip', hint: 'Turns over', icon: 'refresh', loop: 'once', duration: 0.6 },
];

const kf = (t: number, value: number | string, easing: Easing = 'easeInOut'): Keyframe => ({ id: uid('kf'), t: +t.toFixed(3), value: typeof value === 'number' ? +value.toFixed(4) : value, easing });
const track = (layerId: string, path: string, keys: Keyframe[]): Track => ({ id: uid('tr'), layerId, path, keyframes: keys });

/** Which colour property a layer animates with "Change colour". */
export function colorPath(l: Layer): string | null {
  if (l.type === 'shape') return 'props.fill.color';
  if (l.type === 'text') return 'props.color';
  if (l.type === 'particles') return 'props.colorA';
  return null;
}

export function buildMove(key: MoveKey, layer: Layer, doc: SceneDocument, opts: { color?: string; speed?: number } = {}): { tracks: Track[]; duration: number; loop: Animation['loop'] } {
  const def = MOVES.find((m) => m.key === key)!;
  const d = def.duration / (opts.speed ?? 1);
  const { x, y, scale, rotation } = layer.transform;
  const id = layer.id;
  const W = doc.canvas.width, H = doc.canvas.height;
  const t: Track[] = [];
  switch (key) {
    case 'fadeIn': t.push(track(id, 'opacity', [kf(0, 0, 'easeOut'), kf(d, layer.opacity || 1)])); break;
    case 'fadeOut': t.push(track(id, 'opacity', [kf(0, layer.opacity, 'easeIn'), kf(d, 0)])); break;
    case 'pop': t.push(track(id, 'transform.scale', [kf(0, scale * 0.01, 'backOut'), kf(d, scale)]), track(id, 'opacity', [kf(0, 0, 'easeOut'), kf(d * 0.4, layer.opacity || 1)])); break;
    case 'popOut': t.push(track(id, 'transform.scale', [kf(0, scale, 'easeIn'), kf(d, scale * 0.01)]), track(id, 'opacity', [kf(d * 0.6, layer.opacity, 'linear'), kf(d, 0)])); break;
    case 'slideIn': t.push(track(id, 'transform.x', [kf(0, x - 240 / W, 'expoOut'), kf(d, x)]), track(id, 'opacity', [kf(0, 0, 'easeOut'), kf(d * 0.5, layer.opacity || 1)])); break;
    case 'slideUp': t.push(track(id, 'transform.y', [kf(0, y + 160 / H, 'expoOut'), kf(d, y)]), track(id, 'opacity', [kf(0, 0, 'easeOut'), kf(d * 0.5, layer.opacity || 1)])); break;
    case 'spin': t.push(track(id, 'transform.rotation', [kf(0, rotation, 'linear'), kf(d, rotation + 360)])); break;
    case 'bounce': {
      const up = y - 90 / H;
      t.push(track(id, 'transform.y', [kf(0, y, 'easeOut'), kf(d * 0.45, up, 'easeIn'), kf(d * 0.9, y, 'linear'), kf(d, y)]));
      break;
    }
    case 'pulse': t.push(track(id, 'transform.scale', [kf(0, scale), kf(d / 2, scale * 1.1), kf(d, scale)])); break;
    case 'wiggle': t.push(track(id, 'transform.rotation', [kf(0, rotation), kf(d * 0.2, rotation - 12), kf(d * 0.45, rotation + 10), kf(d * 0.7, rotation - 6), kf(d, rotation)])); break;
    case 'shake': t.push(track(id, 'transform.x', [0, -1, 1, -0.7, 0.7, -0.3, 0].map((k, i, a) => kf((d * i) / (a.length - 1), x + (k * 18) / W, 'easeInOut')))); break;
    case 'float': t.push(track(id, 'transform.y', [kf(0, y), kf(d, y - 24 / H)])); break;
    case 'grow':
      if (layer.type === 'shape') t.push(track(id, 'props.width', [kf(0, 1, 'expoOut'), kf(d, layer.props.width)]));
      else t.push(track(id, 'transform.scale', [kf(0, scale * 0.01, 'expoOut'), kf(d, scale)]));
      break;
    case 'squash':
      if (layer.type === 'shape') {
        const { width: w, height: h } = layer.props;
        t.push(track(id, 'props.width', [kf(0, w), kf(d * 0.4, w * 1.25, 'backOut'), kf(d, w)]), track(id, 'props.height', [kf(0, h), kf(d * 0.4, h * 0.75, 'backOut'), kf(d, h)]));
      } else {
        const { scaleX: sx, scaleY: sy } = layer.transform;
        t.push(track(id, 'transform.scaleX', [kf(0, sx), kf(d * 0.4, sx * 1.2, 'backOut'), kf(d, sx)]), track(id, 'transform.scaleY', [kf(0, sy), kf(d * 0.4, sy * 0.8, 'backOut'), kf(d, sy)]));
      }
      break;
    case 'colorTo': {
      const path = colorPath(layer);
      if (path) {
        const from = path.split('.').reduce((o: any, k) => o?.[k], layer) as string;
        t.push(track(id, path, [kf(0, from), kf(d, opts.color ?? '#ff5a36')]));
      }
      break;
    }
    case 'flip': t.push(track(id, 'transform.rotation', [kf(0, rotation, 'backOut'), kf(d, rotation + 180)])); break;
  }
  return { tracks: t, duration: +d.toFixed(3), loop: def.loop };
}

/** Add a move's keyframes into an animation, shifting it to start at `at` seconds and growing the length to fit. */
export function mergeIntoAnimation(anim: Animation, move: { tracks: Track[]; duration: number }, at = 0): Animation {
  const shifted = move.tracks.map((tr) => ({ ...tr, keyframes: tr.keyframes.map((k) => ({ ...k, t: +(k.t + at).toFixed(3) })) }));
  const tracks = [...anim.tracks];
  for (const tr of shifted) {
    const same = tracks.findIndex((x) => x.layerId === tr.layerId && x.path === tr.path);
    if (same >= 0) {
      // Replace keys inside the new move's time range, keep the rest.
      const lo = tr.keyframes[0].t, hi = tr.keyframes[tr.keyframes.length - 1].t;
      tracks[same] = { ...tracks[same], keyframes: [...tracks[same].keyframes.filter((k) => k.t < lo - 1e-6 || k.t > hi + 1e-6), ...tr.keyframes].sort((a, b) => a.t - b.t) };
    } else tracks.push(tr);
  }
  return { ...anim, tracks, duration: Math.max(anim.duration, +(at + move.duration).toFixed(3)) };
}
