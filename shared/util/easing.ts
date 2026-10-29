import type { Easing } from '../scene/schema';

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      const d = dx(t);
      if (Math.abs(e) < 1e-6) break;
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    if (t < 0 || t > 1 || Math.abs(sx(t) - x) > 1e-4) {
      let lo = 0, hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        if (sx(t) < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sy(t);
  };
}

const named: Record<string, (t: number) => number> = {
  linear: (t) => t,
  easeIn: cubicBezier(0.42, 0, 1, 1),
  easeOut: cubicBezier(0, 0, 0.58, 1),
  easeInOut: cubicBezier(0.42, 0, 0.58, 1),
  expoOut: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  backOut: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  // Analytic critically-under-damped spring normalised to settle at t = 1.
  spring: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(10 * t)),
  step: (t) => (t >= 1 ? 1 : 0),
};

const cache = new Map<string, (t: number) => number>();

export function easingFn(e: Easing): (t: number) => number {
  if (typeof e === 'string') return named[e] ?? named.linear;
  const k = e.join(',');
  let f = cache.get(k);
  if (!f) cache.set(k, (f = cubicBezier(e[0], e[1], e[2], e[3])));
  return f;
}

export const ease = (e: Easing, t: number) => easingFn(e)(Math.min(1, Math.max(0, t)));

/** Representative bezier for UI curve display. */
export function easingBezier(e: Easing): [number, number, number, number] | null {
  if (Array.isArray(e)) return e as any;
  return ({ linear: [0, 0, 1, 1], easeIn: [0.42, 0, 1, 1], easeOut: [0, 0, 0.58, 1], easeInOut: [0.42, 0, 0.58, 1] } as any)[e] ?? null;
}
