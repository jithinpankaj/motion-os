import { uid } from '../util/random';
import type { Layer, LayerType, SceneDocument, GradientProps, MeshProps, ParticleProps, TextProps, ImageProps } from './schema';
import { SCHEMA_VERSION } from './schema';

export const defaultGradient = (): GradientProps => ({
  mode: 'aurora',
  stops: [
    { color: '#0a0f2c', pos: 0 },
    { color: '#1b6b8f', pos: 0.35 },
    { color: '#7c4dff', pos: 0.7 },
    { color: '#ff7ab6', pos: 1 },
  ],
  interpolation: 'oklab',
  angle: 90,
  scale: 1,
  center: { x: 0.5, y: 0.5 },
  noiseFreq: 1.6,
  noiseAmp: 0.6,
  distortion: 0.35,
  speed: 1,
  flowAngle: 30,
  grain: 0.06,
  customShader: null,
});

export const defaultMesh = (): MeshProps => ({
  geometry: { kind: 'sphere', detail: 128 },
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: 1.4,
  spin: { x: 0, y: 1, z: 0 },
  material: { color: '#6b8cff', color2: '#ff6ad5', roughness: 0.35, fresnel: 1.6, iridescence: 0.5, wireframe: false, textureAssetId: null, textureMix: 0 },
  displacement: { amount: 0.25, frequency: 1.5, speed: 1 },
  light: { intensity: 1.4, ambient: 0.25, color: '#ffffff', azimuth: 40, elevation: 35 },
});

export const defaultParticles = (): ParticleProps => ({
  count: 6000,
  size: 3,
  shape: 'circle',
  colorA: '#9fd8ff',
  colorB: '#ff9ad5',
  lifetime: 4,
  velocity: 0.12,
  direction: 90,
  spread: 360,
  gravity: 0,
  noise: 0.35,
  emitter: { x: 0.5, y: 0.5 },
  emitterSize: { x: 1, y: 1 },
  attractors: [],
  pointer: 'attract',
  pointerStrength: 1,
});

export const defaultText = (): TextProps => ({
  text: 'Create once.\nAdapt everywhere.',
  fontFamily: 'Geist',
  fontAssetId: null,
  weight: 600,
  size: 0.085,
  tracking: -0.03,
  lineHeight: 1.02,
  align: 'center',
  color: '#f5f5f2',
  maxWidth: 0.86,
  maxChars: null,
  animation: { preset: 'stagger', start: 0.3, duration: 1.2, stagger: 0.5, easing: 'expoOut', exit: true },
});

export const defaultImage = (): ImageProps => ({
  assetId: null,
  fit: 'cover',
  crop: { x: 0, y: 0, w: 1, h: 1 },
  width: 0.5,
  height: 0.5,
  mask: 'rounded',
  radius: 0.06,
  displacement: 0,
  displacementSpeed: 1,
  reveal: { preset: 'fade', start: 0, duration: 1, easing: 'easeOut' },
});

const NAMES: Record<LayerType, string> = { group: 'Group', gradient: 'Gradient', mesh: 'Mesh', particles: 'Particles', text: 'Text', image: 'Image' };

export function createLayer<T extends LayerType>(type: T, patch: Partial<Layer> = {}): Extract<Layer, { type: T }> {
  const props =
    type === 'gradient' ? defaultGradient() :
    type === 'mesh' ? defaultMesh() :
    type === 'particles' ? defaultParticles() :
    type === 'text' ? defaultText() :
    type === 'image' ? defaultImage() : {};
  return {
    id: uid('ly'),
    name: NAMES[type],
    type,
    parentId: null,
    visible: true,
    locked: false,
    opacity: 1,
    blend: type === 'particles' ? 'add' : 'normal',
    transform: { x: 0.5, y: 0.5, rotation: 0, scale: 1 },
    props,
    ...patch,
  } as any;
}

export function createScene(patch: Partial<SceneDocument> = {}): SceneDocument {
  return {
    id: uid('scn'),
    schemaVersion: SCHEMA_VERSION,
    seed: 1337,
    meta: { name: 'Untitled scene', description: '', tags: [] },
    canvas: { width: 1080, height: 1350, fps: 30, duration: 8, loop: true, background: '#05060a', camera: { fov: 35, distance: 6, yaw: 0, pitch: 0 } },
    layers: [],
    tracks: [],
    tokens: { bindings: [] },
    exposed: [],
    responsive: { focalPoint: { x: 0.5, y: 0.5 }, rules: [], overrides: {} },
    interactions: [],
    fallback: { staticFrame: 2.5, reducedMotion: 'static' },
    export: { posterTime: 2.5 },
    ...patch,
  };
}
