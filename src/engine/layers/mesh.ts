import * as THREE from 'three';
import type { LayerOf } from '../../../shared/scene/schema';
import { MESH_FRAG, MESH_VERT } from '../shaders';
import { applyBlend, loopPhase, setRgb, type FrameContext, type LayerView } from './base';

const DEG = Math.PI / 180;

function makeGeometry(kind: string, detail: number): THREE.BufferGeometry {
  switch (kind) {
    case 'plane': return new THREE.PlaneGeometry(2.4, 2.4, detail, detail);
    case 'torus': return new THREE.TorusGeometry(0.85, 0.34, Math.max(8, detail >> 1), detail);
    case 'cylinder': return new THREE.CylinderGeometry(0.75, 0.75, 1.7, detail, Math.max(4, detail >> 2), false);
    default: return new THREE.SphereGeometry(1, detail, Math.max(6, detail >> 1));
  }
}

export class MeshView implements LayerView {
  readonly scene = new THREE.Scene();
  readonly key: string;
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private texKey: string | null = null;
  private texAsset: string | null = null;
  private loading: Promise<void> = Promise.resolve();

  constructor(layer: LayerOf<'mesh'>, private ctx: FrameContext) {
    this.key = meshKey(layer);
    const { kind, detail } = layer.props.geometry;
    const geo = ctx.gpu.geometry(`mesh:${kind}:${detail}`, () => makeGeometry(kind, detail));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: MESH_VERT,
      fragmentShader: MESH_FRAG,
      uniforms: {
        uDispAmount: { value: 0 }, uDispFreq: { value: 1 }, uPhase: { value: 0 }, uLoopRadius: { value: 0.6 }, uFlow: { value: new THREE.Vector2(0.7, 0.7) },
        uColor: { value: new THREE.Vector3() }, uColor2: { value: new THREE.Vector3() }, uLightColor: { value: new THREE.Vector3(1, 1, 1) }, uLightDir: { value: new THREE.Vector3(0.5, 0.6, 1) },
        uRough: { value: 0.4 }, uFresnel: { value: 1 }, uIrid: { value: 0 }, uIntensity: { value: 1 }, uAmbient: { value: 0.2 }, uOpacity: { value: 1 },
        uTexMix: { value: 0 }, uHasTex: { value: 0 }, uTex: { value: null },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  camera(ctx: FrameContext) { return ctx.perspective; }

  sync(layer: LayerOf<'mesh'>, ctx: FrameContext) {
    const p = layer.props, u = this.mat.uniforms;
    const reduced = ctx.motion === 'reduced', still = ctx.motion === 'static';
    applyBlend(this.mat, layer.blend);
    this.mat.wireframe = p.material.wireframe;
    this.mat.side = p.geometry.kind === 'plane' ? THREE.DoubleSide : THREE.FrontSide;
    u.uDispAmount.value = p.displacement.amount * (reduced ? 0.4 : 1);
    u.uDispFreq.value = p.displacement.frequency;
    u.uPhase.value = still ? 0.6 : loopPhase(ctx, reduced ? 1 : p.displacement.speed);
    u.uLoopRadius.value = 0.5;
    setRgb(u.uColor.value, p.material.color);
    setRgb(u.uColor2.value, p.material.color2);
    setRgb(u.uLightColor.value, p.light.color);
    const az = p.light.azimuth * DEG, el = p.light.elevation * DEG;
    u.uLightDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    u.uLightDir.value.applyMatrix3(new THREE.Matrix3().setFromMatrix4(ctx.perspective.matrixWorldInverse));
    u.uRough.value = p.material.roughness;
    u.uFresnel.value = p.material.fresnel;
    u.uIrid.value = p.material.iridescence;
    u.uIntensity.value = p.light.intensity;
    u.uAmbient.value = p.light.ambient;
    u.uOpacity.value = layer.opacity;
    u.uTexMix.value = p.material.textureMix;
    // Rotation = base + whole turns per loop (spin), so the loop closes exactly.
    const turns = still || reduced ? 0 : ctx.doc.canvas.loop ? ctx.phase / (Math.PI * 2) : ctx.t / ctx.doc.canvas.duration;
    this.mesh.rotation.set(p.rotation.x * DEG + p.spin.x * turns * Math.PI * 2, p.rotation.y * DEG + p.spin.y * turns * Math.PI * 2, p.rotation.z * DEG + p.spin.z * turns * Math.PI * 2);
    this.mesh.position.set(p.position.x, p.position.y, p.position.z);
    this.mesh.scale.setScalar(p.scale);
    if (p.material.textureAssetId !== this.texAsset) this.loadTexture(p.material.textureAssetId, layer.id);
  }

  private loadTexture(assetId: string | null, layerId: string) {
    this.texAsset = assetId;
    if (this.texKey) { this.ctx.gpu.releaseTexture(this.texKey); this.texKey = null; }
    this.mat.uniforms.uHasTex.value = 0;
    if (!assetId) return;
    this.loading = this.ctx.gpu.texture(assetId, this.ctx.assets).then((r) => {
      if (this.texAsset !== assetId) { if ('tex' in r) this.ctx.gpu.releaseTexture(r.key); return; }
      if ('missing' in r) { this.ctx.issue(layerId, 'Texture image is missing'); return; }
      this.texKey = r.key;
      this.mat.uniforms.uTex.value = r.tex;
      this.mat.uniforms.uHasTex.value = 1;
      this.ctx.issue(layerId, null);
    });
  }

  ready() { return this.loading; }
  dispose() { this.mat.dispose(); if (this.texKey) this.ctx.gpu.releaseTexture(this.texKey); }
}

export const meshKey = (l: LayerOf<'mesh'>) => `mesh:${l.props.geometry.kind}:${l.props.geometry.detail}`;
