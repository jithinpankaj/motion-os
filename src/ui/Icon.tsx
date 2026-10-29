import { ICONS } from './icons';

export type IconName = keyof typeof ICONS | string;

/** Interface icons (Phosphor, regular weight; see src/ui/icons.ts), drawn in the current text colour. */
export function Icon({ name, size, className = '', label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg className={`i ${className}`} viewBox="0 0 256 256" width={size} height={size} style={size ? { width: size, height: size } : undefined} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <path d={(ICONS[name] ?? ICONS.info).d} />
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  // Drawn in currentColor so the mark follows the interface theme.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Motion OS" role="img">
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2.5" />
      <path d="M9.5 18.5c2.2-5 4.4-5 6.5 0s4.3 5 6.5 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
