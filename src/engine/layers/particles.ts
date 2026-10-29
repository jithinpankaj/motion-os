import * as THREE from 'three';
import type { LayerOf } from '../../../shared/scene/schema';
import { mulberry32, hashString } from '../../../shared/util/random';
import { PARTICLE_FRAG, PARTICLE_VERT } from '../shaders';
import { applyBlend, setRgb, type FrameContext, type LayerView } from './base';

const SHAPES = ['circle', 'square', 'ring', 'spark'];

/**
 * GPU particles. Positions are a closed-form function of (seed, t) computed in the vertex shader,
 * so any frame can be rendered independently and exports are deterministic.
 */
export class ParticleView implements LayerView {
  readonly scene = new THREE.Scene();
  readonly key: string;
  private mat: THREE.ShaderMaterial;
  private geo: THREE.BufferGeometry;
  private attr = Array.from({ length: 8 }, () => new THREE.Vector3());

  constructor(layer: LayerOf<'particles'>, ctx: FrameContext) {
    this.key = particleKey(layer, ctx);
    const n = layer.props.count;
    const rand = mulberry32(ctx.doc.seed ^ hashString(layer.id));
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uRes: { value: new THREE.Vector2() }, uTimeP: { value: 0 }, uLife: { value: 4 }, uCycles: { value: 1 }, uVel: { value: 0 }, uDir: { value: 90 }, uSpread: { value: 360 },
        uGravity: { value: 0 }, uNoiseAmt: { value: 0 }, uSize: { value: 2 }, uScale: { value: 1 }, uEmitter: { value: new THREE.Vector2() }, uEmitSize: { value: new THREE.Vector2() },
        uAttr: { value: this.attr }, uAttrCount: { value: 0 }, uPointer: { value: new THREE.Vector3() },
        uColorA: { value: new THREE.Vector3() }, uColorB: { value: new THREE.Vector3() }, uOpacity: { value: 1 }, uShape: { value: 0 },
      },
    });
    const pts = new THREE.Points(this.geo, this.mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  camera(ctx: FrameContext) { return ctx.ortho; }

  sync(layer: LayerOf<'particles'>, ctx: FrameContext) {
    const p = layer.props, u = this.mat.uniforms;
    const reduced = ctx.motion === 'reduced';
    applyBlend(this.mat, layer.blend);
    const d = ctx.doc.canvas.duration;
    // Quantise lifetime so duration / lifetime is an integer: particles respawn identically each loop.
    const cycles = ctx.doc.canvas.loop ? Math.max(1, Math.round(d / p.lifetime)) : 1e6;
    u.uLife.value = ctx.doc.canvas.loop ? d / cycles : p.lifetime;
    u.uCycles.value = cycles;
    u.uRes.value.set(ctx.width, ctx.height);
    u.uTimeP.value = ctx.motion === 'static' ? ctx.doc.fallback.staticFrame : ctx.t;
    u.uVel.value = p.velocity * (reduced ? 0.3 : 1);
    u.uDir.value = p.direction;
    u.uSpread.value = p.spread;
    u.uGravity.value = p.gravity;
    u.uNoiseAmt.value = p.noise * (reduced ? 0.3 : 1);
    u.uSize.value = p.size;
    u.uScale.value = ctx.renderScale * Math.max(0.5, ctx.minDim / 1080);
    u.uEmitter.value.set(p.emitter.x, p.emitter.y);
    u.uEmitSize.value.set(p.emitterSize.x, p.emitterSize.y);
    p.attractors.forEach((a, i) => this.attr[i].set(a.x, a.y, a.strength));
    u.uAttrCount.value = p.attractors.length;
    const sign = p.pointer === 'repel' ? 1 : p.pointer === 'attract' ? -1 : 0;
    const active = ctx.interactive && ctx.pointer.active && sign !== 0;
    u.uPointer.value.set(ctx.pointer.x, ctx.pointer.y, active ? sign * p.pointerStrength : 0);
    setRgb(u.uColorA.value, p.colorA);
    setRgb(u.uColorB.value, p.colorB);
    u.uOpacity.value = layer.opacity;
    u.uShape.value = SHAPES.indexOf(p.shape);
  }

  async ready() {}
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

export const particleKey = (l: LayerOf<'particles'>, ctx: { doc: { seed: number } }) => `particles:${l.props.count}:${ctx.doc.seed}`;
