import * as THREE from 'three';
import type { Layer, SceneDocument } from '../../shared/scene/schema';
import { evaluateLayers, normaliseTime } from '../../shared/timeline';
import { hexToRgb } from '../../shared/util/color';
import type { AssetResolver } from './assets';
import type { GPUContext } from './gpu';
import type { Bounds, FrameContext, LayerView, MotionMode } from './layers/base';
import { GradientView, gradientKey } from './layers/gradient';
import { MeshView, meshKey } from './layers/mesh';
import { ParticleView, particleKey } from './layers/particles';
import { TextView, textKey } from './layers/text';
import { ImageView, imageKey } from './layers/image';
import { ShapeView } from './layers/shape';

export type Issue = { layerId: string; message: string };
export type Metrics = { fps: number; frameMs: number; drawCalls: number; triangles: number; points: number; textureMB: number; compileMs: number; views: number; quality: number };

const structuralKey = (l: Layer, ctx: { doc: SceneDocument }) =>
  l.type === 'gradient' ? gradientKey(l) : l.type === 'mesh' ? meshKey(l) : l.type === 'particles' ? particleKey(l, ctx) : l.type === 'text' ? textKey(l) : l.type === 'image' ? imageKey(l) : l.type === 'shape' ? 'shape' : 'group';

/** Compose group transforms/visibility/opacity into child layers (2D layers only). */
export function resolveHierarchy(layers: Layer[]): Layer[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  return layers.map((l) => {
    let cur = l.parentId ? byId.get(l.parentId) : undefined;
    if (!cur) return l;
    let { x, y, rotation, scale } = l.transform;
    let opacity = l.opacity, visible = l.visible;
    // The 2×2 linear part (rotation and stretch without the uniform scale), applied child-first.
    let m = linear(rotation, l.transform.scaleX, l.transform.scaleY);
    let stretched = l.transform.scaleX !== 1 || l.transform.scaleY !== 1;
    let hops = 0;
    while (cur && hops++ < 32) {
      const g = cur.transform;
      const r = (g.rotation * Math.PI) / 180;
      // A group's squash/stretch moves its children apart along the group's own axes.
      const dx = (x - 0.5) * g.scale * g.scaleX, dy = (y - 0.5) * g.scale * g.scaleY;
      x = g.x + dx * Math.cos(r) - dy * Math.sin(r);
      y = g.y + dx * Math.sin(r) + dy * Math.cos(r);
      rotation += g.rotation;
      scale *= g.scale;
      m = mul(linear(g.rotation, g.scaleX, g.scaleY), m);
      stretched ||= g.scaleX !== 1 || g.scaleY !== 1;
      opacity *= cur.opacity;
      visible = visible && cur.visible;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    if (!stretched) return { ...l, transform: { x, y, rotation, scale, scaleX: 1, scaleY: 1 }, opacity, visible };
    const circle = l.type === 'shape' && l.props.kind === 'ellipse' && Math.abs(l.props.width - l.props.height) < 1e-6;
    return { ...l, transform: { x, y, scale, ...decompose(m, rotation, circle) }, opacity, visible };
  });
}

type M2 = [number, number, number, number]; // [a, b, c, d] = [[a, b], [c, d]], columns are the images of the x and y axes
const linear = (deg: number, sx: number, sy: number): M2 => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c * sx, -s * sy, s * sx, c * sy];
};
const mul = (p: M2, q: M2): M2 => [p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3], p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3]];

/**
 * Rotation + stretch for a composed transform. A layer turned inside a stretched group would really
 * be skewed, which a layer can't show. Circles get the exact ellipse (singular value decomposition);
 * everything else keeps its own x-axis exactly — direction and length — and only loses the skew, so
 * lines keep pointing the right way and text stays upright.
 */
function decompose([a, b, c, d]: M2, hint: number, circle: boolean) {
  let rot: number, sx: number, sy: number;
  if (circle) {
    const E = (a + d) / 2, F = (a - d) / 2, G = (c + b) / 2, H = (c - b) / 2;
    const Q = Math.hypot(E, H), R = Math.hypot(F, G);
    rot = (Math.atan2(H, E) + Math.atan2(G, F)) / 2;
    sx = Q + R; sy = Math.abs(Q - R);
  } else {
    sx = Math.hypot(a, c);
    rot = sx > 1e-9 ? Math.atan2(c, a) : (hint * Math.PI) / 180;
    sy = Math.abs(a * d - b * c) / Math.max(sx, 1e-9);
  }
  // Keep the rotation in the same turn as the plain sum, so animated spins stay continuous.
  let deg = (rot * 180) / Math.PI;
  deg += Math.round((hint - deg) / 360) * 360;
  return { rotation: deg, scaleX: Math.max(1e-4, sx), scaleY: Math.max(1e-4, sy) };
}

/**
 * Renders one scene document into a GPUContext. setScene() diffs layer views: ordinary property
 * edits become uniform writes on the next frame; only structural changes rebuild a view, and the
 * clock is never touched, so playback continues through every edit.
 */
export class SceneRenderer {
  private doc: SceneDocument | null = null;
  private views = new Map<string, LayerView>();
  private ortho = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  private perspective = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  private issues = new Map<string, string>();
  private issueListeners = new Set<(issues: Issue[]) => void>();
  private lastFrameAt = 0;
  private frameTimes: number[] = [];
  private disposeCtx: () => void;
  pointer = { x: 0.5, y: 0.5, active: false };
  /**
   * Optional source of per-frame layer values. The interaction runtime and the move editor plug in
   * here; without it the scene's own timeline is evaluated at time t.
   */
  layerSource: ((doc: SceneDocument, t: number) => Layer[]) | null = null;
  motion: MotionMode = 'full';
  metrics: Metrics = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, points: 0, textureMB: 0, compileMs: 0, views: 0, quality: 1 };

  constructor(readonly gpu: GPUContext, private assets: AssetResolver, private opts: { interactive?: boolean } = {}) {
    this.disposeCtx = gpu.onContextChange((lost) => { if (!lost) this.rebuild(); });
  }

  setAssets(assets: AssetResolver) {
    if (assets === this.assets) return;
    this.assets = assets;
    this.rebuild();
  }

  setScene(doc: SceneDocument) {
    const prev = this.doc;
    this.doc = doc;
    if (prev && prev.seed !== doc.seed) this.rebuild();
  }

  get scene() { return this.doc; }

  /** Drop every GPU-side view; they are recreated from the document on the next frame. */
  rebuild() {
    this.views.forEach((v) => v.dispose());
    this.views.clear();
  }

  onIssues(fn: (issues: Issue[]) => void) { this.issueListeners.add(fn); return () => { this.issueListeners.delete(fn); }; }
  getIssues(): Issue[] { return [...this.issues].map(([layerId, message]) => ({ layerId, message })); }
  private setIssue = (layerId: string, message: string | null) => {
    if ((this.issues.get(layerId) ?? null) === message) return;
    message ? this.issues.set(layerId, message) : this.issues.delete(layerId);
    const list = this.getIssues();
    this.issueListeners.forEach((f) => f(list));
  };

  private frameContext(t: number, width: number, height: number, renderScale: number): FrameContext {
    const doc = this.doc!;
    const tt = this.motion === 'static' ? doc.fallback.staticFrame : normaliseTime(doc, t);
    return {
      doc, t: tt, phase: (tt / doc.canvas.duration) * Math.PI * 2, frame: Math.round(tt * doc.canvas.fps),
      width, height, minDim: Math.min(width, height), renderScale,
      pointer: this.pointer, interactive: !!this.opts.interactive, motion: this.motion,
      gpu: this.gpu, assets: this.assets, ortho: this.ortho, perspective: this.perspective, issue: this.setIssue,
    };
  }

  private updateCameras(doc: SceneDocument, w: number, h: number) {
    this.ortho.left = 0; this.ortho.right = w; this.ortho.top = 0; this.ortho.bottom = -h;
    this.ortho.updateProjectionMatrix();
    const c = doc.canvas.camera;
    this.perspective.fov = c.fov;
    this.perspective.aspect = w / h;
    const yaw = (c.yaw * Math.PI) / 180, pitch = (c.pitch * Math.PI) / 180;
    this.perspective.position.set(Math.sin(yaw) * Math.cos(pitch) * c.distance, Math.sin(pitch) * c.distance, Math.cos(yaw) * Math.cos(pitch) * c.distance);
    this.perspective.lookAt(0, 0, 0);
    this.perspective.updateProjectionMatrix();
    this.perspective.updateMatrixWorld();
  }

  /**
   * Draw the scene at time t into the given device-pixel viewport of the GPU canvas.
   * `clear` paints the background; pass `transparent` for alpha exports.
   */
  render(t: number, viewport: { x: number; y: number; w: number; h: number }, opts: { transparent?: boolean; background?: string | null } = {}) {
    const doc = this.doc;
    if (!doc || this.gpu.lost) return;
    const start = performance.now();
    const { renderer } = this.gpu;
    const W = doc.canvas.width, H = doc.canvas.height;
    const renderScale = viewport.h / H;
    const ctx = this.frameContext(t, W, H, renderScale);
    this.updateCameras(doc, W, H);
    renderer.setViewport(viewport.x, viewport.y, viewport.w, viewport.h);
    renderer.setScissor(viewport.x, viewport.y, viewport.w, viewport.h);
    renderer.setScissorTest(true);
    const bg = opts.background ?? doc.canvas.background;
    const [r, g, b] = hexToRgb(bg);
    renderer.setClearColor(new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace), opts.transparent ? 0 : 1);
    renderer.clear(true, true, false);
    renderer.info.reset();

    const layers = resolveHierarchy(this.layerSource ? this.layerSource(doc, ctx.t) : evaluateLayers(doc, ctx.t));
    const alive = new Set<string>();
    let compile = 0;
    for (const layer of layers) {
      if (layer.type === 'group') continue;
      alive.add(layer.id);
      const key = structuralKey(layer, ctx);
      let view = this.views.get(layer.id);
      if (view && view.key !== key) { view.dispose(); view = undefined; }
      if (!view) {
        const t0 = performance.now();
        try { view = this.createView(layer, ctx); } catch (e: any) { this.setIssue(layer.id, `Layer failed to build: ${e.message}`); continue; }
        this.views.set(layer.id, view);
        compile += performance.now() - t0;
      }
      if (!layer.visible || layer.opacity <= 0) continue;
      try {
        view.sync(layer as any, ctx);
        this.gpu.currentView = layer.id;
        const programsBefore = renderer.info.programs?.length ?? 0;
        const c0 = performance.now();
        renderer.render(view.scene, view.camera(ctx));
        if ((renderer.info.programs?.length ?? 0) > programsBefore) compile += performance.now() - c0;
        const err = this.gpu.shaderErrors.get(layer.id);
        if (err) {
          this.gpu.shaderErrors.delete(layer.id);
          this.setIssue(layer.id, `Shader failed to compile — reverted to the built-in shader. ${err.split('\n')[0]}`);
          view.onShaderError?.(err);
        }
      } catch (e: any) {
        // Render error boundary: one broken layer never takes the canvas down.
        this.setIssue(layer.id, `Render error: ${e.message}`);
      }
    }
    this.gpu.currentView = null;
    for (const [id, v] of this.views) if (!alive.has(id)) { v.dispose(); this.views.delete(id); this.setIssue(id, null); }
    renderer.setScissorTest(false);

    const end = performance.now();
    const info = renderer.info.render;
    if (compile > 0) this.metrics.compileMs = compile;
    this.metrics.frameMs = end - start;
    this.metrics.drawCalls = info.calls;
    this.metrics.triangles = info.triangles;
    this.metrics.points = info.points;
    this.metrics.textureMB = this.gpu.textureBytes() / 1048576;
    this.metrics.views = this.views.size;
    if (this.lastFrameAt) {
      this.frameTimes.push(end - this.lastFrameAt);
      if (this.frameTimes.length > 60) this.frameTimes.shift();
      this.metrics.fps = 1000 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);
    }
    this.lastFrameAt = end;
  }

  private createView(layer: Layer, ctx: FrameContext): LayerView {
    switch (layer.type) {
      case 'gradient': return new GradientView(layer, ctx);
      case 'mesh': return new MeshView(layer, ctx);
      case 'particles': return new ParticleView(layer, ctx);
      case 'text': return new TextView(layer, ctx);
      case 'image': return new ImageView(layer, ctx);
      case 'shape': return new ShapeView(layer, ctx);
      default: throw new Error('unknown layer');
    }
  }

  /** Resolve once fonts and textures for every view are loaded (exports call this first). */
  async ready(t = 0) {
    if (!this.doc) return;
    // Build views by rendering once into a 1px viewport, then await their resources.
    this.render(t, { x: 0, y: 0, w: 1, h: 1 });
    await Promise.all([...this.views.values()].map((v) => v.ready().catch(() => {})));
    this.render(t, { x: 0, y: 0, w: 1, h: 1 });
    await Promise.all([...this.views.values()].map((v) => v.ready().catch(() => {})));
  }

  bounds(layerId: string): Bounds | null { return this.views.get(layerId)?.bounds?.() ?? null; }

  dispose() {
    this.disposeCtx();
    this.rebuild();
    this.issueListeners.clear();
  }
}
