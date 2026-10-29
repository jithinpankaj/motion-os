import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Interface theme: Light, Dark or follow the system. Only the app's chrome changes — the
 * `data-theme` attribute drives the semantic tokens in theme.css; artwork renders its own colours.
 * index.html applies the same choice before first paint, so there is no flash on load.
 */
export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'mos.theme';
const media = () => (typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null);
const read = (): ThemePref => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; } };
const resolve = (p: ThemePref): 'light' | 'dark' => (p === 'system' ? (media()?.matches ? 'dark' : 'light') : p);

let fade: ReturnType<typeof setTimeout> | undefined;
function apply(theme: 'light' | 'dark', animate: boolean) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-switching');
    clearTimeout(fade);
    fade = setTimeout(() => root.classList.remove('theme-switching'), 320);
  }
  root.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
}

export const useTheme = create<{ pref: ThemePref; resolved: 'light' | 'dark'; set: (p: ThemePref) => void }>((set) => ({
  pref: read(),
  resolved: resolve(read()),
  set: (pref) => {
    try { pref === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, pref); } catch { /* private mode: still applies for this visit */ }
    const resolved = resolve(pref);
    apply(resolved, true);
    set({ pref, resolved });
  },
}));

/** Mount once: keeps "System" in step with the OS and syncs other open tabs. */
export function useThemeSync() {
  useEffect(() => {
    apply(useTheme.getState().resolved, false);
    const m = media();
    const onOs = () => { const { pref } = useTheme.getState(); if (pref === 'system') { const r = resolve('system'); apply(r, true); useTheme.setState({ resolved: r }); } };
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) { const p = read(); const r = resolve(p); apply(r, true); useTheme.setState({ pref: p, resolved: r }); } };
    m?.addEventListener('change', onOs);
    window.addEventListener('storage', onStorage);
    return () => { m?.removeEventListener('change', onOs); window.removeEventListener('storage', onStorage); };
  }, []);
}
