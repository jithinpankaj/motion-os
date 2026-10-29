import { describe, it, expect } from 'vitest';
import { deserializeScene, serializeScene, migrateScene, SceneValidationError, validateScene } from '../../shared/scene/serialize';
import { createScene, createLayer } from '../../shared/scene/defaults';
import { LAUNCH_PRESETS } from '../../shared/scene/presets';
import { SCHEMA_VERSION } from '../../shared/scene/schema';
import { diffScenes } from '../../shared/diff';

describe('scene serialization', () => {
  it('round-trips every launch preset losslessly', () => {
    for (const p of LAUNCH_PRESETS) {
      const doc = p.build();
      const back = deserializeScene(serializeScene(doc));
      expect(back).toEqual(doc);
    }
  });

  it('serialises with stable key order', () => {
    const a = createScene({ id: 'scn_a' });
    const b = JSON.parse(JSON.stringify(a));
    expect(serializeScene(a)).toBe(serializeScene(b));
  });

  it('migrates v1 documents to the current schema', () => {
    const v1 = { version: 1, id: 'scn_old', seed: 4, meta: { name: 'Old', description: '', tags: [] }, canvas: { width: 800, height: 600, fps: 24, duration: 4, loop: true, bg: '#112233', camera: { fov: 35, distance: 6, yaw: 0, pitch: 0 } },
      layers: [{ id: 'ly_1', name: 'Bg', type: 'gradient', hidden: true, props: createLayer('gradient').props }], tracks: [] };
    const doc = deserializeScene(v1);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.canvas.background).toBe('#112233');
    expect(doc.layers[0].visible).toBe(false);
    expect(doc.fallback.reducedMotion).toBe('static');
  });

  it('rejects untrusted input: bad json, newer schema, out-of-range values, duplicate ids, dangling refs', () => {
    expect(() => deserializeScene('{nope')).toThrow(SceneValidationError);
    expect(() => migrateScene({ schemaVersion: 99 })).toThrow(/newer/);
    const doc = createScene({ id: 'scn_x', layers: [createLayer('gradient', { id: 'ly_a' })] });
    expect(validateScene({ ...doc, canvas: { ...doc.canvas, width: 99999 } }).ok).toBe(false);
    expect(validateScene({ ...doc, layers: [doc.layers[0], doc.layers[0]] }).ok).toBe(false);
    expect(validateScene({ ...doc, tracks: [{ id: 't', layerId: 'ly_missing', path: 'opacity', keyframes: [] }] }).ok).toBe(false);
    expect(validateScene({ ...doc, canvas: { ...doc.canvas, background: 'red' } }).ok).toBe(false);
    expect(validateScene({ ...doc, layers: [{ ...doc.layers[0], props: { ...(doc.layers[0] as any).props, noiseAmp: Infinity } }] }).ok).toBe(false);
  });

  it('rejects group cycles', () => {
    const g1 = createLayer('group', { id: 'g1', parentId: 'g2' }), g2 = createLayer('group', { id: 'g2', parentId: 'g1' });
    expect(validateScene(createScene({ id: 'scn_c', layers: [g1, g2] })).ok).toBe(false);
  });

  it('diffs versions at layer granularity', () => {
    const a = LAUNCH_PRESETS[0].build('scn_d');
    const b = { ...a, layers: a.layers.map((l, i) => (i === 1 ? { ...l, name: 'Renamed' } : l)) };
    const changes = diffScenes(a, b);
    expect(changes.some((c) => c.path === 'name' && c.to === 'Renamed')).toBe(true);
  });
});
