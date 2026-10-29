import { deserializeScene } from '../../shared/scene/serialize';
import { applyParameters, type ParamValues } from '../../shared/params';
import { Clock } from '../engine/clock';
import { MotionSurface } from '../engine/surface';
import { nullResolver, type AssetResolver } from '../engine/assets';

export type EmbedConfig = {
  schema: 'motion-os/embed@1';
  template: { id: string; name: string; version: number; versionId: string };
  params: ParamValues;
  accessibility: { reducedMotion: 'static' | 'reduced'; staticFrame: number; label: string };
  performance?: { maxDpr?: number; pauseWhenHidden?: boolean };
  scene: unknown;
};
export type MountOptions = { params?: ParamValues; assets?: AssetResolver; reducedMotion?: boolean; forceFallback?: boolean; fallbackImage?: string };
export type MotionHandle = { play(): void; pause(): void; destroy(): void; mode: 'webgl' | 'fallback'; warnings: string[] };

/**
 * Framework-agnostic embed runtime. The scene in the config is untrusted: it is migrated and
 * validated before rendering, parameter overrides go through the same governance rules as the
 * playground (locked values are ignored), and reduced-motion / no-WebGL viewers get a fallback.
 */
export function mountMotion(el: HTMLElement, config: EmbedConfig, opts: MountOptions = {}): MotionHandle {
  if (config.schema !== 'motion-os/embed@1') throw new Error(`Unsupported embed schema ${config.schema}`);
  const base = deserializeScene(config.scene);
  const { scene, errors } = applyParameters(base, { ...config.params, ...(opts.params ?? {}) });
  const warnings = errors.map((e) => `${e.key}: ${e.message}`);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', config.accessibility.label);
  el.style.position ||= 'relative';
  const fallback = () => {
    el.innerHTML = '';
    const f = document.createElement('div');
    f.style.cssText = `position:absolute;inset:0;background:${scene.canvas.background} ${opts.fallbackImage ? `center/cover url(${opts.fallbackImage})` : ''};`;
    el.appendChild(f);
    return { play() {}, pause() {}, destroy() { f.remove(); }, mode: 'fallback' as const, warnings };
  };
  if (opts.forceFallback) return fallback();
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) return fallback();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  el.appendChild(canvas);
  const clock = new Clock();
  let surface: MotionSurface;
  try { surface = new MotionSurface(canvas, clock, opts.assets ?? nullResolver, { interactive: true }); } catch { canvas.remove(); return fallback(); }
  surface.setDpr(Math.min(window.devicePixelRatio || 1, config.performance?.maxDpr ?? 2));
  surface.setScene(scene);
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const applyMotion = () => {
    const reduce = opts.reducedMotion ?? mq.matches;
    surface.setMotion(reduce ? (config.accessibility.reducedMotion === 'static' ? 'static' : 'reduced') : 'full');
  };
  applyMotion();
  mq.addEventListener('change', applyMotion);
  surface.start();
  return {
    play: () => clock.play(),
    pause: () => clock.pause(),
    destroy: () => { mq.removeEventListener('change', applyMotion); surface.dispose(); canvas.remove(); },
    mode: 'webgl',
    warnings,
  };
}
