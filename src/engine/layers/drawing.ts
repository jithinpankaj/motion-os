import * as THREE from 'three';
import type { LayerOf } from '../../../shared/scene/schema';
import { QUAD_VERT, TEXT_FRAG } from '../shaders';
import { paintStrokes } from '../strokes';
import { applyBlend, placeQuad, type Bounds, type FrameContext, type LayerView } from './base';

/** A freehand drawing: its strokes painted into a texture sized to the drawing box. */
const MAX_TEX = 2048;
const makeCanvas = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

export class DrawingView implements LayerView {
  readonly scene = new THREE.Scene();
  readonly key = 'drawing';
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private tex: THREE.CanvasTexture | null = null;
  private sig = '';
  private strokesRef: unknown = null;
  private lastBounds: Bounds | null = null;

  constructor(_layer: LayerOf<'drawing'>, ctx: FrameContext) {
    this.mat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: TEXT_FRAG, uniforms: { uTex: { value: null }, uOpacity: { value: 1 } } });
    this.mesh = new THREE.Mesh(ctx.gpu.geometry('quad', () => new THREE.PlaneGeometry(1, 1)), this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  camera(ctx: FrameContext) { return ctx.ortho; }

  sync(layer: LayerOf<'drawing'>, ctx: FrameContext) {
    const p = layer.props;
    applyBlend(this.mat, layer.blend);
    this.mat.uniforms.uOpacity.value = layer.opacity;
    // Texture resolution follows the on-screen size (render scale × layer scale), capped.
    const want = ctx.renderScale * Math.max(0.25, layer.transform.scale * Math.max(layer.transform.scaleX, layer.transform.scaleY));
    const k = Math.min(want, MAX_TEX / Math.max(p.width, p.height));
    const cw = Math.max(2, Math.ceil(p.width * k)), ch = Math.max(2, Math.ceil(p.height * k));
    if (!this.canvas || this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas = makeCanvas(cw, ch);
      this.tex?.dispose();
      this.tex = new THREE.CanvasTexture(this.canvas as any);
      this.tex.colorSpace = THREE.NoColorSpace;
      this.tex.minFilter = THREE.LinearFilter;
      this.tex.generateMipmaps = false;
      this.mat.uniforms.uTex.value = this.tex;
      this.sig = '';
    }
    const sig = `${cw}x${ch}|${p.reveal.toFixed(4)}|${p.thickness.toFixed(3)}`;
    if (sig !== this.sig || p.strokes !== this.strokesRef) {
      this.sig = sig; this.strokesRef = p.strokes;
      const g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
      g.clearRect(0, 0, cw, ch);
      paintStrokes(g, p.strokes, { scale: k, reveal: p.reveal, thickness: p.thickness });
      this.tex!.needsUpdate = true;
    }
    placeQuad(this.mesh, layer, ctx, p.width, p.height);
    this.lastBounds = { cx: layer.transform.x * ctx.width, cy: layer.transform.y * ctx.height, w: p.width * layer.transform.scale * layer.transform.scaleX, h: p.height * layer.transform.scale * layer.transform.scaleY, rotation: layer.transform.rotation };
  }

  bounds() { return this.lastBounds; }
  async ready() {}
  dispose() { this.mat.dispose(); this.tex?.dispose(); }
}
