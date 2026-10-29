import { describe, it, expect } from 'vitest';
import { applyParameters, validateParamValue, defaultValues, paramIssues } from '../../shared/params';
import { resolveVariation, updateMaster, resetOverride, setOverride, upgradeValues } from '../../shared/inheritance';
import { auroraFlow, liquidMesh, GRADIENT_PRESETS } from '../../shared/scene/presets';
import { SYSTEM_ROLES, canTransition } from '../../shared/permissions';
import { analyzeCompatibility, EXPORT_FORMATS } from '../../shared/compat';
import { adaptScene } from '../../shared/adapt';
import { formatById } from '../../shared/formats';

describe('template parameters', () => {
  const doc = auroraFlow();
  it('presets have valid parameter definitions', () => { expect(paramIssues(doc)).toEqual([]); expect(paramIssues(liquidMesh())).toEqual([]); });
  it('applies valid values to every target', () => {
    const out = applyParameters(doc, { headline: 'Hello', intensity: 0.9, palette: GRADIENT_PRESETS[1].stops });
    expect(out.errors).toEqual([]);
    expect((out.scene.layers.find((l) => l.id === 'ly_aurora_head') as any).props.text).toBe('Hello');
    expect((out.scene.layers.find((l) => l.id === 'ly_aurora_bg') as any).props.noiseAmp).toBe(0.9);
  });
  it('rejects locked, out-of-range, unapproved and unknown values', () => {
    const out = applyParameters(doc, { headlineColor: '#ff0000', intensity: 5, headline: 'x'.repeat(40), palette: [{ color: '#123456', pos: 0 }, { color: '#654321', pos: 1 }], hack: 1 });
    const codes = Object.fromEntries(out.errors.map((e) => [e.key, e.code]));
    expect(codes).toEqual({ headlineColor: 'locked', intensity: 'invalid', headline: 'invalid', palette: 'invalid', hack: 'unknown' });
    expect(out.scene).toBe(doc);
  });
  it('enforces role restrictions unless explicitly bypassed by designers', () => {
    const restricted = { ...doc, exposed: doc.exposed.map((p) => (p.key === 'speed' ? { ...p, roles: ['designer'] } : p)) };
    expect(applyParameters(restricted, { speed: 2 }, { roles: ['marketing'] }).errors[0].code).toBe('forbidden');
    expect(applyParameters(restricted, { speed: 2 }, { roles: ['designer'] }).errors).toEqual([]);
  });
  it('validates colour options case-insensitively and strips control characters', () => {
    const p = liquidMesh().exposed.find((x) => x.key === 'colorA')!;
    expect(validateParamValue(p, '#3557FF').ok).toBe(true);
    const t = auroraFlow().exposed.find((x) => x.key === 'headline')!;
    expect(validateParamValue(t, 'a\u0000b')).toEqual({ ok: true, value: 'ab' });
  });
});

describe('campaign inheritance', () => {
  const params = auroraFlow().exposed;
  it('resolves default ← master ← override with sources', () => {
    const r = resolveVariation(params, { headline: 'Master' }, { eyebrow: 'Local' });
    expect(r.values.headline).toBe('Master');
    expect(r.sources).toMatchObject({ headline: 'master', eyebrow: 'override', intensity: 'default' });
  });
  it('master updates never overwrite local overrides', () => {
    const vars = [{ id: 'li', overrides: setOverride({}, 'headline', 'LinkedIn only') }, { id: 'ig', overrides: {} }];
    const { master, shadowedBy } = updateMaster({ headline: 'A' }, 'headline', 'B', vars);
    expect(shadowedBy).toEqual(['li']);
    expect(resolveVariation(params, master, vars[0].overrides).values.headline).toBe('LinkedIn only');
    expect(resolveVariation(params, master, vars[1].overrides).values.headline).toBe('B');
    expect(resolveVariation(params, master, resetOverride(vars[0].overrides, 'headline')).values.headline).toBe('B');
  });
  it('upgrades values to a new template version and reports what was dropped', () => {
    const next = params.filter((p) => p.key !== 'eyebrow').map((p) => (p.key === 'intensity' ? { ...p, max: 0.8 } : p));
    const r = upgradeValues(next, { eyebrow: 'x', intensity: 1.1, headline: 'ok' });
    expect(r.values).toEqual({ headline: 'ok' });
    expect(r.dropped.map((d) => d.key).sort()).toEqual(['eyebrow', 'intensity']);
  });
});

describe('permissions', () => {
  const perms = (k: string) => SYSTEM_ROLES.find((r) => r.key === k)!.permissions as string[];
  it('consumers cannot edit scenes or approve; viewers cannot export', () => {
    expect(perms('marketing')).not.toContain('scene.edit');
    expect(perms('marketing')).not.toContain('template.approve');
    expect(perms('viewer')).not.toContain('export.create');
    expect(perms('engineer')).toContain('template.code');
  });
  it('template status machine requires the right permission', () => {
    expect(canTransition('draft', 'published', perms('owner')).ok).toBe(false);
    expect(canTransition('review', 'approved', perms('designer')).ok).toBe(false);
    expect(canTransition('review', 'approved', perms('admin')).ok).toBe(true);
    expect(canTransition('approved', 'published', perms('designer')).ok).toBe(true);
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
  it('default values are valid', () => { expect(applyParameters(auroraFlow(), defaultValues(auroraFlow())).errors).toEqual([]); });
});
