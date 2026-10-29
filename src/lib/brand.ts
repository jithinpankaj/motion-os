import { useEffect, useState } from 'react';
import { api } from './api';
import { useSession } from './session';

export type BrandTokenRow = { key: string; category: string; value: any; description: string };
const cache = new Map<string, Promise<BrandTokenRow[]>>();

export function useBrandTokens() {
  const brandId = useSession((s) => s.brandId);
  const [tokens, setTokens] = useState<BrandTokenRow[]>([]);
  useEffect(() => {
    if (!brandId) return;
    let p = cache.get(brandId);
    if (!p) { p = api(`/brands/${brandId}/tokens`).then((r) => r.tokens).catch(() => []); cache.set(brandId, p); }
    p.then(setTokens);
  }, [brandId]);
  return tokens;
}
export const invalidateBrand = () => cache.clear();
export const colorSwatches = (t: BrandTokenRow[]) => t.filter((x) => x.category === 'color').map((x) => ({ label: x.key.replace('color.', ''), value: x.value as string }));
export const gradientPresets = (t: BrandTokenRow[]) => t.filter((x) => x.category === 'gradient').map((x) => ({ key: x.key, label: x.key.replace('gradient.', ''), stops: x.value }));
