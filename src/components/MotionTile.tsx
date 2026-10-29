import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { SceneDocument } from '../../shared/scene/schema';
import { HubPreview } from './MotionCard';
import type { AssetResolver } from '../engine/assets';
import { Icon } from '../ui/Icon';

/** Library card: poster → low-res loop while visible → full quality on hover/focus. */
export function MotionTile({ id, doc, assets, title, subtitle, badges, onOpen, onHover, aspect = '4 / 5' }: { id: string; doc: SceneDocument; assets: AssetResolver; title: ReactNode; subtitle?: ReactNode; badges?: ReactNode; onOpen: (from: { id: string; el: HTMLElement | null; canvas: HTMLCanvasElement | null }) => void; onHover?: () => void; aspect?: string }) {
  const [hot, setHot] = useState(false);
  const media = useRef<HTMLDivElement>(null);
  const [w, h] = aspect.split('/').map((x) => Number(x.trim()));
  // Preview the scene at the card's aspect (adapted, never stretched).
  const view = useMemo(() => ({ ...doc, canvas: { ...doc.canvas, width: Math.round(doc.canvas.height * (w / h)), height: doc.canvas.height } }), [doc, w, h]);
  return (
    <button className="mcard" onPointerEnter={() => { setHot(true); onHover?.(); }} onPointerLeave={() => setHot(false)} onFocus={() => setHot(true)} onBlur={() => setHot(false)}
      onClick={() => onOpen({ id, el: media.current, canvas: media.current?.querySelector('canvas') ?? null })} aria-label={typeof title === 'string' ? `Open ${title}` : undefined}>
      <div ref={media} className="mcard-media" style={{ aspectRatio: aspect }}>
        <HubPreview doc={view} assets={assets} active={hot} label={`${typeof title === 'string' ? title : 'Motion'} preview`} />
        {badges && <div className="mcard-badges">{badges}</div>}
        <span className="mcard-play" aria-hidden><Icon name="play" size={13} /></span>
      </div>
      <div className="mcard-meta">
        <div style={{ fontWeight: 500, letterSpacing: '-0.01em' }} className="ellipsis">{title}</div>
        {subtitle && <div className="faint ellipsis" style={{ fontSize: 12 }}>{subtitle}</div>}
      </div>
    </button>
  );
}
