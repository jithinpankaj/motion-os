import { flushSync } from 'react-dom';
import type { NavigateFunction } from 'react-router-dom';

/**
 * Shared-element navigation: the clicked preview and the destination canvas share the
 * `motion-hero` view-transition name, and the destination shows the card's last frame as a poster
 * until its own renderer draws, so the motion appears to expand into the editor.
 */
let poster: { id: string; url: string } | null = null;
export const takePoster = (id: string) => (poster?.id === id ? poster.url : null);

export function heroNavigate(nav: NavigateFunction, to: string, from?: { id: string; el: HTMLElement | null; canvas?: HTMLCanvasElement | null }) {
  if (from?.canvas) { try { poster = { id: from.id, url: from.canvas.toDataURL('image/jpeg', 0.85) }; } catch { poster = null; } }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = (document as any).startViewTransition?.bind(document);
  if (!start || reduced || !from?.el) { nav(to); return; }
  from.el.style.viewTransitionName = 'motion-hero';
  const t = start(() => { from.el!.style.viewTransitionName = ''; flushSync(() => nav(to)); });
  t.finished?.catch(() => {});
}

export const preload = {
  playground: () => import('../features/playground/Playground'),
  studio: () => import('../features/studio/Studio'),
  campaign: () => import('../features/campaigns/Campaign'),
};
