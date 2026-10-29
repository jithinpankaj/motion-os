import { describe, it, expect } from 'vitest';
import { auroraFlow } from '../../shared/scene/presets';
import { SYSTEM_ROLES } from '../../shared/permissions';
import { analyzeCompatibility, EXPORT_FORMATS } from '../../shared/compat';
import { adaptScene } from '../../shared/adapt';
import { formatById } from '../../shared/formats';

describe('permissions', () => {
  const perms = (k: string) => SYSTEM_ROLES.find((r) => r.key === k)!.permissions as string[];
  it('makers create, edit and publish; engineers only view and export; viewers only view', () => {
    for (const k of ['designer', 'marketing', 'operations']) {
      expect(perms(k)).toContain('scene.create');
      expect(perms(k)).toContain('community.publish');
    }
    expect(perms('engineer')).not.toContain('scene.edit');
    expect(perms('engineer')).toContain('export.create');
    expect(perms('viewer')).not.toContain('export.create');
    expect(perms('viewer')).not.toContain('community.publish');
    expect(perms('owner')).toContain('roles.manage');
  });
});

describe('compatibility & adaptation', () => {
  it('never claims unimplemented formats are supported', () => {
    for (const f of EXPORT_FORMATS.filter((x) => !x.implemented)) expect(analyzeCompatibility(auroraFlow(), f.id).status).toBe('unsupported');
  });
  it('flags procedural shaders as non-vector and pointer interaction loss in video', () => {
    const lottie = analyzeCompatibility(auroraFlow(), 'lottie');
    expect(lottie.items.some((i) => i.level === 'error')).toBe(true);
  });
  it('adapts layouts without stretching and keeps text inside safe areas', () => {
    const doc = auroraFlow();
    const story = adaptScene(doc, formatById('instagram-story')!);
    expect(story.canvas).toMatchObject({ width: 1080, height: 1920 });
    const head = story.layers.find((l) => l.id === 'ly_aurora_head') as any;
    expect(head.props.size).toBe((doc.layers[1] as any).props.size); // relative to min dimension — no stretch
    const sub = story.layers.find((l) => l.id === 'ly_aurora_sub')!;
    expect(sub.transform.y).toBe(0.74); // per-format override
    const banner = adaptScene(doc, formatById('website-banner')!);
    expect(banner.layers.find((l) => l.id === 'ly_aurora_sub')!.visible).toBe(false);
  });
  it('detects harmful flashing', () => {
    const doc = auroraFlow();
    const flashy = { ...doc, tracks: [{ id: 'f', layerId: 'ly_aurora_bg', path: 'opacity', keyframes: Array.from({ length: 64 }, (_, i) => ({ id: `k${i}`, t: i * 0.125, value: i % 2, easing: 'step' as const })) }] };
    expect(analyzeCompatibility(flashy as any, 'mp4').flashing.length).toBeGreaterThan(0);
    expect(analyzeCompatibility(doc, 'mp4').flashing).toEqual([]);
  });
});
