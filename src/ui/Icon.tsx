import { ICONS } from './icons';

export type IconName = keyof typeof ICONS | string;

/**
 * Hand-drawn interface icons (see src/ui/icons.ts). Expressive icons carry a warm accent shape,
 * printed a little off-register behind the line; pass accent={false} to leave it out (it is also
 * left out below 13px, where it would only blur the glyph).
 */
export function Icon({ name, size, className = '', label, accent = true }: { name: IconName; size?: number; className?: string; label?: string; accent?: boolean }) {
  const icon = ICONS[name] ?? ICONS.info;
  const showAccent = !!icon.accent && accent && (size === undefined || size >= 13);
  return (
    <svg className={`i ${className}`} viewBox="0 0 256 256" width={size} height={size} style={size ? { width: size, height: size } : undefined} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      {showAccent && <path className={icon.solid ? 'i-fill' : 'i-accent'} d={icon.accent} transform={icon.solid ? undefined : 'translate(14 12)'} />}
      <path d={icon.d} />
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
