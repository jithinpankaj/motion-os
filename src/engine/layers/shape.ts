import * as THREE from 'three';
import type { LayerOf } from '../../../shared/scene/schema';
import { QUAD_VERT, SHAPE_FRAG } from '../shaders';
import { applyBlend, placeQuad, setRgb, type Bounds, type FrameContext, type LayerView } from './base';

const KIND = ['rect', 'ellipse', 'polygon', 'star'];
const FILL = ['solid', 'linear', 'radial', 'none'];

/** Rectangles, ellipses, polygons and stars. Every property is a uniform, so all of it animates. */
export class ShapeView implements LayerView {
  readonly scene = new THREE.Scene();
  readonly key = 'shape';
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private lastBounds: Bounds | null = null;

  constructor(_layer: LayerOf<'shape'>, ctx: FrameContext) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SHAPE_FRAG,
      uniforms: {
        uSize: { value: new THREE.Vector2(1, 1) }, uQuad: { value: new THREE.Vector2(1, 1) }, uKind: { value: 0 }, uRadius: { value: 0 }, uInner: { value: 0.45 },
        uStrokeW: { value: 0 }, uOpacity: { value: 1 }, uAngle: { value: 0 }, uSides: { value: 6 }, uFill: { value: 0 },
        uColor: { value: new THREE.Vector3() }, uColor2: { value: new THREE.Vector3() }, uStroke: { value: new THREE.Vector3() },
      },
    });
    (this.mat as any).extensions = { derivatives: true };
    this.mesh = new THREE.Mesh(ctx.gpu.geometry('quad', () => new THREE.PlaneGeometry(1, 1)), this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  camera(ctx: FrameContext) { return ctx.ortho; }

  sync(layer: LayerOf<'shape'>, ctx: FrameContext) {
    const p = layer.props, u = this.mat.uniforms;
    applyBlend(this.mat, layer.blend);
    const w = Math.max(1, p.width), h = Math.max(1, p.height);
    // Margin for the outer half of the stroke plus a couple of pixels of antialiasing.
    const pad = p.stroke.width + 4 / Math.max(0.05, ctx.renderScale * layer.transform.scale);
    u.uSize.value.set(w, h);
    u.uQuad.value.set(w + pad * 2, h + pad * 2);
    u.uKind.value = KIND.indexOf(p.kind);
    u.uRadius.value = p.radius;
    u.uInner.value = p.innerRadius;
    u.uSides.value = p.sides;
    u.uStrokeW.value = p.stroke.width;
    u.uFill.value = FILL.indexOf(p.fill.type);
    u.uAngle.value = p.fill.angle;
    setRgb(u.uColor.value, p.fill.color);
    setRgb(u.uColor2.value, p.fill.color2);
    setRgb(u.uStroke.value, p.stroke.color);
    u.uOpacity.value = layer.opacity;
    placeQuad(this.mesh, layer, ctx, w + pad * 2, h + pad * 2);
    this.lastBounds = { cx: layer.transform.x * ctx.width, cy: layer.transform.y * ctx.height, w: w * layer.transform.scale * layer.transform.scaleX, h: h * layer.transform.scale * layer.transform.scaleY, rotation: layer.transform.rotation };
  }

  bounds() { return this.lastBounds; }
  ready() { return Promise.resolve(); }
  dispose() { this.mat.dispose(); }
}
