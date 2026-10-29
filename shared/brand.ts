import { GRADIENT_PRESETS } from './scene/presets';

export type TokenCategory = 'color' | 'typography' | 'duration' | 'easing' | 'spring' | 'intensity' | 'particles' | 'gradient' | 'behaviour' | 'accessibility';
export type BrandToken = { key: string; category: TokenCategory; value: any; description: string };

export const DEFAULT_BRAND_TOKENS: BrandToken[] = [
  { key: 'color.night', category: 'color', value: '#05060a', description: 'Primary background' },
  { key: 'color.paper', category: 'color', value: '#f5f5f2', description: 'Primary text on dark' },
  { key: 'color.primary', category: 'color', value: '#6b8cff', description: 'Brand blue' },
  { key: 'color.secondary', category: 'color', value: '#ff6ad5', description: 'Brand magenta' },
  { key: 'color.accent', category: 'color', value: '#ff5a36', description: 'Signal accent' },
  { key: 'color.support', category: 'color', value: '#16a3a0', description: 'Teal support' },
  { key: 'type.display', category: 'typography', value: { family: 'Geist', weight: 700, tracking: -0.04 }, description: 'Display headlines' },
  { key: 'type.editorial', category: 'typography', value: { family: 'Instrument Serif', weight: 400, tracking: -0.02 }, description: 'Editorial headlines' },
  { key: 'type.label', category: 'typography', value: { family: 'Geist Mono', weight: 500, tracking: 0.25 }, description: 'Eyebrows and labels' },
  { key: 'duration.short', category: 'duration', value: 0.24, description: 'Micro interactions (s)' },
  { key: 'duration.medium', category: 'duration', value: 0.6, description: 'Entrances (s)' },
  { key: 'duration.long', category: 'duration', value: 1.4, description: 'Hero reveals (s)' },
  { key: 'easing.standard', category: 'easing', value: [0.2, 0, 0, 1], description: 'Default UI and entrance easing' },
  { key: 'easing.emphasized', category: 'easing', value: [0.05, 0.7, 0.1, 1], description: 'Hero reveals' },
  { key: 'spring.gentle', category: 'spring', value: { stiffness: 170, damping: 26, mass: 1 }, description: 'Panels and drag release' },
  { key: 'spring.snappy', category: 'spring', value: { stiffness: 420, damping: 32, mass: 1 }, description: 'Toggles and small controls' },
  { key: 'motion.intensity', category: 'intensity', value: 0.7, description: 'Global motion intensity (0–1)' },
  { key: 'particles.density', category: 'particles', value: 20000, description: 'Maximum particle count for templates' },
  ...GRADIENT_PRESETS.map((g) => ({ key: `gradient.${g.key}`, category: 'gradient' as const, value: g.stops, description: `${g.name} gradient` })),
  { key: 'behaviour.loop', category: 'behaviour', value: true, description: 'Brand motion loops seamlessly by default' },
  { key: 'a11y.reducedMotion', category: 'accessibility', value: 'static', description: 'Reduced-motion behaviour: static frame or reduced' },
  { key: 'a11y.minContrast', category: 'accessibility', value: 4.5, description: 'Minimum text contrast ratio' },
  { key: 'a11y.maxFlashes', category: 'accessibility', value: 3, description: 'Maximum flashes per second' },
];
