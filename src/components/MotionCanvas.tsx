import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { SceneDocument } from '../../shared/scene/schema';
import { Clock } from '../engine/clock';
import { MotionSurface } from '../engine/surface';
import type { AssetResolver } from '../engine/assets';
import type { MotionMode } from '../engine/layers/base';
import type { Issue } from '../engine/renderer';
import { Icon } from '../ui/Icon';

export type MotionCanvasHandle = { surface: MotionSurface | null };

/**
 * One live, full-quality canvas (Studio, Playground). Owns its own GPU context; recovers from
 * context loss and creation failure (render error boundary) without losing the document.
 */
export const MotionCanvas = forwardRef<MotionCanvasHandle, {
  doc: SceneDocument; clock: Clock; assets: AssetResolver; motion?: MotionMode; interactive?: boolean; label: string;
  onIssues?: (i: Issue[]) => void; className?: string; style?: React.CSSProperties;
}>(function MotionCanvas({ doc, clock, assets, motion = 'full', interactive = true, label, onIssues, className, style }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const [surface, setSurface] = useState<MotionSurface | null>(null);
  const [state, setState] = useState<{ lost: boolean; overloaded: boolean; failed?: string }>({ lost: false, overloaded: false });
  const [attempt, setAttempt] = useState(0);
  useImperativeHandle(ref, () => ({ surface }), [surface]);

  useEffect(() => {
    if (!host.current) return;
    // A fresh canvas per mount: a disposed surface force-releases its context, which must never be reused.
    const el = document.createElement('canvas');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
    el.style.cssText = 'width:100%;height:100%;display:block';
    host.current.prepend(el);
    let s: MotionSurface;
    try {
      s = new MotionSurface(el, clock, assets, { interactive });
    } catch (e: any) {
      el.remove();
      setState({ lost: false, overloaded: false, failed: e?.message ?? 'WebGL unavailable' });
      return;
    }
    s.setScene(doc);
    s.setMotion(motion);
    s.start();
    const offS = s.onStatus((st) => setState({ lost: st.lost, overloaded: st.overloaded }));
    const offI = onIssues ? s.renderer.onIssues(onIssues) : () => {};
    setSurface(s);
    setState({ lost: false, overloaded: false });
    return () => { offS(); offI(); s.dispose(); el.remove(); setSurface(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, attempt]);

  useEffect(() => { surface?.setScene(doc); }, [surface, doc]);
  useEffect(() => { surface?.renderer.setAssets(assets); }, [surface, assets]);
  useEffect(() => { surface?.setMotion(motion); }, [surface, motion]);

  return (
    <div ref={host} className={className} style={{ position: 'relative', ...style }}>
      {(state.lost || state.failed) && (
        <div role="alert" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(8,8,10,.82)', textAlign: 'center', padding: 20 }}>
          <div className="col" style={{ alignItems: 'center' }}>
            {state.lost ? <div className="spinner" /> : <Icon name="alert" />}
            <div className="h3">{state.lost ? 'Restoring graphics…' : 'Preview unavailable'}</div>
            <div className="muted" style={{ maxWidth: 300 }}>{state.lost ? 'The GPU context was reset. Your scene and timeline position are safe.' : `${state.failed}. Your document is safe — try again or use a browser with WebGL 2.`}</div>
            {state.failed && <button className="btn sm" onClick={() => setAttempt((a) => a + 1)}>Retry</button>}
          </div>
        </div>
      )}
      {state.overloaded && !state.lost && (
        <div role="status" className="badge warn solid" style={{ position: 'absolute', left: 10, bottom: 10 }}>
          <Icon name="gauge" size={12} /> Device is struggling — preview quality reduced
        </div>
      )}
    </div>
  );
});
