import { useTheme } from '../../lib/theme';

/**
 * Pictures for the tour and first-time tips: real crops of the editor, one per theme, so the
 * picture always matches what you see. Regenerated from the app when the editor changes.
 */
const FILES = import.meta.glob('../../assets/tour/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export type TourImage = 'overview' | 'workspaces' | 'layers' | 'canvas' | 'inspector' | 'ask' | 'share' | 'tip-select' | 'tip-animate' | 'tip-interact';
export function useTourImage(name?: TourImage) {
  const theme = useTheme((s) => s.resolved);
  return name ? FILES[`../../assets/tour/${name}-${theme}.webp`] : undefined;
}
