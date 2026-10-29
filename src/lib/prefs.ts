import { useEffect, useState } from 'react';
import { create } from 'zustand';

/** User preference overrides the OS setting when set. */
export const usePrefs = create<{ motion: 'system' | 'reduce' | 'full'; set: (m: 'system' | 'reduce' | 'full') => void }>((set) => ({
  motion: ((() => { try { return localStorage.getItem('mos.motion'); } catch { return null; } })() as any) ?? 'system',
  set: (m) => { try { localStorage.setItem('mos.motion', m); } catch {} set({ motion: m }); },
}));

export function useReducedMotion() {
  const pref = usePrefs((s) => s.motion);
  const [os, setOs] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const f = () => setOs(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return pref === 'reduce' || (pref === 'system' && os);
}
