import { create } from 'zustand';

/**
 * How the editor's workspace is arranged: panel widths, timeline height, focus mode, pinned tools,
 * the canvas grid and zoom. Zoom and the assistant are per visit; the rest is remembered.
 */
type Saved = Omit<Layout, 'zoom' | 'assistant' | 'askPrompt'>;
type Layout = {
  left: number; right: number; timeline: number; timelineOpen: boolean; timelineSelectedOnly: boolean;
  focus: boolean; grid: boolean; pins: string[]; lastShape: string; lastEffect: string;
  zoom: 'fit' | number;
  /** Ask Claude open, and an optional prompt to start it with. Not remembered between visits. */
  assistant: boolean; askPrompt: string | null;
};
const KEY = 'mos.editor.layout';
const DEFAULTS: Saved = { left: 248, right: 304, timeline: 236, timelineOpen: true, timelineSelectedOnly: false, focus: false, grid: false, pins: [], lastShape: 'rect', lastEffect: 'gradient' };
const load = (): Saved => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULTS; } };

export const useLayout = create<Layout>(() => ({ ...load(), zoom: 'fit', assistant: false, askPrompt: null }));
useLayout.subscribe((s) => {
  const { zoom: _zoom, assistant: _a, askPrompt: _p, ...keep } = s;
  try { localStorage.setItem(KEY, JSON.stringify(keep)); } catch { /* private mode: still works for this visit */ }
});

export const setLayout = (patch: Partial<Layout>) => useLayout.setState(patch);
export const openAssistant = (prompt: string | null = null) => useLayout.setState({ assistant: true, askPrompt: prompt });
export const toggleFocus = () => useLayout.setState((s) => ({ focus: !s.focus }));
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Zoom steps, as a fraction of the artwork's real size. */
const STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
export function zoomBy(dir: 1 | -1, fit: number) {
  const cur = useLayout.getState().zoom === 'fit' ? fit : (useLayout.getState().zoom as number);
  const next = dir > 0 ? STEPS.find((s) => s > cur + 0.001) ?? STEPS[STEPS.length - 1] : [...STEPS].reverse().find((s) => s < cur - 0.001) ?? STEPS[0];
  setLayout({ zoom: next });
}

/** Panels a user has dismissed a first-time tip for. */
export function tipSeen(key: string) { try { return localStorage.getItem(`mos.tip.${key}`) === '1'; } catch { return true; } }
export function markTipSeen(key: string) { try { localStorage.setItem(`mos.tip.${key}`, '1'); } catch { /* ignore */ } }
