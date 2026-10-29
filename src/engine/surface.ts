import type { SceneDocument } from '../../shared/scene/schema';
import type { AssetResolver } from './assets';
import { Clock } from './clock';
import { GPUContext } from './gpu';
import { SceneRenderer } from './renderer';
import type { MotionMode } from './layers/base';

export type SurfaceStatus = { lost: boolean; overloaded: boolean; quality: number };

/**
 * Drives one on-screen canvas: owns a GPUContext + SceneRenderer, sizes the drawing buffer from
 * CSS size × DPR × adaptive quality, pauses when hidden or offscreen, and recovers from context loss.
 */
export class MotionSurface {
  readonly gpu: GPUContext;
  readonly renderer: SceneRenderer;
  private raf = 0;
  private visible = true;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver;
  private intervals: number[] = [];
  private lastRaf = 0;
  private slowSince = 0;
  private fastSince = 0;
  private statusListeners = new Set<(s: SurfaceStatus) => void>();
  private frameListeners = new Set<(t: number) => void>();
  dpr: 'auto' | number = 'auto';
  adaptive = true;
  quality = 1;
  overloaded = false;

  constructor(readonly canvas: HTMLCanvasElement, readonly clock: Clock, assets: AssetResolver, opts: { interactive?: boolean } = {}) {
    this.gpu = new GPUContext(canvas, { alpha: false, antialias: true, preserveDrawingBuffer: true });
    this.renderer = new SceneRenderer(this.gpu, assets, opts);
    this.gpu.onContextChange((lost) => this.emitStatus(lost));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.clock.resetDelta(); });
      this.io.observe(canvas);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    canvas.addEventListener('pointermove', this.onPointer);
    canvas.addEventListener('pointerleave', this.onLeave);
    this.resize();
  }

  private onVisibility = () => { if (!document.hidden) this.clock.resetDelta(); };
  private onPointer = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.pointer.x = (e.clientX - r.left) / r.width;
    this.renderer.pointer.y = (e.clientY - r.top) / r.height;
    this.renderer.pointer.active = true;
  };
  private onLeave = () => { this.renderer.pointer.active = false; };

  setScene(doc: SceneDocument) {
    this.renderer.setScene(doc);
    this.clock.configure({ duration: doc.canvas.duration, loop: doc.canvas.loop, fps: doc.canvas.fps });
  }
  setMotion(m: MotionMode) { this.renderer.motion = m; }
  setDpr(v: 'auto' | number) { this.dpr = v; this.resize(); }

  private deviceDpr() { return this.dpr === 'auto' ? Math.min(window.devicePixelRatio || 1, 2) : this.dpr; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const s = this.deviceDpr() * this.quality;
    const w = Math.max(1, Math.round(r.width * s)), h = Math.max(1, Math.round(r.height * s));
    if (this.canvas.width !== w || this.canvas.height !== h) this.gpu.renderer.setSize(w, h, false);
  }

  start() {
    if (this.raf) return;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const t = this.clock.tick(now);
      if (!this.visible || document.hidden || this.gpu.lost) { this.lastRaf = 0; return; }
      this.adapt(now);
      this.renderer.render(t, { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height });
      this.renderer.metrics.quality = this.quality;
      this.frameListeners.forEach((f) => f(t));
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Adaptive preview quality: drop resolution when frames are slow, recover when fast. */
  private adapt(now: number) {
    if (this.lastRaf) {
      this.intervals.push(now - this.lastRaf);
      if (this.intervals.length > 40) this.intervals.shift();
    }
    this.lastRaf = now;
    if (!this.adaptive || this.intervals.length < 20) return;
    const avg = this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
    if (avg > 24) {
      this.fastSince = 0;
      this.slowSince ||= now;
      if (now - this.slowSince > 900) {
        if (this.quality > 0.5) { this.quality = Math.max(0.5, this.quality - 0.25); this.resize(); this.intervals = []; }
        else if (!this.overloaded && avg > 45) { this.overloaded = true; this.emitStatus(false); }
        this.slowSince = 0;
      }
    } else if (avg < 18) {
      this.slowSince = 0;
      this.fastSince ||= now;
      if (now - this.fastSince > 2500 && this.quality < 1) { this.quality = Math.min(1, this.quality + 0.25); this.resize(); this.fastSince = 0; this.intervals = []; }
      if (this.overloaded && avg < 20) { this.overloaded = false; this.emitStatus(false); }
    }
  }

  onStatus(fn: (s: SurfaceStatus) => void) { this.statusListeners.add(fn); return () => { this.statusListeners.delete(fn); }; }
  onFrame(fn: (t: number) => void) { this.frameListeners.add(fn); return () => { this.frameListeners.delete(fn); }; }
  private emitStatus(lost: boolean) { const s = { lost, overloaded: this.overloaded, quality: this.quality }; this.statusListeners.forEach((f) => f(s)); }

  /** Capture the current frame as a PNG blob (studio poster / quick snapshot). */
  snapshot(): Promise<Blob | null> { return new Promise((r) => this.canvas.toBlob(r, 'image/png')); }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro.disconnect();
    this.io?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('pointermove', this.onPointer);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.renderer.dispose();
    this.gpu.dispose();
  }
}
