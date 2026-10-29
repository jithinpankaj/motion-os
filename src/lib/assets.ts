import type { AssetResolver, ResolvedAsset } from '../engine/assets';
import { api } from './api';

type Ctx = { type: 'scene' | 'template_version' | 'campaign' | 'export'; id: string } | undefined;
const resolvers = new Map<string, AssetResolver>();

/** Batched, cached resolver against /api/assets/resolve honouring the context's version pins. */
export function apiResolver(context?: Ctx): AssetResolver {
  const key = context ? `${context.type}:${context.id}` : 'current';
  const hit = resolvers.get(key);
  if (hit) return hit;
  const cache = new Map<string, Promise<ResolvedAsset>>();
  let pending: { id: string; resolve: (a: ResolvedAsset) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    const batch = pending;
    pending = [];
    timer = null;
    try {
      const res = await api<{ assets: Record<string, ResolvedAsset> }>('/assets/resolve', { body: { ids: [...new Set(batch.map((b) => b.id))], context } });
      batch.forEach((b) => b.resolve(res.assets[b.id] ?? { missing: true }));
    } catch {
      batch.forEach((b) => { cache.delete(b.id); b.resolve({ missing: true }); });
    }
  };
  const r: AssetResolver = {
    resolve(id) {
      let p = cache.get(id);
      if (!p) {
        p = new Promise((resolve) => { pending.push({ id, resolve }); timer ??= setTimeout(flush, 10); });
        cache.set(id, p);
      }
      return p;
    },
  };
  resolvers.set(key, r);
  return r;
}

/** Call after uploading/replacing assets so new versions are picked up. */
export const invalidateAssets = () => resolvers.clear();
