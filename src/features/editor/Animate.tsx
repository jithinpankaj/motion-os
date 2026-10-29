import { useRef, useState } from 'react';
import type { Easing, Layer, SceneDocument } from '../../../shared/scene/schema';
import { MOVES, colorPath, type MoveKey } from '../../../shared/motion/moves';
import { Segmented } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { clamp, setLayout, useLayout } from './layout';
import {
  activeAnimation, addAnimation, applyMove, deleteAnimation, deleteKeyframe, deleteTrack, endCoalesce, moveKeyframe, select,
  setKeyEasing, setPlayhead, setPlaying, updateAnimation, useEditor,
} from './store';

export const EASINGS: { value: Easing & string; label: string }[] = [
  { value: 'easeInOut', label: 'Smooth' }, { value: 'easeOut', label: 'Slow down' }, { value: 'easeIn', label: 'Speed up' },
  { value: 'expoOut', label: 'Snappy' }, { value: 'backOut', label: 'Bouncy' }, { value: 'spring', label: 'Springy' },
  { value: 'linear', label: 'Steady' }, { value: 'step', label: 'Jump' },
];
const PATH_LABEL: Record<string, string> = {
  'transform.x': 'X', 'transform.y': 'Y', 'transform.rotation': 'Rotation', 'transform.scale': 'Scale', 'transform.scaleX': 'Stretch ↔', 'transform.scaleY': 'Stretch ↕', opacity: 'Opacity',
  'props.width': 'Width', 'props.height': 'Height', 'props.radius': 'Corners', 'props.innerRadius': 'Pointiness',
  'props.fill.color': 'Colour', 'props.fill.color2': 'Colour 2', 'props.fill.angle': 'Gradient angle', 'props.stroke.width': 'Outline', 'props.stroke.color': 'Outline colour',
  'props.color': 'Colour', 'props.size': 'Size', 'props.tracking': 'Spacing', 'props.noiseAmp': 'Movement', 'props.distortion': 'Swirl', 'props.grain': 'Grain',
  'props.colorA': 'Colour', 'props.colorB': 'Colour 2', 'props.velocity': 'Speed', 'props.noise': 'Wander',
};
export const pathLabel = (p: string) => PATH_LABEL[p] ?? (p.match(/^props\.stops\.(\d+)\.color$/) ? `Colour ${Number(p.split('.')[2]) + 1}` : p.split('.').pop()!);

/** Right panel in Animate mode: one-click moves for the selected layer. */
export function QuickMoves({ layer }: { layer: Layer | null }) {
  const anim = activeAnimation();
  useEditor((s) => s.doc);
  const [color, setColor] = useState('#ff5a36');
  const [into, setInto] = useState<'new' | 'current'>('new');
  if (!layer) return <div className="sec"><div className="sec-h">One-click moves</div><div className="empty-hint">Select a layer (click it on the canvas) to give it a move like Pop, Spin or Bounce.</div></div>;
  return (
    <div className="sec">
      <div className="sec-h">One-click moves</div>
      {anim ? (
        <Segmented value={into} onChange={setInto} options={[{ value: 'new', label: 'As a new move' }, { value: 'current', label: `Add to “${anim.name.length > 14 ? anim.name.slice(0, 13) + '…' : anim.name}”` }]} label="Where the move goes" />
      ) : null}
      <div className="empty-hint">{into === 'current' && anim ? <>Added to <b style={{ color: 'var(--text)' }}>{anim.name}</b>{anim.tracks.length ? ' at the playhead, so it plays together with what’s already there' : ''}.</> : 'Each move can be played by a rule in Interact. You can fine-tune every keyframe below.'}</div>
      <div className="moves">
        {MOVES.filter((m) => m.key !== 'colorTo' || colorPath(layer)).map((m) => (
          <button key={m.key} className="move" onClick={() => applyMove(m.key as MoveKey, layer.id, { color, into, name: m.name })} title={m.hint}>
            <Icon name={m.icon as any} size={14} /><span>{m.name}<small>{m.hint}</small></span>
          </button>
        ))}
      </div>
      {colorPath(layer) && <label className="row" style={{ gap: 8, fontSize: 12 }}><span className="faint">“Change colour” goes to</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Target colour" /></label>}
    </div>
  );
}

/** Bottom panel in Animate mode: the selected move's timeline. */
export function Timeline({ doc }: { doc: SceneDocument }) {
  const activeId = useEditor((s) => s.activeAnim);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const selectedKey = useEditor((s) => s.selectedKey);
  const lanes = useRef<HTMLDivElement>(null);
  const anim = doc.machine.animations.find((a) => a.id === activeId) ?? null;
  const D = anim?.duration ?? 1;
  const toT = (clientX: number) => { const r = lanes.current!.getBoundingClientRect(); return Math.max(0, Math.min(D, ((clientX - r.left - 8) / (r.width - 16)) * D)); };
  const pct = (t: number) => `calc(8px + (100% - 16px) * ${t / D})`;

  const { timeline: height, timelineOpen: open, timelineSelectedOnly: onlySel } = useLayout();
  const selection = useEditor((s) => s.selection);
  const byLayer = new Map<string, NonNullable<typeof anim>['tracks']>();
  for (const t of anim?.tracks ?? []) {
    if (onlySel && selection && t.layerId !== selection) continue; const arr = byLayer.get(t.layerId) ?? []; arr.push(t); byLayer.set(t.layerId, arr); }
  const sel = selectedKey && anim?.tracks.find((t) => t.id === selectedKey.trackId)?.keyframes.find((k) => k.id === selectedKey.keyId);

  const scrub = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).classList.contains('kf')) return;
    setPlaying(false);
    setPlayhead(toT(e.clientX));
    const move = (ev: PointerEvent) => setPlayhead(toT(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const dragKey = (e: React.PointerEvent, trackId: string, keyId: string) => {
    e.stopPropagation();
    useEditor.setState({ selectedKey: { trackId, keyId } });
    endCoalesce();
    const move = (ev: PointerEvent) => moveKeyframe(trackId, keyId, toT(ev.clientX), `kf:${keyId}`);
    const up = () => { endCoalesce(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const ticks = Array.from({ length: Math.floor(D / (D > 4 ? 1 : 0.25)) + 1 }, (_, i) => i * (D > 4 ? 1 : 0.25));

  return (
    <div className={`ed-bottom${open ? '' : ' collapsed'}`} style={open ? { height } : undefined}>
      {open && <div className="tl-resize" role="separator" aria-orientation="horizontal" aria-label="Resize the timeline" title="Drag to resize · double-click to reset"
        onDoubleClick={() => setLayout({ timeline: 236 })}
        onPointerDown={(e) => {
          const y0 = e.clientY, h0 = height;
          const move = (ev: PointerEvent) => setLayout({ timeline: clamp(h0 + (y0 - ev.clientY), 140, Math.max(160, window.innerHeight * 0.6)) });
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
        }} />}
      <div className="tl-head">
        <button className="icon-btn sm" aria-label={open ? 'Collapse the timeline' : 'Expand the timeline'} aria-expanded={open} onClick={() => setLayout({ timelineOpen: !open })}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} /></button>
        <span className="sec-h" style={{ marginRight: 4 }}>Moves</span>
        <div className="row wrap" style={{ gap: 4 }}>
          {doc.machine.animations.map((a) => <button key={a.id} className="chip" aria-pressed={a.id === activeId} onClick={() => { useEditor.setState({ activeAnim: a.id, playhead: 0, playing: false, selectedKey: null }); }}>{a.name}</button>)}
          <button className="chip" onClick={() => addAnimation()}><Icon name="plus" size={11} />New move</button>
        </div>
        <div className="grow" />
        {anim && <>
          <button className="icon-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { if (!playing && playhead >= D - 0.01) setPlayhead(0); setPlaying(!playing); }}><Icon name={playing ? 'pause' : 'play'} /></button>
          <span className="mono faint" style={{ fontSize: 11, width: 74 }}>{playhead.toFixed(2)} / {D.toFixed(2)}s</span>
          <input className="input" style={{ width: 130, height: 28 }} value={anim.name} onChange={(e) => updateAnimation(anim.id, { name: e.target.value || 'Move' }, `an-name:${anim.id}`)} aria-label="Move name" />
          <label className="row faint" style={{ gap: 4, fontSize: 11.5 }}>Length
            <input className="input" style={{ width: 58, height: 28 }} type="number" min={0.1} max={120} step={0.1} value={anim.duration} onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) updateAnimation(anim.id, { duration: Math.min(120, v) }, `an-d:${anim.id}`); }} aria-label="Move length in seconds" />s
          </label>
          <Segmented value={anim.loop} onChange={(v) => updateAnimation(anim.id, { loop: v })} options={[{ value: 'once', label: 'Once' }, { value: 'loop', label: 'Loop' }, { value: 'pingpong', label: 'Back & forth' }]} label="Repeat" />
          <button className="chip" aria-pressed={onlySel} disabled={!selection && !onlySel} title={selection ? 'Show only the selected layer’s tracks' : 'Select a layer first'} onClick={() => setLayout({ timelineSelectedOnly: !onlySel })}><Icon name="crosshair" size={11} />Selected only</button>
          <button className="icon-btn" aria-label="Delete move" title="Delete this move" onClick={() => { if (confirm(`Delete the move “${anim.name}”? Rules that play it are removed too.`)) deleteAnimation(anim.id); }}><Icon name="trash" size={14} /></button>
        </>}
      </div>
      {open && anim && (
        <div className="tl-note">
          <Icon name="info" size={12} />
          <input className="input" value={anim.note ?? ''} placeholder="Add a note: why does this move work the way it does?" maxLength={600} onChange={(e) => updateAnimation(anim.id, { note: e.target.value || undefined }, `an-note:${anim.id}`)} aria-label="Note about this move" />
        </div>
      )}
      {open && anim && sel && selectedKey && (
        <div className="tl-head" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <span className="faint" style={{ fontSize: 12 }}>Keyframe at {sel.t.toFixed(2)}s · how it moves to the next one:</span>
          <div className="row wrap" style={{ gap: 4 }}>{EASINGS.map((e) => <button key={e.value} className="chip" aria-pressed={sel.easing === e.value} onClick={() => setKeyEasing(selectedKey.trackId, selectedKey.keyId, e.value)}>{e.label}</button>)}</div>
          <button className="btn sm ghost" onClick={() => deleteKeyframe(selectedKey.trackId, selectedKey.keyId)}><Icon name="trash" size={12} />Delete keyframe</button>
        </div>
      )}
      {!open ? null : !anim ? (
        <div style={{ padding: 16 }} className="empty-hint">A <b>move</b> is a short animation, like “Turn on” or “Bounce”. Create one, then change things on the canvas. Each change becomes a keyframe at the red playhead. Or select a layer and use a one-click move.</div>
      ) : (
        <div className="tl">
          <div className="tl-names">
            <div style={{ height: 22, borderBottom: '1px solid var(--line)' }} />
            {[...byLayer.entries()].map(([lid, tracks]) => {
              const l = doc.layers.find((x) => x.id === lid);
              return [
                <div key={lid} className="tl-row layer" onClick={() => select(lid)} style={{ cursor: 'pointer' }}><Icon name="layers" size={12} />{l?.name ?? 'Missing layer'}</div>,
                ...tracks.map((t) => <div key={t.id} className="tl-row" style={{ paddingLeft: 26 }}><span className="grow">{pathLabel(t.path)}</span><button className="icon-btn sm" aria-label={`Remove ${pathLabel(t.path)} animation`} onClick={() => deleteTrack(t.id)}><Icon name="x" size={10} /></button></div>),
              ];
            })}
            {!byLayer.size && <div className="tl-row" style={{ color: 'var(--text-3)' }}>{onlySel && selection ? 'The selected layer has no keyframes in this move' : 'No keyframes yet'}</div>}
          </div>
          <div className="tl-lanes" ref={lanes} onPointerDown={scrub}>
            <div className="tl-ruler">{ticks.map((t) => <span key={t} style={{ left: pct(t) }}>{+t.toFixed(2)}s</span>)}</div>
            {[...byLayer.entries()].map(([lid, tracks]) => [
              <div key={lid} className="tl-lane layer">{[...new Set(tracks.flatMap((t) => t.keyframes.map((k) => k.t)))].map((t) => <span key={t} className="kf summary" style={{ left: pct(t) }} />)}</div>,
              ...tracks.map((t) => (
                <div key={t.id} className="tl-lane">
                  {t.keyframes.length > 1 && <span className="bar" style={{ left: pct(t.keyframes[0].t), width: `calc((100% - 16px) * ${(t.keyframes[t.keyframes.length - 1].t - t.keyframes[0].t) / D})` }} />}
                  {t.keyframes.map((k) => <span key={k.id} role="button" aria-label={`${pathLabel(t.path)} keyframe at ${k.t}s`} className={`kf ${selectedKey?.keyId === k.id ? 'sel' : ''}`} style={{ left: pct(k.t) }} onPointerDown={(e) => dragKey(e, t.id, k.id)} />)}
                </div>
              )),
            ])}
            <div className="playhead" style={{ left: pct(playhead) }} />
          </div>
        </div>
      )}
    </div>
  );
}
