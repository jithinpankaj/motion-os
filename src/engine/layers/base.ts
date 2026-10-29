import * as THREE from 'three';
import type { Layer, SceneDocument } from '../../../shared/scene/schema';
import type { AssetResolver } from '../assets';
import type { GPUContext } from '../gpu';
import { hexToRgb } from '../../../shared/util/color';

export type MotionMode = 'full' | 'reduced' | 'static';

export type FrameContext = {
  doc: SceneDocument;
  /** normalised scene time in seconds */
  t: number;
  /** 2π · t / duration */
  phase: number;
  frame: number;
  width: number;
  height: number;
  minDim: number;
  /** device pixels per scene pixel */
  renderScale: number;
  pointer: { x: number; y: number; active: boolean };
  interactive: boolean;
  motion: MotionMode;
  gpu: GPUContext;
  assets: AssetResolver;
  /** 2D camera mapping scene px → world (x right, y down negated) */
  ortho: THREE.OrthographicCamera;
  perspective: THREE.PerspectiveCamera;
  issue: (layerId: string, message: string | null) => void;
};

export type Bounds = { cx: number; cy: number; w: number; h: number; rotation: number };

export interface LayerView {
  readonly key: string;
  readonly scene: THREE.Scene;
  camera(ctx: FrameContext): THREE.Camera;
  sync(layer: Layer, ctx: FrameContext): void;
  ready(): Promise<void>;
  bounds?(): Bounds | null;
  dispose(): void;
  /** Called when the GPU reports a compile error for this view. */
  onShaderError?(message: string): void;
}

export const rgb = (hex: string) => new THREE.Vector3(...hexToRgb(hex));
export const setRgb = (v: THREE.Vector3, hex: string) => { const [r, g, b] = hexToRgb(hex); v.set(r, g, b); };

export function applyBlend(m: THREE.Material, blend: Layer['blend']) {
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  if (blend === 'add') m.blending = THREE.AdditiveBlending;
  else if (blend === 'multiply') {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.DstColorFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
  } else if (blend === 'screen') {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcColorFactor;
  } else m.blending = THREE.NormalBlending;
}

/** Shared loop helpers. Integer cycles keep procedural motion seamless across the loop point. */
export const cyclesFor = (ctx: FrameContext, speed: number) => (ctx.doc.canvas.loop ? Math.max(1, Math.round(speed)) : speed);
export const loopPhase = (ctx: FrameContext, speed: number) => ctx.doc.canvas.loop ? ctx.phase * cyclesFor(ctx, speed) : (ctx.t / 8) * Math.PI * 2 * speed;

/**
 * Entrance/exit progress for reveal animations (0 hidden → 1 shown). With looping scenes the
 * entrance is mirrored before the loop point, so frame 0 and the final frame match.
 */
export function revealProgress(ctx: FrameContext, start: number, duration: number, exit: boolean) {
  if (ctx.motion === 'static') return 1;
  const tin = (ctx.t - start) / duration;
  let p = Math.min(1, Math.max(0, tin));
  if (exit && ctx.doc.canvas.loop) {
    const end = ctx.doc.canvas.duration - 0.12;
    const outDur = Math.min(duration * 0.6, Math.max(0.2, end - start - duration));
    const tout = (end - ctx.t) / outDur;
    p = Math.min(p, Math.max(0, Math.min(1, tout)));
  }
  return p;
}

/** Place a quad in the 2D ortho scene from a layer transform (fractions of canvas, top-left origin). */
export function placeQuad(mesh: THREE.Mesh, layer: Layer, ctx: FrameContext, wPx: number, hPx: number, extraScale = 1) {
  mesh.position.set(layer.transform.x * ctx.width, -layer.transform.y * ctx.height, 0);
  mesh.rotation.set(0, 0, (-layer.transform.rotation * Math.PI) / 180);
  const s = layer.transform.scale * extraScale;
  mesh.scale.set(wPx * s, hPx * s, 1);
}
