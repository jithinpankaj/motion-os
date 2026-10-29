import { useEffect, useRef, useState } from 'react';
import type { SceneDocument } from '../../shared/scene/schema';
import { getHub, type PreviewMode } from '../engine/hub';
import type { AssetResolver } from '../engine/assets';
import { useReducedMotion } from '../lib/prefs';

/**
 * A lightweight motion preview: renders through the shared RenderHub (one WebGL context for the
 * whole page). Poster when idle, low-res animation when visible, full quality while hovered/active.
 */
export function HubPreview({ doc, assets, active, label, style, className, eager }: { doc: SceneDocument; assets: AssetResolver; active?: boolean; label: string; style?: React.CSSProperties; className?: string; eager?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<ReturnType<ReturnType<typeof getHub>['register']> | null>(null);
  const [visible, setVisible] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    const hub = getHub();
    hub.reducedMotion = reduced;
    handle.current = hub.register(ref.current!, doc, assets, 'off');
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '120px' });
    io.observe(ref.current!);
    return () => { io.disconnect(); handle.current?.dispose(); handle.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { handle.current?.update(doc); }, [doc]);
  useEffect(() => { handle.current?.setAssets(assets); }, [assets]);
  useEffect(() => {
    getHub().reducedMotion = reduced;
    const mode: PreviewMode = !visible ? 'off' : reduced ? 'poster' : active ? 'live' : eager ? 'low' : 'low';
    handle.current?.setMode(mode);
  }, [visible, active, reduced, eager]);
  return <canvas ref={ref} role="img" aria-label={label} className={className} style={style} />;
}
