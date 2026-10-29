import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Layer, SceneDocument } from '../../../shared/scene/schema';
import { MotionCanvas, type MotionCanvasHandle } from '../../components/MotionCanvas';
import { MotionPlayer, hit, type MotionPlayerHandle } from '../../components/MotionPlayer';
import { Clock } from '../../engine/clock';
import type { AssetResolver } from '../../engine/assets';
import type { Bounds } from '../../engine/layers/base';
import { Icon } from '../../ui/Icon';
import { activeAnimation, endCoalesce, layersAt, select, setPlayhead, setPlaying, setProp, useEditor } from './store';

/** Fit the artboard into the available space. */
function useFit(ref: React.RefObject<HTMLDivElement | null>, w: number, h: number) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const s = Math.min((r.width - 48) / w, (r.height - 64) / h);
      setBox({ width: Math.max(40, w * s), height: Math.max(40, h * s) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, w, h]);
  return box;
}

export function Stage({ doc, assets, playerRef, onRuntimeChange }: { doc: SceneDocument; assets: AssetResolver; playerRef: React.Ref<MotionPlayerHandle>; onRuntimeChange: () => void }) {
  const mode = useEditor((s) => s.mode);
  const host = useRef<HTMLDivElement>(null);
  const box = useFit(host, doc.canvas.width, doc.canvas.height);
  const live = mode === 'try' || mode === 'interact';
  return (
    <div className="ed-stage" ref={host}>
      {box.width > 0 && (
        <div className="stage-box" style={{ width: box.width, height: box.height }}>
          {live
            ? <MotionPlayer ref={playerRef} doc={doc} assets={assets} label={`${doc.meta.name} live preview`} style={{ position: 'absolute', inset: 0 }} onChange={onRuntimeChange} />
            : <EditCanvas doc={doc} assets={assets} />}
        </div>
      )}
    </div>
  );
}

type Drag = { kind: 'move' | 'resize' | 'rotate'; layer: Layer; startX: number; startY: number; bounds: Bounds; corner?: string };

function EditCanvas({ doc, assets }: { doc: SceneDocument; assets: AssetResolver }) {
  const clock = useMemo(() => new Clock(), []);
  const canvas = useRef<MotionCanvasHandle>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const mode = useEditor((s) => s.mode);
  const selection = useEditor((s) => s.selection);
  const activeAnim = useEditor((s) => s.activeAnim);
  const playing = useEditor((s) => s.playing);
  const [sel, setSel] = useState<Bounds | null>(null);
  const drag = useRef<Drag | null>(null);
  const anim = mode === 'animate' ? activeAnimation() : null;
  const W = doc.canvas.width, H = doc.canvas.height;

  // What the canvas shows: the design itself, or the selected move at the playhead.
  useEffect(() => {
    const attach = () => {
      const s = canvas.current?.surface;
      if (!s) return false;
      s.renderer.layerSource = (d) => {
        const st = useEditor.getState();
        if (st.mode !== 'animate') return d.layers;
        return layersAt(d, d.machine.animations.find((a) => a.id === st.activeAnim) ?? null, st.playhead);
      };
      return true;
    };
    if (attach()) return;
    const id = setInterval(() => { if (attach()) clearInterval(id); }, 50);
    return () => clearInterval(id);
  }, []);

  // Playback of the selected move in Animate mode.
  useEffect(() => {
    if (!playing || !anim) return;
    let last = performance.now(), raf = 0, dir = 1;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const st = useEditor.getState();
      const a = st.doc?.machine.animations.find((x) => x.id === st.activeAnim);
      if (!a) return;
      let t = st.playhead + dt * dir;
      if (t >= a.duration) {
        if (a.loop === 'loop') t = 0; else if (a.loop === 'pingpong') { t = a.duration; dir = -1; } else { setPlayhead(a.duration); setPlaying(false); return; }
      } else if (t <= 0 && dir < 0) { t = 0; dir = 1; }
      setPlayhead(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, anim?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the selected layer's on-screen box every frame.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const b = selection ? canvas.current?.surface?.renderer.bounds(selection) ?? null : null;
      setSel((p) => (p && b && p.cx === b.cx && p.cy === b.cy && p.w === b.w && p.h === b.h && p.rotation === b.rotation ? p : b ? { ...b } : null));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [selection]);

  const scale = () => (wrap.current ? wrap.current.getBoundingClientRect().width / W : 1);
  const toScene = (e: React.PointerEvent | PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const shown = (id: string) => {
    const st = useEditor.getState();
    const d = st.doc!;
    const layers = st.mode === 'animate' ? layersAt(d, d.machine.animations.find((a) => a.id === st.activeAnim) ?? null, st.playhead) : d.layers;
    return layers.find((l) => l.id === id)!;
  };

  const pick = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    const { x, y } = toScene(e);
    const renderer = canvas.current?.surface?.renderer;
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const l = doc.layers[i];
      if (!l.visible || l.locked || l.type === 'group') continue;
      if (hit(renderer?.bounds(l.id) ?? null, x, y)) { select(l.id); startDrag(e, 'move', l.id); return; }
    }
    select(null);
  };

  const startDrag = (e: React.PointerEvent, kind: Drag['kind'], id: string, corner?: string) => {
    e.stopPropagation();
    const layer = shown(id);
    const b = canvas.current?.surface?.renderer.bounds(id);
    if (!layer || !b || layer.locked) return;
    const p = toScene(e);
    drag.current = { kind, layer, startX: p.x, startY: p.y, bounds: { ...b }, corner };
    endCoalesce();
    const move = (ev: PointerEvent) => onDrag(ev);
    const up = () => { drag.current = null; endCoalesce(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDrag = (ev: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toScene(ev);
    const l = d.layer, b = d.bounds;
    const parentScale = 1; // groups are positioned in their own space; layers at the root are the common case
    if (d.kind === 'move') {
      let nx = l.transform.x + (p.x - d.startX) / W / parentScale, ny = l.transform.y + (p.y - d.startY) / H / parentScale;
      if (ev.shiftKey) { if (Math.abs(p.x - d.startX) > Math.abs(p.y - d.startY)) ny = l.transform.y; else nx = l.transform.x; }
      setProp(l.id, 'transform.x', +nx.toFixed(5), 'drag');
      setProp(l.id, 'transform.y', +ny.toFixed(5), 'drag');
    } else if (d.kind === 'rotate') {
      const a = (Math.atan2(p.y - b.cy, p.x - b.cx) * 180) / Math.PI + 90;
      setProp(l.id, 'transform.rotation', Math.round(ev.shiftKey ? Math.round(a / 15) * 15 : a), 'rotate');
    } else {
      // Resize around the centre using distance in the layer's rotated frame.
      const r = (-b.rotation * Math.PI) / 180;
      const dx = p.x - b.cx, dy = p.y - b.cy;
      const lx = Math.abs(dx * Math.cos(r) - dy * Math.sin(r)) * 2, ly = Math.abs(dx * Math.sin(r) + dy * Math.cos(r)) * 2;
      const sc = l.transform.scale || 1;
      const m = Math.min(W, H);
      if (l.type === 'shape') {
        let w = Math.max(4, lx / sc), h = Math.max(4, ly / sc);
        if (ev.shiftKey) { const k = Math.max(w / l.props.width, h / l.props.height); w = l.props.width * k; h = l.props.height * k; }
        setProp(l.id, 'props.width', Math.round(w), 'resize');
        setProp(l.id, 'props.height', Math.round(h), 'resize');
      } else if (l.type === 'image') {
        const k = Math.max(lx / b.w, ly / b.h);
        setProp(l.id, 'props.width', +Math.min(4, (l.props.width * k)).toFixed(4), 'resize');
        setProp(l.id, 'props.height', +Math.min(4, (l.props.height * k)).toFixed(4), 'resize');
      } else if (l.type === 'text') {
        const k = Math.max(lx / b.w, ly / b.h);
        setProp(l.id, 'props.size', +Math.max(0.005, Math.min(1, l.props.size * k)).toFixed(4), 'resize');
        void m;
      } else {
        setProp(l.id, 'transform.scale', +Math.max(0.05, sc * Math.max(lx / b.w, ly / b.h)).toFixed(3), 'resize');
      }
    }
  };

  const s = scale();
  const recording = mode === 'animate' && !!anim;
  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }} onPointerDown={pick}>
      <MotionCanvas ref={canvas} doc={doc} clock={clock} assets={assets} label={`${doc.meta.name} canvas`} interactive={false} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      {recording && <div className="rec-ring" />}
      {sel && selection && (
        <div className="sel" style={{ left: (sel.cx - sel.w / 2) * s, top: (sel.cy - sel.h / 2) * s, width: sel.w * s, height: sel.h * s, transform: `rotate(${sel.rotation}deg)` }}>
          <div className="body" onPointerDown={(e) => startDrag(e, 'move', selection)} />
          {['nw', 'ne', 'sw', 'se'].map((c) => <div key={c} className={`h ${c}`} onPointerDown={(e) => startDrag(e, 'resize', selection, c)} />)}
          <div className="rot" title="Rotate (Shift snaps to 15°)" onPointerDown={(e) => startDrag(e, 'rotate', selection)} />
        </div>
      )}
      {recording && <div className="stage-note"><span style={{ width: 8, height: 8, borderRadius: 4, background: '#ff5a5a' }} />Changes become keyframes in “{anim!.name}” at {useEditor.getState().playhead.toFixed(2)}s</div>}
      {mode === 'animate' && !anim && <div className="stage-note"><Icon name="info" size={12} />Create a move below, or pick a one-click move on the right.</div>}
    </div>
  );
}
