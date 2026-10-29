import * as THREE from 'three';
import type { LayerOf } from '../../../shared/scene/schema';
import { ease } from '../../../shared/util/easing';
import { IMAGE_FRAG, QUAD_VERT } from '../shaders';
import { applyBlend, loopPhase, placeQuad, revealProgress, type Bounds, type FrameContext, type LayerView } from './base';

const FIT = ['cover', 'contain', 'fill'];
const MASK = ['none', 'circle', 'rounded', 'fade'];
const REVEAL = ['none', 'fade', 'wipe', 'scale', 'iris'];

export class ImageView implements LayerView {
  readonly scene = new THREE.Scene();
  readonly key: string;
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private texKey: string | null = null;
  private assetId: string | null | undefined = undefined;
  private loading: Promise<void> = Promise.resolve();
  private imgAspect = 1;
  private lastBounds: Bounds | null = null;

  constructor(layer: LayerOf<'image'>, private ctx: FrameContext) {
    this.key = imageKey(layer);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: IMAGE_FRAG,
      uniforms: {
        uTex: { value: null }, uHasTex: { value: 0 }, uImgAspect: { value: 1 }, uBoxAspect: { value: 1 }, uOpacity: { value: 1 }, uRadius: { value: 0 }, uDisp: { value: 0 }, uReveal: { value: 1 },
        uFit: { value: 0 }, uMask: { value: 0 }, uRevealMode: { value: 0 }, uCrop: { value: new THREE.Vector4(0, 0, 1, 1) }, uFocal: { value: new THREE.Vector2(0.5, 0.5) },
        uPhase: { value: 0 }, uLoopRadius: { value: 0.5 }, uFlow: { value: new THREE.Vector2(1, 0) },
      },
    });
    this.mesh = new THREE.Mesh(ctx.gpu.geometry('quad', () => new THREE.PlaneGeometry(1, 1)), this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  camera(ctx: FrameContext) { return ctx.ortho; }

  sync(layer: LayerOf<'image'>, ctx: FrameContext) {
    const p = layer.props, u = this.mat.uniforms;
    if (p.assetId !== this.assetId) this.load(p.assetId, layer.id);
    applyBlend(this.mat, layer.blend);
    const wPx = p.width * ctx.minDim, hPx = p.height * ctx.minDim;
    const r = p.reveal;
    const prog = r.preset === 'none' ? 1 : ease(r.easing, revealProgress(ctx, r.start, r.duration, ctx.doc.canvas.loop));
    const mode = ctx.motion === 'reduced' && r.preset !== 'none' ? 1 : REVEAL.indexOf(r.preset);
    u.uReveal.value = prog;
    u.uRevealMode.value = mode;
    u.uBoxAspect.value = wPx / hPx;
    u.uImgAspect.value = this.imgAspect;
    u.uFit.value = FIT.indexOf(p.fit);
    u.uMask.value = MASK.indexOf(p.mask);
    u.uRadius.value = p.radius;
    u.uCrop.value.set(p.crop.x, p.crop.y, p.crop.w, p.crop.h);
    u.uFocal.value.set(ctx.doc.responsive.focalPoint.x, ctx.doc.responsive.focalPoint.y);
    u.uDisp.value = ctx.motion === 'full' ? p.displacement : 0;
    u.uPhase.value = loopPhase(ctx, p.displacementSpeed);
    u.uOpacity.value = layer.opacity;
    placeQuad(this.mesh, layer, ctx, wPx, hPx, mode === 3 ? 0.86 + 0.14 * prog : 1);
    this.lastBounds = { cx: layer.transform.x * ctx.width, cy: layer.transform.y * ctx.height, w: wPx * layer.transform.scale, h: hPx * layer.transform.scale, rotation: layer.transform.rotation };
  }

  private load(assetId: string | null, layerId: string) {
    this.assetId = assetId;
    if (this.texKey) { this.ctx.gpu.releaseTexture(this.texKey); this.texKey = null; }
    this.mat.uniforms.uHasTex.value = 0;
    if (!assetId) { this.ctx.issue(layerId, 'No image selected'); return; }
    this.loading = this.ctx.gpu.texture(assetId, this.ctx.assets).then((r) => {
      if (this.assetId !== assetId) { if ('tex' in r) this.ctx.gpu.releaseTexture(r.key); return; }
      if ('missing' in r) { this.ctx.issue(layerId, 'Image asset is missing or was deleted — choose a replacement'); return; }
      this.texKey = r.key;
      const img = r.tex.image as { width: number; height: number };
      this.imgAspect = img.width / img.height;
      this.mat.uniforms.uTex.value = r.tex;
      this.mat.uniforms.uHasTex.value = 1;
      const want = this.mat.uniforms.uBoxAspect.value as number;
      this.ctx.issue(layerId, Math.abs(Math.log(this.imgAspect / want)) > 0.6 && this.mat.uniforms.uFit.value === 2 ? 'Image aspect ratio differs strongly from its frame; “Fill” will stretch it — use Cover or Contain' : null);
    });
  }

  bounds() { return this.lastBounds; }
  ready() { return this.loading; }
  dispose() { this.mat.dispose(); if (this.texKey) this.ctx.gpu.releaseTexture(this.texKey); }
}

export const imageKey = (_l: LayerOf<'image'>) => 'image';
