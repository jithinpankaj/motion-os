import { describe, it, expect } from 'vitest';
import { evaluateTrack, evaluateLayers, normaliseTime, frameCount } from '../../shared/timeline';
import { createScene, createLayer } from '../../shared/scene/defaults';
import { ease } from '../../shared/util/easing';
import { mulberry32 } from '../../shared/util/random';
import type { Track } from '../../shared/scene/schema';

const track = (keys: [number, number | string][], easing: any = 'linear'): Track => ({ id: 't', layerId: 'ly', path: 'opacity', keyframes: keys.map(([t, value], i) => ({ id: `k${i}`, t, value, easing })) });

describe('timeline evaluation', () => {
  it('interpolates numbers and clamps outside the key range', () => {
    const t = track([[1, 0], [3, 1]]);
    expect(evaluateTrack(t, 0)).toBe(0);
    expect(evaluateTrack(t, 2)).toBeCloseTo(0.5);
    expect(evaluateTrack(t, 9)).toBe(1);
  });
  it('is independent of evaluation order (no accumulated state)', () => {
    const t = track([[0, 0], [1, 10], [2, 0]], 'easeInOut');
    const forward = [0.1, 0.5, 1.3, 1.9].map((x) => evaluateTrack(t, x));
    const shuffled = [1.9, 0.1, 1.3, 0.5].map((x) => evaluateTrack(t, x));
    expect([shuffled[1], shuffled[3], shuffled[2], shuffled[0]]).toEqual(forward);
  });
  it('interpolates colours in OKLab', () => {
    const t = track([[0, '#000000'], [1, '#ffffff']]);
    const mid = evaluateTrack(t, 0.5) as string;
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(mid).not.toBe('#000000');
  });
  it('applies tracks with structural sharing and leaves the document untouched', () => {
    const a = createLayer('text', { id: 'ly' }), b = createLayer('gradient', { id: 'ly2' });
    const doc = createScene({ id: 'scn', layers: [a, b], tracks: [{ ...track([[0, 0], [2, 1]]) }] });
    const out = evaluateLayers(doc, 1);
    expect(out[0].opacity).toBeCloseTo(0.5);
    expect(out[1]).toBe(b);
    expect(doc.layers[0].opacity).toBe(1);
  });
  it('wraps time for loops and clamps otherwise', () => {
    const doc = createScene({ id: 'scn' });
    expect(normaliseTime(doc, 9)).toBeCloseTo(1);
    expect(normaliseTime({ ...doc, canvas: { ...doc.canvas, loop: false } }, 9)).toBe(8);
    expect(frameCount(doc)).toBe(240);
  });
  it('easings hit their endpoints', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut', 'expoOut', 'backOut', 'spring', [0.2, 0, 0, 1]] as any[]) {
      expect(ease(e, 0)).toBeCloseTo(0, 3);
      expect(ease(e, 1)).toBeCloseTo(1, 3);
    }
  });
  it('seeded random is deterministic', () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
