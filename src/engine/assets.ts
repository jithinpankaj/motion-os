export type ResolvedAsset = { url: string; width?: number; height?: number; mime?: string; version?: number; name?: string } | { missing: true };

/** Maps asset ids in a scene to fetchable URLs. Implementations honour version pins. */
export interface AssetResolver {
  resolve(id: string): Promise<ResolvedAsset>;
}

export const nullResolver: AssetResolver = { resolve: async () => ({ missing: true }) };

/** Resolver from a pre-resolved map (used by the export worker and embeds). */
export const mapResolver = (map: Record<string, ResolvedAsset>): AssetResolver => ({ resolve: async (id) => map[id] ?? { missing: true } });
