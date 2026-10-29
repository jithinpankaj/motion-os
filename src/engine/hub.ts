import type { SceneDocument } from '../../shared/scene/schema';
import type { AssetResolver } from './assets';
import { Clock } from './clock';
import { GPUContext } from './gpu';
import { SceneRenderer } from './renderer';

export type PreviewMode = 'live' | 'low' | 'poster' | 'off';
type Entry = {
  id: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  doc: SceneDocument;
  assets: AssetResolver;
  mode: PreviewMode;
  renderer: SceneRenderer | null;
  drawnOnce: boolean;
  lastDraw: number;
  lastUsed: number;
  dirty: boolean;
};

const MAX_RENDERERS = 10;   // GPU-side scene states kept warm (LRU)
const LOW_FPS = 12;
const BUDGET_MS = 5;

/**
 * Intelligent preview scheduler: one WebGL context renders every thumbnail/preview on the page and
 * blits into per-card 2D canvases. Posters first, low-res round-robin for visible cards, full-rate
 * rendering only for the hovered/active card. Offscreen cards cost nothing.
 */
export class RenderHub {
  readonly gpu: GPUContext;
  readonly clock = new Clock();
  private glCanvas = document.createElement('canvas');
  private entries = new Map<number, Entry>();
  private seq = 0;
  private raf = 0;
  private rr = 0;
  reducedMotion = false;

  constructor() {
    this.glCanvas.width = 512;
    this.glCanvas.height = 512;
    this.gpu = new GPUContext(this.glCanvas, { alpha: false, antialias: true });
    this.clock.duration = 8;
    this.gpu.onContextChange((lost) => { if (!lost) this.entries.forEach((e) => (e.dirty = true)); });
  }

  register(canvas: HTMLCanvasElement, doc: SceneDocument, assets: AssetResolver, mode: PreviewMode = 'off') {
    const id = ++this.seq;
    this.entries.set(id, { id, canvas, ctx: canvas.getContext('2d')!, doc, assets, mode, renderer: null, drawnOnce: false, lastDraw: 0, lastUsed: performance.now(), dirty: true });
    this.ensureLoop();
    return {
      update: (d: SceneDocument) => { const e = this.entries.get(id); if (e) { e.doc = d; e.dirty = true; e.renderer?.setScene(d); } },
      setMode: (m: PreviewMode) => { const e = this.entries.get(id); if (e && e.mode !== m) { e.mode = m; e.dirty = true; } },
      setAssets: (a: AssetResolver) => { const e = this.entries.get(id); if (e) { e.assets = a; e.renderer?.setAssets(a); e.dirty = true; } },
      dispose: () => { const e = this.entries.get(id); e?.renderer?.dispose(); this.entries.delete(id); },
    };
  }

  private ensureLoop() {
    if (this.raf) return;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (document.hidden || this.gpu.lost) { this.clock.resetDelta(); return; }
      const t = this.clock.tick(now);
      const list = [...this.entries.values()];
      const started = performance.now();
      // 1. live entries every frame, 2. never-drawn posters, 3. low-rate round robin within budget
      for (const e of list) if (e.mode === 'live' && !this.reducedMotion) this.draw(e, t, 1);
      for (const e of list) if (e.mode !== 'off' && (!e.drawnOnce || (e.dirty && e.mode === 'poster'))) { this.draw(e, e.doc.export.posterTime, 0.75, true); if (performance.now() - started > BUDGET_MS * 2) break; }
      if (!this.reducedMotion) {
        const low = list.filter((e) => e.mode === 'low');
        for (let i = 0; i < low.length && performance.now() - started < BUDGET_MS; i++) {
          const e = low[(this.rr + i) % low.length];
          if (now - e.lastDraw >= 1000 / LOW_FPS) this.draw(e, t, 0.5);
        }
        this.rr++;
      }
      this.evict();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private draw(e: Entry, t: number, scale: number, poster = false) {
    const rect = e.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(rect.width * dpr), ch = Math.round(rect.height * dpr);
    if (e.canvas.width !== cw || e.canvas.height !== ch) { e.canvas.width = cw; e.canvas.height = ch; }
    const w = Math.max(1, Math.round(cw * scale)), h = Math.max(1, Math.round(ch * scale));
    if (this.glCanvas.width < w || this.glCanvas.height < h) {
      this.gpu.renderer.setSize(Math.max(this.glCanvas.width, w), Math.max(this.glCanvas.height, h), false);
    }
    if (!e.renderer) { e.renderer = new SceneRenderer(this.gpu, e.assets); e.renderer.setScene(e.doc); }
    e.renderer.motion = this.reducedMotion ? 'static' : 'full';
    e.renderer.render(this.reducedMotion ? e.doc.fallback.staticFrame : poster ? e.doc.export.posterTime : t, { x: 0, y: this.glCanvas.height - h, w, h });
    e.ctx.drawImage(this.glCanvas, 0, 0, w, h, 0, 0, cw, ch);
    e.drawnOnce = true;
    e.dirty = false;
    e.lastDraw = performance.now();
    e.lastUsed = e.lastDraw;
  }

  private evict() {
    const warm = [...this.entries.values()].filter((e) => e.renderer).sort((a, b) => a.lastUsed - b.lastUsed);
    while (warm.length > MAX_RENDERERS) {
      const e = warm.shift()!;
      if (e.mode === 'live') continue;
      e.renderer!.dispose();
      e.renderer = null;   // its 2D canvas keeps the last frame as a poster
    }
  }
}

let hub: RenderHub | null = null;
export const getHub = () => (hub ??= new RenderHub());
