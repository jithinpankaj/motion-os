import { useEffect, useMemo, useRef, useState } from 'react';
import { MotionCanvas, type MotionCanvasHandle } from '../../components/MotionCanvas';
import { SafeArea } from '../../components/FormatFrame';
import { apiResolver } from '../../lib/assets';
import { takePoster } from '../../lib/transition';
import { useReducedMotion } from '../../lib/prefs';
import { Icon } from '../../ui/Icon';
import { Segmented, Tip } from '../../ui/controls';
import { adaptScene } from '../../../shared/adapt';
import { CHANNEL_FORMATS, formatById } from '../../../shared/formats';
import { useStudio, select, setProp, commit, endCoalesce } from './store';
import type { Metrics } from '../../engine/renderer';

export function Viewport({ readOnly }: { readOnly: boolean }) {
  const { doc: maybeDoc, clock, previewFormat, overlays, motion, selection, issues, projectId } = useStudio();
  const doc = maybeDoc!;
  const box = useRef<HTMLDivElement>(null);
  const handle = useRef<MotionCanvasHandle>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [space, setSpace] = useState(false);
  const [playing, setPlaying] = useState(clock.playing);
  const [poster, setPoster] = useState<string | null>(() => (projectId ? takePoster(projectId) : null));
  const selRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const assets = useMemo(() => apiResolver(), []);

  useEffect(() => clock.subscribe(() => setPlaying(clock.playing)), [clock]);
  useEffect(() => { if (poster) { const t = setTimeout(() => setPoster(null), 450); return () => clearTimeout(t); } }, [poster]);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current!);
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && !/input|textarea/i.test((e.target as HTMLElement).tagName)) setSpace(true); if (e.key === '0' && !/input|textarea/i.test((e.target as HTMLElement).tagName)) { setZoom(1); setPan({ x: 0, y: 0 }); } };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { ro.disconnect(); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

  const format = previewFormat ? formatById(previewFormat) : null;
  const shown = useMemo(() => (format ? adaptScene(doc, format) : doc), [doc, format]);
  const W = shown.canvas.width, H = shown.canvas.height;
  const fit = Math.min((size.w - 96) / W, (size.h - 120) / H);
  const scale = Math.max(0.02, fit * zoom);
  const cw = W * scale, ch = H * scale;
  const left = (size.w - cw) / 2 + pan.x, top = (size.h - ch) / 2 + pan.y - 14;

  // Selection overlay follows the renderer's live bounds every frame (no React re-render).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = selRef.current, s = handle.current?.surface;
      if (!el || !s) return;
      const id = useStudio.getState().selection[0];
      const b = id ? s.renderer.bounds(id) : null;
      if (!b) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      const k = cw / W;
      el.style.left = `${b.cx * k - (b.w * k) / 2}px`;
      el.style.top = `${b.cy * k - (b.h * k) / 2}px`;
      el.style.width = `${b.w * k}px`;
      el.style.height = `${b.h * k}px`;
      el.style.transform = `rotate(${b.rotation}deg)`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cw, W]);

  const drag = useRef<{ mode: 'pan' | 'move' | 'orbit'; x: number; y: number; ox: number; oy: number; id?: string } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (space || e.button === 1) { drag.current = { mode: 'pan', x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y }; return; }
    if (readOnly) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = ((e.clientX - r.left) / cw) * W, sy = ((e.clientY - r.top) / ch) * H;
    const s = handle.current?.surface;
    // hit-test front-most 2D layer with bounds
    const hit = [...doc.layers].reverse().find((l) => {
      if (!l.visible || l.locked || (l.type !== 'text' && l.type !== 'image')) return false;
      const b = s?.renderer.bounds(l.id);
      return b && Math.abs(sx - b.cx) <= b.w / 2 && Math.abs(sy - b.cy) <= b.h / 2;
    });
    const mesh = doc.layers.find((l) => l.id === selection[0] && l.type === 'mesh');
    if (e.altKey || (!hit && mesh)) { drag.current = { mode: 'orbit', x: e.clientX, y: e.clientY, ox: doc.canvas.camera.yaw, oy: doc.canvas.camera.pitch }; return; }
    if (hit) {
      select([hit.id]);
      drag.current = { mode: 'move', x: e.clientX, y: e.clientY, ox: hit.transform.x, oy: hit.transform.y, id: hit.id };
    } else select([]);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (d.mode === 'pan') setPan({ x: d.ox + dx, y: d.oy + dy });
    if (d.mode === 'orbit') commit((doc) => ({ ...doc, canvas: { ...doc.canvas, camera: { ...doc.canvas.camera, yaw: +((d.ox - dx * 0.4 + 540) % 360 - 180).toFixed(1), pitch: +Math.max(-85, Math.min(85, d.oy + dy * 0.3)).toFixed(1) } } }), 'orbit');
    if (d.mode === 'move' && d.id) {
      const ax = e.shiftKey && Math.abs(dy) > Math.abs(dx) ? 0 : dx, ay = e.shiftKey && Math.abs(dx) >= Math.abs(dy) ? 0 : dy;
      setProp(d.id, 'transform.x', +(d.ox + ax / cw).toFixed(4), `move:${d.id}`);
      setProp(d.id, 'transform.y', +(d.oy + ay / ch).toFixed(4), `move:${d.id}`);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const nz = Math.min(8, Math.max(0.1, zoom * Math.exp(-e.deltaY * 0.01)));
      const r = box.current!.getBoundingClientRect();
      const mx = e.clientX - r.left - size.w / 2 - pan.x, my = e.clientY - r.top - size.h / 2 - pan.y;
      setPan({ x: pan.x - mx * (nz / zoom - 1), y: pan.y - my * (nz / zoom - 1) });
      setZoom(nz);
    } else setPan({ x: pan.x - e.deltaX, y: pan.y - e.deltaY });
  };

  const gridStep = Math.max(8, Math.round(cw / 12));
  const metricsSurface = handle.current?.surface;
  return (
    <div ref={box} style={{ position: 'absolute', inset: 0, cursor: space ? 'grab' : undefined }} onWheel={onWheel}>
      <div className="vp-top">
        <select className="select sm" style={{ width: 190 }} aria-label="Preview format" value={previewFormat ?? ''} onChange={(e) => useStudio.setState({ previewFormat: e.target.value || null })}>
          <option value="">Design canvas · {doc.canvas.width}×{doc.canvas.height}</option>
          {CHANNEL_FORMATS.map((f) => <option key={f.id} value={f.id}>Preview: {f.name} · {f.width}×{f.height}</option>)}
        </select>
        <Segmented label="Motion preview" value={reduced && motion === 'full' ? 'reduced' : motion} onChange={(v) => useStudio.setState({ motion: v })}
          options={[{ value: 'full', label: 'Full', title: 'Full motion' }, { value: 'reduced', label: 'Reduced', title: 'Reduced-motion preview: fades, no travel' }, { value: 'static', label: 'Static', title: 'Static fallback frame' }]} />
        <div className="grow" />
        <span className="mono faint">{Math.round(scale * 100)}%</span>
      </div>
      {issues.length > 0 && (
        <div className="issue-list" role="status">
          {issues.slice(0, 4).map((i) => <div key={i.layerId} className="issue"><Icon name="alert" size={14} /><div><b style={{ fontWeight: 560 }}>{doc.layers.find((l) => l.id === i.layerId)?.name ?? 'Layer'}</b> — {i.message}</div></div>)}
        </div>
      )}
      <div className="vp-stage" style={{ width: cw, height: ch, transform: `translate(${left}px, ${top}px)`, viewTransitionName: 'motion-hero' } as any}>
        <MotionCanvas ref={handle} doc={shown} clock={clock} assets={assets} motion={reduced && motion === 'full' ? 'reduced' : motion} label={`${doc.meta.name} canvas`} style={{ width: '100%', height: '100%' }} onIssues={(i) => useStudio.setState({ issues: i })} />
        {poster && <img src={poster} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', transition: 'opacity .3s', opacity: 1 }} />}
        <div className="vp-overlay" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; endCoalesce(); }} style={{ cursor: space ? 'grabbing' : undefined }}>
          <svg width={cw} height={ch} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
            {overlays.grid && Array.from({ length: Math.ceil(cw / gridStep) }, (_, i) => <line key={`v${i}`} x1={i * gridStep} x2={i * gridStep} y1={0} y2={ch} stroke="rgba(255,255,255,.07)" />)}
            {overlays.grid && Array.from({ length: Math.ceil(ch / gridStep) }, (_, i) => <line key={`h${i}`} y1={i * gridStep} y2={i * gridStep} x1={0} x2={cw} stroke="rgba(255,255,255,.07)" />)}
            {overlays.guides && <><line x1={cw / 2} x2={cw / 2} y1={0} y2={ch} stroke="rgba(143,176,255,.18)" strokeDasharray="3 5" /><line y1={ch / 2} y2={ch / 2} x1={0} x2={cw} stroke="rgba(143,176,255,.18)" strokeDasharray="3 5" /></>}
          </svg>
          {overlays.safe && <SafeArea format={format ?? { safe: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 } }} />}
          <div ref={selRef} className="sel-box" style={{ display: 'none' }}>
            {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => <span key={`${x}${y}`} className="h" style={{ left: `calc(${x * 100}% - 4px)`, top: `calc(${y * 100}% - 4px)` }} />)}
          </div>
        </div>
      </div>
      {overlays.perf && metricsSurface && <PerfPanel surface={metricsSurface} />}
      <div className="vp-toolbar" role="toolbar" aria-label="Canvas tools">
        <Tip label={playing ? 'Pause' : 'Play'} kbd="Space" side="top"><button className="icon-btn" onClick={() => clock.toggle()} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} /></button></Tip>
        <span className="sep" />
        <Tip label="Zoom out" side="top"><button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))} aria-label="Zoom out"><Icon name="zoomOut" /></button></Tip>
        <Tip label="Zoom in" side="top"><button className="icon-btn" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} aria-label="Zoom in"><Icon name="zoomIn" /></button></Tip>
        <Tip label="Fit to view" kbd="0" side="top"><button className="icon-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Fit to view"><Icon name="fit" /></button></Tip>
        <Tip label="Actual size (100%)" side="top"><button className="btn sm ghost mono" onClick={() => { setZoom(1 / fit); setPan({ x: 0, y: 0 }); }}>1:1</button></Tip>
        <span className="sep" />
        <Tip label="Safe areas" side="top"><button className={`icon-btn ${overlays.safe ? 'on' : ''}`} aria-pressed={overlays.safe} onClick={() => useStudio.setState({ overlays: { ...overlays, safe: !overlays.safe } })} aria-label="Toggle safe areas"><Icon name="safe" /></button></Tip>
        <Tip label="Grid" side="top"><button className={`icon-btn ${overlays.grid ? 'on' : ''}`} aria-pressed={overlays.grid} onClick={() => useStudio.setState({ overlays: { ...overlays, grid: !overlays.grid } })} aria-label="Toggle grid"><Icon name="grid" /></button></Tip>
        <Tip label="Centre guides" side="top"><button className={`icon-btn ${overlays.guides ? 'on' : ''}`} aria-pressed={overlays.guides} onClick={() => useStudio.setState({ overlays: { ...overlays, guides: !overlays.guides } })} aria-label="Toggle guides"><Icon name="crosshair" /></button></Tip>
        <Tip label="Performance inspector" side="top"><button className={`icon-btn ${overlays.perf ? 'on' : ''}`} aria-pressed={overlays.perf} onClick={() => useStudio.setState({ overlays: { ...overlays, perf: !overlays.perf } })} aria-label="Toggle performance inspector"><Icon name="gauge" /></button></Tip>
        <Tip label="Fullscreen" side="top"><button className="icon-btn" onClick={() => box.current?.parentElement?.requestFullscreen?.()} aria-label="Fullscreen"><Icon name="maximize" /></button></Tip>
      </div>
    </div>
  );
}

function PerfPanel({ surface }: { surface: NonNullable<MotionCanvasHandle['surface']> }) {
  const [m, setM] = useState<Metrics>(surface.renderer.metrics);
  const [dpr, setDpr] = useState<string>(String(surface.dpr));
  const [adaptive, setAdaptive] = useState(surface.adaptive);
  useEffect(() => { const t = setInterval(() => setM({ ...surface.renderer.metrics }), 400); return () => clearInterval(t); }, [surface]);
  return (
    <div className="perf" aria-label="Performance inspector">
      <div className="row between" style={{ marginBottom: 8 }}><span className="eyebrow">Performance</span><span className={`badge ${m.fps > 50 ? 'ok' : m.fps > 30 ? 'warn' : 'danger'}`}>{m.fps.toFixed(0)} fps</span></div>
      <dl>
        <dt>CPU frame</dt><dd>{m.frameMs.toFixed(2)} ms</dd>
        <dt>Draw calls</dt><dd>{m.drawCalls}</dd>
        <dt>Triangles</dt><dd>{m.triangles.toLocaleString()}</dd>
        <dt>Points</dt><dd>{m.points.toLocaleString()}</dd>
        <dt>Texture mem</dt><dd>~{m.textureMB.toFixed(1)} MB</dd>
        <dt>Shader compile</dt><dd>{m.compileMs.toFixed(1)} ms</dd>
        <dt>Layer views</dt><dd>{m.views}</dd>
        <dt>Quality</dt><dd>{Math.round(m.quality * 100)}%</dd>
        <dt>Buffer</dt><dd>{surface.canvas.width}×{surface.canvas.height}</dd>
      </dl>
      <div className="row" style={{ marginTop: 10, gap: 6 }}>
        <select className="select sm" aria-label="Device pixel ratio" value={dpr} onChange={(e) => { setDpr(e.target.value); surface.setDpr(e.target.value === 'auto' ? 'auto' : Number(e.target.value)); }}>
          <option value="auto">DPR auto</option>{[0.5, 1, 1.5, 2].map((v) => <option key={v} value={v}>DPR {v}</option>)}
        </select>
        <label className="checkbox"><input type="checkbox" checked={adaptive} onChange={(e) => { surface.adaptive = e.target.checked; setAdaptive(e.target.checked); if (!e.target.checked) { surface.quality = 1; surface.resize(); } }} />Adaptive</label>
      </div>
      <button className="btn sm" style={{ marginTop: 8, width: '100%' }} onClick={() => surface.gpu.simulateContextLoss()}>Simulate GPU context loss</button>
    </div>
  );
}
