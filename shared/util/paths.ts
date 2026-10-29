/** Dot-path helpers with structural sharing (only objects along the path are copied). */
export function getIn(obj: any, path: string): any {
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

export function setIn<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const rec = (node: any, i: number): any => {
    const k = keys[i];
    const isIndex = /^\d+$/.test(k);
    const copy = Array.isArray(node) ? node.slice() : { ...(node ?? (isIndex ? [] : {})) };
    copy[k] = i === keys.length - 1 ? value : rec(node?.[k], i + 1);
    return copy;
  };
  return rec(obj, 0);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}

export const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
