import { useEffect, useRef, useState } from 'react';
import type { Easing, Layer } from '../../../shared/scene/schema';
import { EASINGS } from '../../../shared/scene/schema';
import { easingFn, easingBezier } from '../../../shared/util/easing';
import { Icon } from '../../ui/Icon';
import { NumberField, Popover, Tip } from '../../ui/controls';
import { LAYER_ICON } from './SceneTree';
import { useStudio, select, updateKeyframe, deleteKeyframe, deleteTrack, commit, endCoalesce, setProp } from './store';

const fmt = (t: number, fps: number) => {
  const s = Math.floor(t), f = Math.round((t - s) * fps);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(f === fps ? 0 : f).padStart(2, '0')}`;
};
const PATH_LABEL = (p: string) => p.replace(/^props\./, '').replace(/^transform\./, '').replace(/\./g, ' ');

export function Timeline({ readOnly }: { readOnly: boolean }) {
  const { doc, clock, selection, selectedKey } = useStudio();
  const [playing, setPlaying] = useState(clock.playing);
  const [speed, setSpeed] = useState(clock.speed);
  const [pxPerSec, setPx] = useState(90);
  const [easeFor, setEaseFor] = useState<{ trackId: string; keyId: string; el: HTMLElement } | null>(null);
  const head = useRef<HTMLDivElement>(null);
  const timeLabel = useRef<HTMLSpanElement>(null);
  const lanes = useRef<HTMLDivElement>(null);
  const easeAnchor = useRef<HTMLElement | null>(null);

  useEffect(() => clock.subscribe(() => { setPlaying(clock.playing); setSpeed(clock.speed); }), [clock]);
  // Playhead + time display update every frame via refs — no React re-render while playing.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const d = useStudio.getState().doc;
      if (!d) return;
      if (head.current) head.current.style.transform = `translateX(${clock.time * pxPerSec}px)`;
      if (timeLabel.current) timeLabel.current.textContent = `${fmt(clock.time, d.canvas.fps)}  ·  f${Math.round(clock.time * d.canvas.fps)}`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock, pxPerSec]);

  if (!doc) return null;
  const D = doc.canvas.duration, fps = doc.canvas.fps;
  const width = D * pxPerSec + 40;
  const timeFromX = (clientX: number) => {
    const r = lanes.current!.getBoundingClientRect();
    return Math.min(D, Math.max(0, (clientX - r.left) / pxPerSec));
  };
  const snap = (t: number, free: boolean) => (free ? t : Math.round(t * fps) / fps);

  // Rows: layers that have tracks or animated clips, plus the selected layer.
  const rows: { layer: Layer; tracks: typeof doc.tracks }[] = doc.layers.slice().reverse()
    .map((l) => ({ layer: l, tracks: doc.tracks.filter((t) => t.layerId === l.id) }))
    .filter((r) => r.tracks.length || selection.includes(r.layer.id) || (r.layer.type === 'text' && r.layer.props.animation.preset !== 'none') || (r.layer.type === 'image' && r.layer.props.reveal.preset !== 'none'));

  const scrub = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const wasPlaying = clock.playing;
    clock.pause();
    clock.seek(snap(timeFromX(e.clientX), e.shiftKey));
    const move = (ev: PointerEvent) => clock.seek(snap(timeFromX(ev.clientX), ev.shiftKey));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (wasPlaying) clock.play(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragKey = (e: React.PointerEvent, trackId: string, keyId: string, t0: number) => {
    e.stopPropagation();
    useStudio.setState({ selectedKey: { trackId, keyId } });
    if (readOnly) return;
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => updateKeyframe(trackId, keyId, { t: snap(Math.min(D, Math.max(0, t0 + (ev.clientX - x0) / pxPerSec)), ev.shiftKey) }, `kdrag:${keyId}`);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); endCoalesce(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragClip = (e: React.PointerEvent, layer: Layer, path: 'props.animation.start' | 'props.reveal.start', start: number) => {
    e.stopPropagation();
    if (readOnly) return;
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => setProp(layer.id, path, +snap(Math.min(D, Math.max(0, start + (ev.clientX - x0) / pxPerSec)), ev.shiftKey).toFixed(3), `clip:${layer.id}`);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); endCoalesce(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKey && !readOnly) { e.preventDefault(); e.stopPropagation(); deleteKeyframe(selectedKey.trackId, selectedKey.keyId); }
  };

  const ticksEvery = pxPerSec > 140 ? 0.25 : pxPerSec > 60 ? 0.5 : 1;
  return (
    <>
      <div className="tl-bar" role="toolbar" aria-label="Playback">
        <Tip label="Restart" kbd="Home" side="top"><button className="icon-btn" onClick={() => clock.restart()} aria-label="Restart"><Icon name="restart" /></button></Tip>
        <Tip label="Previous frame" kbd="," side="top"><button className="icon-btn" onClick={() => clock.step(-1)} aria-label="Previous frame"><Icon name="stepBack" /></button></Tip>
        <Tip label={playing ? 'Pause' : 'Play'} kbd="Space" side="top"><button className="icon-btn on" onClick={() => clock.toggle()} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} /></button></Tip>
        <Tip label="Next frame" kbd="." side="top"><button className="icon-btn" onClick={() => clock.step(1)} aria-label="Next frame"><Icon name="stepFwd" /></button></Tip>
        <span ref={timeLabel} className="tl-time" aria-live="off">00:00:00</span>
        <Tip label={doc.canvas.loop ? 'Seamless loop on' : 'Play once'} side="top"><button className={`icon-btn ${doc.canvas.loop ? 'on' : ''}`} aria-pressed={doc.canvas.loop} disabled={readOnly} onClick={() => commit((d) => ({ ...d, canvas: { ...d.canvas, loop: !d.canvas.loop } }))} aria-label="Toggle loop"><Icon name="loop" /></button></Tip>
        <select className="select sm" style={{ width: 78 }} aria-label="Playback speed" value={speed} onChange={(e) => clock.setSpeed(Number(e.target.value))}>
          {[0.25, 0.5, 1, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        <div style={{ width: 92 }}><NumberField label="Duration" prefix="⏱" suffix="s" value={D} min={0.5} max={120} step={0.1} disabled={readOnly} onChange={(v) => commit((d) => ({ ...d, canvas: { ...d.canvas, duration: v } }), 'dur')} /></div>
        <span className="faint mono">{fps} fps</span>
        <div className="grow" />
        {selectedKey && (() => {
          const tr = doc.tracks.find((t) => t.id === selectedKey.trackId);
          const k = tr?.keyframes.find((x) => x.id === selectedKey.keyId);
          if (!tr || !k) return null;
          return (
            <div className="row" style={{ gap: 6 }}>
              <span className="faint">Key @ {k.t.toFixed(2)}s</span>
              <div style={{ width: 90 }}>
                {typeof k.value === 'number' ? <NumberField label="Keyframe value" prefix="v" value={k.value} step={0.01} disabled={readOnly} onChange={(v) => updateKeyframe(tr.id, k.id, { value: v }, `kv:${k.id}`)} /> : <span className="mono">{String(k.value)}</span>}
              </div>
              <button ref={(el) => { if (el) easeAnchor.current = el; }} className="btn sm" disabled={readOnly} onClick={(e) => setEaseFor({ trackId: tr.id, keyId: k.id, el: e.currentTarget })}><EaseGlyph e={k.easing} />{Array.isArray(k.easing) ? 'custom' : k.easing}</button>
              <button className="icon-btn sm" aria-label="Delete keyframe" disabled={readOnly} onClick={() => deleteKeyframe(tr.id, k.id)}><Icon name="trash" /></button>
            </div>
          );
        })()}
        <Tip label="Timeline zoom" side="top"><input type="range" min={30} max={260} value={pxPerSec} onChange={(e) => setPx(Number(e.target.value))} aria-label="Timeline zoom" style={{ width: 90, accentColor: 'var(--text-2)' }} /></Tip>
      </div>
      <div className="tl-body" tabIndex={0} onKeyDown={onKey} aria-label="Tracks">
        <div className="tl-labels">
          <div className="tl-row" style={{ height: 26, borderBottom: '1px solid var(--line)' }}><span className="eyebrow">Tracks</span></div>
          {!rows.length && <div className="tl-row faint">Select a layer and press ◆ on a property to animate it.</div>}
          {rows.map(({ layer, tracks }) => (
            <div key={layer.id}>
              <div className="tl-row layer" onClick={() => select([layer.id])} style={{ cursor: 'pointer' }}><Icon name={LAYER_ICON[layer.type]} size={13} /><span className="ellipsis">{layer.name}</span></div>
              {(layer.type === 'text' || layer.type === 'image') && <div className="tl-row" style={{ paddingLeft: 30 }}>{layer.type === 'text' ? `reveal · ${layer.props.animation.preset}` : `reveal · ${layer.props.reveal.preset}`}</div>}
              {tracks.map((t) => (
                <div key={t.id} className="tl-row" style={{ paddingLeft: 30 }}>
                  <span className="grow ellipsis">{PATH_LABEL(t.path)}</span>
                  {!readOnly && <button className="icon-btn sm" aria-label={`Remove animation of ${PATH_LABEL(t.path)}`} onClick={() => deleteTrack(t.id)}><Icon name="x" /></button>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="tl-lanes" ref={lanes} style={{ width }}>
          <div className="tl-ruler" onPointerDown={scrub} aria-label="Scrub timeline" role="slider" aria-valuemin={0} aria-valuemax={D} aria-valuenow={+clock.time.toFixed(2)} tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'ArrowRight') clock.step(1); if (e.key === 'ArrowLeft') clock.step(-1); }}>
            {Array.from({ length: Math.floor(D / ticksEvery) + 1 }, (_, i) => i * ticksEvery).map((t) => (
              <div key={t} className="tl-tick" style={{ left: t * pxPerSec, height: Number.isInteger(t) ? 10 : 5 }}>{Number.isInteger(t) && <span>{t}s</span>}</div>
            ))}
          </div>
          {rows.map(({ layer, tracks }) => (
            <div key={layer.id}>
              <div className="tl-lane layer" onPointerDown={scrub} />
              {layer.type === 'text' && (
                <div className="tl-lane" onPointerDown={scrub}>
                  {layer.props.animation.preset !== 'none' && <div className="tl-clip" style={{ left: layer.props.animation.start * pxPerSec, width: Math.max(14, layer.props.animation.duration * pxPerSec) }} onPointerDown={(e) => dragClip(e, layer, 'props.animation.start', layer.props.animation.start)} title="Drag to retime the reveal">{layer.props.animation.preset}</div>}
                  {layer.props.animation.exit && doc.canvas.loop && layer.props.animation.preset !== 'none' && <div className="tl-clip" style={{ left: (D - 0.12 - layer.props.animation.duration * 0.6) * pxPerSec, width: layer.props.animation.duration * 0.6 * pxPerSec, opacity: 0.55, cursor: 'default' }}>out</div>}
                </div>
              )}
              {layer.type === 'image' && (
                <div className="tl-lane" onPointerDown={scrub}>
                  {layer.props.reveal.preset !== 'none' && <div className="tl-clip" style={{ left: layer.props.reveal.start * pxPerSec, width: Math.max(14, layer.props.reveal.duration * pxPerSec) }} onPointerDown={(e) => dragClip(e, layer, 'props.reveal.start', layer.props.reveal.start)}>{layer.props.reveal.preset}</div>}
                </div>
              )}
              {tracks.map((t) => {
                const ks = t.keyframes.slice().sort((a, b) => a.t - b.t);
                return (
                  <div key={t.id} className="tl-lane" onPointerDown={scrub}>
                    {ks.length > 1 && <div className="tl-seg" style={{ left: ks[0].t * pxPerSec, width: (ks.at(-1)!.t - ks[0].t) * pxPerSec }} />}
                    {ks.map((k) => (
                      <button key={k.id} className="tl-key" style={{ left: k.t * pxPerSec }} aria-pressed={selectedKey?.keyId === k.id} aria-label={`Keyframe ${PATH_LABEL(t.path)} at ${k.t.toFixed(2)}s, value ${k.value}`}
                        onPointerDown={(e) => dragKey(e, t.id, k.id, k.t)} onDoubleClick={(e) => !readOnly && setEaseFor({ trackId: t.id, keyId: k.id, el: e.currentTarget })}
                        onClick={(e) => { e.stopPropagation(); clock.pause(); clock.seek(k.t); }} />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="tl-end" style={{ left: D * pxPerSec }} />
          <div ref={head} className="tl-head" style={{ left: 0 }} />
        </div>
      </div>
      <EasePopover target={easeFor} onClose={() => setEaseFor(null)} anchorRef={easeAnchor} />
    </>
  );
}

function EaseGlyph({ e }: { e: Easing }) {
  const f = easingFn(e);
  const pts = Array.from({ length: 13 }, (_, i) => { const x = i / 12; return `${2 + x * 12},${14 - Math.max(-0.3, Math.min(1.3, f(x))) * 12}`; }).join(' ');
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>;
}

/** Easing picker with a draggable cubic-bezier curve editor. */
function EasePopover({ target, onClose, anchorRef }: { target: { trackId: string; keyId: string; el: HTMLElement } | null; onClose: () => void; anchorRef: React.MutableRefObject<HTMLElement | null> }) {
  const doc = useStudio((s) => s.doc);
  if (target) anchorRef.current = target.el;
  const k = target && doc?.tracks.find((t) => t.id === target.trackId)?.keyframes.find((x) => x.id === target.keyId);
  const bz = k ? (easingBezier(k.easing) ?? [0.42, 0, 0.58, 1]) : [0.42, 0, 0.58, 1];
  const S = 150, P = 20;
  const toXY = (x: number, y: number) => [P + x * S, P + (1 - y) * S];
  const set = (e: Easing) => target && updateKeyframe(target.trackId, target.keyId, { easing: e }, `ease:${target.keyId}`);
  const drag = (idx: 0 | 1) => (ev: React.PointerEvent) => {
    const svg = (ev.currentTarget as SVGElement).ownerSVGElement!;
    (ev.target as Element).setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left - P) / S)), y = Math.min(1.6, Math.max(-0.6, 1 - (e.clientY - r.top - P) / S));
      const next = [...bz] as [number, number, number, number];
      next[idx * 2] = +x.toFixed(3); next[idx * 2 + 1] = +y.toFixed(3);
      set(next);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); endCoalesce(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const f = k ? easingFn(k.easing) : (x: number) => x;
  const curve = Array.from({ length: 41 }, (_, i) => toXY(i / 40, f(i / 40)).join(',')).join(' ');
  const [a1x, a1y] = toXY(bz[0], bz[1]), [a2x, a2y] = toXY(bz[2], bz[3]);
  return (
    <Popover anchor={anchorRef} open={!!target && !!k} onClose={onClose} placement="top-start">
      <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'auto 120px', gap: 12 }}>
        <svg width={S + P * 2} height={S + P * 2} className="curve" aria-label="Easing curve editor">
          <rect x={P} y={P} width={S} height={S} fill="none" stroke="var(--line)" />
          <line x1={P} y1={P + S} x2={a1x} y2={a1y} stroke="var(--line-3)" />
          <line x1={P + S} y1={P} x2={a2x} y2={a2y} stroke="var(--line-3)" />
          <polyline points={curve} fill="none" stroke="var(--key)" strokeWidth="2" />
          <circle cx={a1x} cy={a1y} r="6" fill="var(--text)" style={{ cursor: 'grab' }} onPointerDown={drag(0)} />
          <circle cx={a2x} cy={a2y} r="6" fill="var(--text)" style={{ cursor: 'grab' }} onPointerDown={drag(1)} />
        </svg>
        <div className="col" style={{ gap: 2 }}>
          {EASINGS.map((e) => <button key={e} className="menu-item" style={{ padding: '5px 7px' }} aria-pressed={k?.easing === e} onClick={() => set(e)}><EaseGlyph e={e} />{e}</button>)}
          <div className="mono faint" style={{ fontSize: 10, marginTop: 6 }}>{bz.map((n) => n.toFixed(2)).join(', ')}</div>
        </div>
      </div>
    </Popover>
  );
}
