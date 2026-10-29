import { useEffect, useMemo, useState } from 'react';
import { kitFromTokens } from '../../shared/brandImport';
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

/** The simple brand kit (colours by role, fonts, logo, personality, voice) plus raw tokens for saving. */
export function useBrandKit() {
  const brandId = useSession((s) => s.brandId);
  const [state, setState] = useState<{ tokens: BrandTokenRow[]; version: number; loaded: boolean }>({ tokens: [], version: 0, loaded: false });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!brandId) return;
    let live = true;
    api(`/brands/${brandId}/tokens`).then((r) => live && setState({ tokens: r.tokens, version: r.brand.version, loaded: true })).catch(() => live && setState((s) => ({ ...s, loaded: true })));
    return () => { live = false; };
  }, [brandId, n]);
  const kit = useMemo(() => kitFromTokens(state.tokens), [state.tokens]);
  return { ...state, kit, brandId, reload: () => { cache.clear(); setN((x) => x + 1); } };
}
