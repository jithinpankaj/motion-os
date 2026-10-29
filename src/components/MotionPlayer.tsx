import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { SceneDocument } from '../../shared/scene/schema';
import { MotionRuntime } from '../../shared/motion/runtime';
import { Clock } from '../engine/clock';
import type { AssetResolver } from '../engine/assets';
import type { Bounds } from '../engine/layers/base';
import { MotionCanvas, type MotionCanvasHandle } from './MotionCanvas';
import { useReducedMotion } from '../lib/prefs';
import { playSound } from '../lib/sound';
import type { BuiltinSound } from '../../shared/scene/schema';

export type MotionPlayerHandle = { runtime: MotionRuntime; reset: () => void };

/** Is scene point (x, y) inside a (possibly rotated) layer box? */
export function hit(b: Bounds | null, x: number, y: number) {
  if (!b) return false;
  const r = (-b.rotation * Math.PI) / 180;
  const dx = x - b.cx, dy = y - b.cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
}

/**
 * A live, interactive motion: runs the scene's controls and rules, and turns pointer activity on
 * the canvas into click / hover / press events for the layers that listen for them.
 */
export const MotionPlayer = forwardRef<MotionPlayerHandle, {
  doc: SceneDocument; assets: AssetResolver; label: string; className?: string; style?: React.CSSProperties;
  onChange?: () => void;
}>(function MotionPlayer({ doc, assets, label, className, style, onChange }, ref) {
  const clock = useMemo(() => new Clock(), []);
  const runtime = useMemo(() => new MotionRuntime(doc), []); // eslint-disable-line react-hooks/exhaustive-deps
  const canvas = useRef<MotionCanvasHandle>(null);
  const host = useRef<HTMLDivElement>(null);
  const hovered = useRef(new Set<string>());
  const pressed = useRef<string | null>(null);
  const [cursor, setCursor] = useState('default');
  const reduced = useReducedMotion();
  useImperativeHandle(ref, () => ({ runtime, reset: () => { runtime.reset(); onChange?.(); } }), [runtime, onChange]);

  useEffect(() => { runtime.setDoc(doc); }, [doc, runtime]);
  // Tell the host once the runtime exists (so its controls panel can show), then on every event.
  useEffect(() => { onChange?.(); return runtime.on(() => onChange?.()); }, [runtime, onChange]);
  // "Play a sound" actions become audio here (muted players stay silent).
  useEffect(() => runtime.on((e) => { if (e.kind === 'sound') void playSound(e.detail === 'asset' ? { assetId: e.id, volume: e.volume } : { builtin: e.id as BuiltinSound, volume: e.volume }, assets); }), [runtime, assets]);

  // Feed the renderer from the runtime every frame.
  useEffect(() => {
    let surface = canvas.current?.surface;
    let last = performance.now();
    const attach = () => {
      surface = canvas.current?.surface;
      if (!surface) return false;
      surface.renderer.layerSource = () => {
        const now = performance.now();
        runtime.step((now - last) / 1000);
        last = now;
        return runtime.layers();
      };
      return true;
    };
    if (attach()) return () => { if (surface) surface.renderer.layerSource = null; };
    const id = setInterval(() => { if (attach()) clearInterval(id); }, 50);
    return () => { clearInterval(id); if (surface) surface.renderer.layerSource = null; };
  }, [runtime]);

  // Pointer-following sliders track the pointer anywhere on the page, so a character can look at it.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!runtime.follows || !host.current) return;
      const r = host.current.getBoundingClientRect();
      runtime.pointerMove((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    const away = () => runtime.pointerAway();
    window.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', away);
    window.addEventListener('blur', away);
    return () => { window.removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', away); window.removeEventListener('blur', away); };
  }, [runtime]);

  const scenePoint = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * doc.canvas.width, y: ((e.clientY - r.top) / r.height) * doc.canvas.height };
  };
  const interactiveUnder = (x: number, y: number) => {
    const listen = runtime.pointerLayers;
    const renderer = canvas.current?.surface?.renderer;
    if (!renderer) return { top: null as string | null, inside: new Set<string>() };
    const inside = new Set<string>();
    let top: string | null = null;
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const l = doc.layers[i];
      if (!listen.has(l.id)) continue;
      if (hit(renderer.bounds(l.id), x, y)) { inside.add(l.id); top ??= l.id; }
    }
    return { top, inside };
  };
  const onMove = (e: React.PointerEvent) => {
    const { x, y } = scenePoint(e);
    const { top, inside } = interactiveUnder(x, y);
    // Hover is per layer (a label on top of a card doesn't make the card "leave").
    for (const id of inside) if (!hovered.current.has(id)) runtime.pointer('enter', id);
    for (const id of hovered.current) if (!inside.has(id)) runtime.pointer('leave', id);
    hovered.current = inside;
    if (pressed.current && runtime.isDragging(pressed.current)) return;
    setCursor(top ? (runtime.dragLayers.has(top) ? 'grab' : 'pointer') : 'default');
  };
  const onLeave = () => {
    for (const id of hovered.current) runtime.pointer('leave', id);
    hovered.current = new Set();
    if (pressed.current) { runtime.pointer('up', pressed.current); pressed.current = null; }
  };
  const onDown = (e: React.PointerEvent) => {
    const { top } = interactiveUnder(scenePoint(e).x, scenePoint(e).y);
    pressed.current = top;
    if (!top) return;
    // Keep receiving the pointer while it's held, even outside the canvas (for dragging).
    try { host.current?.setPointerCapture(e.pointerId); } catch {}
    runtime.pointer('down', top);
    if (runtime.dragLayers.has(top)) setCursor('grabbing');
  };
  const onUp = (e: React.PointerEvent) => {
    const { top } = interactiveUnder(scenePoint(e).x, scenePoint(e).y);
    const was = pressed.current;
    pressed.current = null;
    if (was) runtime.pointer('up', was);
    if (was && was === top) runtime.pointer('click', top);
  };

  return (
    <div ref={host} className={className} style={{ position: 'relative', cursor, touchAction: 'none', ...style }}
      onPointerMove={onMove} onPointerLeave={onLeave} onPointerDown={onDown} onPointerUp={onUp}>
      <MotionCanvas ref={canvas} doc={doc} clock={clock} assets={assets} label={label} interactive={false} motion={reduced ? 'reduced' : 'full'} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
});
