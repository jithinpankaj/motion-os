import type { ExposedParam } from './scene/schema';
import type { ParamValues } from './params';
import { validateParamValue } from './params';
import { deepEqual } from './util/paths';

export type ValueSource = 'default' | 'master' | 'override';

/**
 * Campaign inheritance: defaults ← master ← variation overrides.
 * Shared properties live on the master; local overrides live on the variation and always win.
 */
export function resolveVariation(params: ExposedParam[], master: ParamValues, overrides: ParamValues) {
  const values: ParamValues = {};
  const sources: Record<string, ValueSource> = {};
  for (const p of params) {
    if (p.key in overrides) { values[p.key] = overrides[p.key]; sources[p.key] = 'override'; }
    else if (p.key in master) { values[p.key] = master[p.key]; sources[p.key] = 'master'; }
    else { values[p.key] = p.default; sources[p.key] = 'default'; }
  }
  return { values, sources };
}

export const setOverride = (o: ParamValues, key: string, value: unknown): ParamValues => ({ ...o, [key]: value });
export function resetOverride(o: ParamValues, key: string): ParamValues {
  const { [key]: _drop, ...rest } = o;
  return rest;
}

/** Updating the master never touches overrides; returns which variations keep a local value. */
export function updateMaster(master: ParamValues, key: string, value: unknown, variations: { id: string; overrides: ParamValues }[]) {
  return {
    master: { ...master, [key]: value },
    shadowedBy: variations.filter((v) => key in v.overrides).map((v) => v.id),
  };
}

export function changedKeys(a: ParamValues, b: ParamValues): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !deepEqual(a[k], b[k]));
}

/** Carry values to a newer template version: keep valid ones, report the rest. */
export function upgradeValues(next: ExposedParam[], values: ParamValues) {
  const kept: ParamValues = {};
  const dropped: { key: string; reason: string }[] = [];
  for (const [k, v] of Object.entries(values)) {
    const p = next.find((x) => x.key === k);
    if (!p) { dropped.push({ key: k, reason: 'parameter removed in new version' }); continue; }
    const r = validateParamValue(p, v);
    if (!r.ok) { dropped.push({ key: k, reason: r.message }); continue; }
    if (p.locked && !deepEqual(v, p.default)) { dropped.push({ key: k, reason: 'parameter is now locked' }); continue; }
    kept[k] = r.value;
  }
  return { values: kept, dropped };
}
