import { describe, expect, it } from 'vitest';
import { createLayer, createScene, defaultDrawing } from '../../shared/scene/defaults';
import { deserializeScene, serializeScene } from '../../shared/scene/serialize';
import { buildMove } from '../../shared/motion/moves';
import { strokeLength, strokesBounds } from '../../src/engine/strokes';
import type { Stroke } from '../../shared/scene/schema';

const stroke = (brush: Stroke['brush'], pts: [number, number][]): Stroke => ({ brush, color: '#1d1d1f', size: 10, points: pts.flatMap(([x, y]) => [x, y, 0.5]) });

describe('freehand drawing', () => {
  it('a drawing layer with every stroke style saves and loads', () => {
    const d = createScene();
    const l = createLayer('drawing', { name: 'Doodle', props: { ...defaultDrawing(), width: 400, height: 300, strokes: (['pen', 'pencil', 'brush', 'marker', 'highlighter'] as const).map((b, i) => stroke(b, [[10, 10 + i * 20], [200, 40 + i * 20]])) } } as any);
    d.layers = [l];
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(d))));
    expect(back.layers[0].type).toBe('drawing');
    expect((back.layers[0] as any).props.strokes).toHaveLength(5);
  });
  it('rejects points that are not x, y, pressure triplets', () => {
    const d = createScene();
    const l = createLayer('drawing', { props: { ...defaultDrawing(), strokes: [{ brush: 'pen', color: '#000000', size: 4, points: [1, 2, 0.5, 3] }] } } as any);
    d.layers = [l];
    expect(() => deserializeScene(d)).toThrow();
  });
  it('measures strokes and their box including stroke width', () => {
    const s = stroke('marker', [[0, 0], [30, 40], [30, 100]]);
    expect(strokeLength(s)).toBeCloseTo(110);
    const b = strokesBounds([s])!;
    expect(b.x).toBeLessThan(0);
    expect(b.w).toBeGreaterThan(30);
    expect(strokesBounds([])).toBeNull();
  });
  it('“Draw on” animates how much of the drawing is drawn, from nothing to all of it', () => {
    const d = createScene();
    const l = createLayer('drawing', { props: { ...defaultDrawing(), strokes: [stroke('pen', [[0, 0], [50, 50]])] } } as any);
    d.layers = [l];
    const m = buildMove('drawOn', l, d);
    expect(m.tracks[0].path).toBe('props.reveal');
    expect(m.tracks[0].keyframes.map((k) => k.value)).toEqual([0, 1]);
  });
});
