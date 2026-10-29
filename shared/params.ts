import type { ExposedParam, SceneDocument, Target } from './scene/schema';
import { deepEqual, getIn, setIn } from './util/paths';
import { isHex } from './util/color';

export type ParamValues = Record<string, unknown>;
export type ParamErrorCode = 'unknown' | 'locked' | 'forbidden' | 'invalid' | 'required';
export type ParamError = { key: string; code: ParamErrorCode; message: string };

const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

export function validateParamValue(p: ExposedParam, v: unknown): { ok: true; value: unknown } | { ok: false; code: ParamErrorCode; message: string } {
  const bad = (message: string) => ({ ok: false as const, code: 'invalid' as const, message });
  const inOptions = (val: unknown) => !p.options?.length || p.options.some((o) => deepEqual(norm(o.value), norm(val)));
  const norm = (x: unknown) => (typeof x === 'string' && isHex(x) ? x.toLowerCase() : x);
  switch (p.type) {
    case 'text': {
      if (typeof v !== 'string') return bad('must be text');
      const value = v.replace(CONTROL, '');
      if (p.required && !value.trim()) return { ok: false, code: 'required', message: `${p.label} is required` };
      const max = p.maxLength ?? 2000;
      if ([...value].length > max) return bad(`${p.label} must be ${max} characters or fewer (currently ${[...value].length})`);
      return { ok: true, value };
    }
    case 'number':
    case 'scale': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return bad('must be a number');
      if (p.min !== undefined && v < p.min) return bad(`${p.label} must be at least ${p.min}`);
      if (p.max !== undefined && v > p.max) return bad(`${p.label} must be at most ${p.max}`);
      return { ok: true, value: v };
    }
    case 'boolean':
      return typeof v === 'boolean' ? { ok: true, value: v } : bad('must be true or false');
    case 'color':
      if (!isHex(v)) return bad('must be a #rrggbb colour');
      if (!inOptions(v)) return bad(`${v} is not one of the approved colours`);
      return { ok: true, value: v.toLowerCase() };
    case 'gradientPreset':
      if (!Array.isArray(v) || !v.every((s: any) => isHex(s?.color) && typeof s?.pos === 'number')) return bad('must be a gradient preset');
      if (!inOptions(v)) return bad('gradient is not an approved preset');
      return { ok: true, value: v };
    case 'select':
      return inOptions(v) && v !== undefined ? { ok: true, value: v } : bad('is not an allowed option');
    case 'multiSelect':
      if (!Array.isArray(v) || !v.every((x) => inOptions(x))) return bad('contains options that are not allowed');
      return { ok: true, value: v };
    case 'image':
      if (v !== null && (typeof v !== 'string' || !/^[A-Za-z0-9_\-]{1,64}$/.test(v))) return bad('must be an asset id');
      if (v === null && p.required) return { ok: false, code: 'required', message: `${p.label} is required` };
      if (v !== null && !inOptions(v)) return bad('image is not in the approved set');
      return { ok: true, value: v };
    case 'position': {
      const o = v as any;
      if (!o || typeof o.x !== 'number' || typeof o.y !== 'number') return bad('must be a position');
      const min = p.min ?? 0, max = p.max ?? 1;
      if ([o.x, o.y].some((n) => !Number.isFinite(n) || n < min || n > max)) return bad(`position must stay within ${min}–${max}`);
      return { ok: true, value: { x: o.x, y: o.y } };
    }
  }
}

export function defaultValues(scene: SceneDocument): ParamValues {
  return Object.fromEntries(scene.exposed.map((p) => [p.key, p.default]));
}

export function applyToTarget(scene: SceneDocument, t: Target, value: unknown): SceneDocument {
  const i = scene.layers.findIndex((l) => l.id === t.layerId);
  if (i < 0) return scene;
  const layers = scene.layers.slice();
  layers[i] = setIn(layers[i], t.path, value);
  return { ...scene, layers };
}

export function readTarget(scene: SceneDocument, t: Target): unknown {
  return getIn(scene.layers.find((l) => l.id === t.layerId), t.path);
}

export type ApplyOptions = { roles?: string[]; /** designers bypass locks inside the studio */ ignoreLocks?: boolean };

/**
 * Apply consumer parameter values to a template scene. Used identically on the client (live preview)
 * and on the server (authoritative: saves, exports, publication). Values that fail are not applied.
 */
export function applyParameters(scene: SceneDocument, values: ParamValues, opts: ApplyOptions = {}) {
  const errors: ParamError[] = [];
  const applied: ParamValues = {};
  let out = scene;
  for (const [key, raw] of Object.entries(values)) {
    const p = scene.exposed.find((x) => x.key === key);
    if (!p) { errors.push({ key, code: 'unknown', message: `Unknown parameter "${key}"` }); continue; }
    const isDefault = deepEqual(raw, p.default);
    if (!isDefault && p.locked && !opts.ignoreLocks) { errors.push({ key, code: 'locked', message: p.lockReason || `${p.label} is locked by the brand system` }); continue; }
    if (!isDefault && p.roles?.length && !opts.ignoreLocks && !(opts.roles ?? []).some((r) => p.roles!.includes(r))) {
      errors.push({ key, code: 'forbidden', message: `${p.label} can only be changed by: ${p.roles.join(', ')}` });
      continue;
    }
    const r = validateParamValue(p, raw);
    if (!r.ok) { errors.push({ key, code: r.code, message: r.message }); continue; }
    applied[key] = r.value;
    for (const t of p.targets) out = applyToTarget(out, t, r.value);
  }
  return { scene: out, errors, applied };
}

export function paramIssues(scene: SceneDocument): string[] {
  const out: string[] = [];
  for (const p of scene.exposed) {
    if (!p.targets.length) out.push(`${p.label}: no targets`);
    const r = validateParamValue(p, p.default);
    if (!r.ok) out.push(`${p.label}: default ${r.message}`);
    if ((p.type === 'number' || p.type === 'scale') && p.min !== undefined && p.max !== undefined && p.min > p.max) out.push(`${p.label}: min > max`);
  }
  return out;
}
