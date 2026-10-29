import type { AssetResolver, ResolvedAsset } from '../engine/assets';
import { api } from './api';

/** Images in community posts live in community storage; resolve them per post (fetched once). */
const cache = new Map<string, Promise<Record<string, ResolvedAsset>>>();
export function communityResolver(postId: string): AssetResolver {
  return {
    resolve(id) {
      let p = cache.get(postId);
      if (!p) { p = api(`/community/${postId}`, { noWorkspace: true }).then((r) => r.assets).catch(() => ({})); cache.set(postId, p); }
      return p.then((m) => m[id] ?? { missing: true as const });
    },
  };
}
export const seedCommunityAssets = (postId: string, assets: Record<string, ResolvedAsset>) => cache.set(postId, Promise.resolve(assets));
