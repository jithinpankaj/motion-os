import * as THREE from 'three';
import type { LayerOf } from '../../../shared/scene/schema';
import { hexToRgb, srgbToOklab } from '../../../shared/util/color';
import { FULLSCREEN_VERT, DEFAULT_SHADE, gradientFrag, validateShadeSnippet } from '../shaders';
import { applyBlend, loopPhase, type FrameContext, type LayerView } from './base';
import { hashString } from '../../../shared/util/random';

const MODES = ['linear', 'radial', 'mesh', 'aurora', 'noise', 'organic'];

export class GradientView implements LayerView {
  readonly scene = new THREE.Scene();
  readonly key: string;
  private mat: THREE.ShaderMaterial;
  private stops = Array.from({ length: 6 }, () => new THREE.Vector3());
  private pos = new Array(6).fill(0);
  private failed = false;

  constructor(layer: LayerOf<'gradient'>, ctx: FrameContext) {
    const custom = layer.props.customShader;
    this.key = gradientKey(layer);
    const body = custom && !validateShadeSnippet(custom) ? custom : DEFAULT_SHADE;
    if (custom && validateShadeSnippet(custom)) ctx.issue(layer.id, `Custom shader rejected: ${validateShadeSnippet(custom)}`);
    this.mat = this.makeMaterial(body);
    const quad = new THREE.Mesh(ctx.gpu.geometry('quad', () => new THREE.PlaneGeometry(1, 1)), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  private makeMaterial(body: string) {
    return new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: gradientFrag(body),
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) }, uStops: { value: this.stops }, uPos: { value: this.pos }, uCount: { value: 2 }, uMode: { value: 3 }, uInterp: { value: 2 },
        uAngle: { value: 0 }, uScale: { value: 1 }, uFreq: { value: 1 }, uAmp: { value: 0.5 }, uDistort: { value: 0.2 }, uGrain: { value: 0 }, uOpacity: { value: 1 },
        uSeed: { value: 0 }, uFrame: { value: 0 }, uTime: { value: 0 }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uPhase: { value: 0 }, uLoopRadius: { value: 0.6 }, uFlow: { value: new THREE.Vector2(1, 0) },
      },
    });
  }

  onShaderError() {
    if (this.failed) return;
    this.failed = true;
    const old = this.mat;
    this.mat = this.makeMaterial(DEFAULT_SHADE);
    (this.scene.children[0] as THREE.Mesh).material = this.mat;
    old.dispose();
  }

  camera(ctx: FrameContext) { return ctx.ortho; }

  sync(layer: LayerOf<'gradient'>, ctx: FrameContext) {
    const p = layer.props, u = this.mat.uniforms;
    const reduced = ctx.motion === 'reduced';
    applyBlend(this.mat, layer.blend);
    u.uResolution.value.set(ctx.width, ctx.height);
    const oklab = p.interpolation === 'oklab';
    const stops = p.stops.slice().sort((a, b) => a.pos - b.pos);
    stops.forEach((s, i) => {
      const c = hexToRgb(s.color);
      const v = oklab ? srgbToOklab(c) : c;
      this.stops[i].set(v[0], v[1], v[2]);
      this.pos[i] = s.pos;
    });
    u.uCount.value = stops.length;
    u.uMode.value = MODES.indexOf(p.mode);
    u.uInterp.value = oklab ? 2 : p.interpolation === 'smooth' ? 1 : 0;
    u.uAngle.value = p.angle;
    u.uScale.value = p.scale;
    u.uCenter.value.set(p.center.x, p.center.y);
    u.uFreq.value = p.noiseFreq;
    u.uAmp.value = p.noiseAmp * (reduced ? 0.5 : 1);
    u.uDistort.value = p.distortion * (reduced ? 0.5 : 1);
    u.uGrain.value = p.grain * 0.18;
    u.uOpacity.value = layer.opacity;
    u.uSeed.value = (hashString(layer.id) % 1000) / 10 + ctx.doc.seed % 97;
    u.uPhase.value = ctx.motion === 'static' ? 0.6 : loopPhase(ctx, reduced ? 1 : p.speed);
    u.uLoopRadius.value = 0.35 + 0.35 * Math.min(1, p.speed / 2);
    const fa = (p.flowAngle * Math.PI) / 180;
    u.uFlow.value.set(Math.cos(fa), Math.sin(fa));
    u.uFrame.value = ctx.motion === 'static' ? 0 : ctx.frame % 997;
    u.uTime.value = ctx.t;
  }

  async ready() {}
  dispose() { this.mat.dispose(); }
}

export const gradientKey = (l: LayerOf<'gradient'>) => `gradient:${l.props.customShader ?? ''}`;
