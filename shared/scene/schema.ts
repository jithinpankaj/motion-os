import { z } from 'zod';

/**
 * Native Motion Scene format. This schema is the single source of truth for scene documents:
 * the studio, playground, export worker and server all validate against it.
 */
export const SCHEMA_VERSION = 2;

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const num = (min: number, max: number) => finite.min(min).max(max);
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colour must be #rrggbb');
export const Vec2Schema = z.object({ x: num(-4, 5), y: num(-4, 5) });
export const Vec3Schema = z.object({ x: num(-100, 100), y: num(-100, 100), z: num(-100, 100) });
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_\-]+$/, 'invalid id');

export const BlendSchema = z.enum(['normal', 'add', 'multiply', 'screen']);
export const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'expoOut', 'backOut', 'spring', 'step'] as const;
export const EasingSchema = z.union([z.enum(EASINGS), z.tuple([finite, finite, finite, finite])]);

export const TransformSchema = z.object({
  x: num(-4, 5),
  y: num(-4, 5),
  rotation: num(-3600, 3600),
  scale: num(0.01, 20),
});

export const GRADIENT_MODES = ['linear', 'radial', 'mesh', 'aurora', 'noise', 'organic'] as const;
export const GradientStopSchema = z.object({ color: ColorSchema, pos: num(0, 1) });
export const GradientPropsSchema = z.object({
  mode: z.enum(GRADIENT_MODES),
  stops: z.array(GradientStopSchema).min(2).max(6),
  interpolation: z.enum(['linear', 'smooth', 'oklab']),
  angle: num(-360, 360),
  scale: num(0.05, 10),
  center: Vec2Schema,
  noiseFreq: num(0, 20),
  noiseAmp: num(0, 2),
  distortion: num(0, 2),
  speed: num(0, 10),
  flowAngle: num(-360, 360),
  grain: num(0, 1),
  customShader: z.string().max(1500).nullable(),
});

export const GEOMETRY_KINDS = ['plane', 'sphere', 'torus', 'cylinder'] as const;
export const MeshPropsSchema = z.object({
  geometry: z.object({ kind: z.enum(GEOMETRY_KINDS), detail: z.number().int().min(4).max(256) }),
  position: Vec3Schema,
  rotation: Vec3Schema,
  scale: num(0.01, 20),
  spin: Vec3Schema, // full turns per loop (integers keep loops seamless)
  material: z.object({
    color: ColorSchema,
    color2: ColorSchema,
    roughness: num(0, 1),
    fresnel: num(0, 4),
    iridescence: num(0, 1),
    wireframe: z.boolean(),
    textureAssetId: id.nullable(),
    textureMix: num(0, 1),
  }),
  displacement: z.object({ amount: num(0, 2), frequency: num(0, 10), speed: num(0, 10) }),
  light: z.object({ intensity: num(0, 4), ambient: num(0, 2), color: ColorSchema, azimuth: num(-360, 360), elevation: num(-90, 90) }),
});

export const PARTICLE_SHAPES = ['circle', 'square', 'ring', 'spark'] as const;
export const ParticlePropsSchema = z.object({
  count: z.number().int().min(1).max(200000),
  size: num(0.1, 64),
  shape: z.enum(PARTICLE_SHAPES),
  colorA: ColorSchema,
  colorB: ColorSchema,
  lifetime: num(0.1, 60),
  velocity: num(0, 4),
  direction: num(-360, 360),
  spread: num(0, 360),
  gravity: num(-4, 4),
  noise: num(0, 2),
  emitter: Vec2Schema,
  emitterSize: Vec2Schema,
  attractors: z.array(z.object({ x: num(-1, 2), y: num(-1, 2), strength: num(-4, 4) })).max(8),
  pointer: z.enum(['none', 'attract', 'repel']),
  pointerStrength: num(0, 4),
});

export const TEXT_PRESETS = ['none', 'fade', 'stagger', 'word', 'slide', 'scale', 'mask', 'scramble'] as const;
export const TextPropsSchema = z.object({
  text: z.string().max(2000),
  fontFamily: z.string().min(1).max(80),
  fontAssetId: id.nullable(),
  weight: z.number().int().min(100).max(900),
  size: num(0.005, 1),
  tracking: num(-0.2, 1),
  lineHeight: num(0.6, 3),
  align: z.enum(['left', 'center', 'right']),
  color: ColorSchema,
  maxWidth: num(0.05, 1),
  maxChars: z.number().int().min(1).max(2000).nullable(),
  animation: z.object({
    preset: z.enum(TEXT_PRESETS),
    start: num(0, 600),
    duration: num(0.05, 60),
    stagger: num(0, 1),
    easing: EasingSchema,
    exit: z.boolean(),
  }),
});

export const ImagePropsSchema = z.object({
  assetId: id.nullable(),
  fit: z.enum(['cover', 'contain', 'fill']),
  crop: z.object({ x: num(0, 1), y: num(0, 1), w: num(0.01, 1), h: num(0.01, 1) }),
  width: num(0.01, 4),
  height: num(0.01, 4),
  mask: z.enum(['none', 'circle', 'rounded', 'fade']),
  radius: num(0, 0.5),
  displacement: num(0, 1),
  displacementSpeed: num(0, 10),
  reveal: z.object({ preset: z.enum(['none', 'fade', 'wipe', 'scale', 'iris']), start: num(0, 600), duration: num(0.05, 60), easing: EasingSchema }),
});

const base = {
  id,
  name: z.string().min(1).max(120),
  parentId: id.nullable(),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: num(0, 1),
  blend: BlendSchema,
  transform: TransformSchema,
};

export const LayerSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('group'), props: z.object({}) }),
  z.object({ ...base, type: z.literal('gradient'), props: GradientPropsSchema }),
  z.object({ ...base, type: z.literal('mesh'), props: MeshPropsSchema }),
  z.object({ ...base, type: z.literal('particles'), props: ParticlePropsSchema }),
  z.object({ ...base, type: z.literal('text'), props: TextPropsSchema }),
  z.object({ ...base, type: z.literal('image'), props: ImagePropsSchema }),
]);

export const KeyframeSchema = z.object({
  id,
  t: num(0, 600),
  value: z.union([finite, ColorSchema]),
  easing: EasingSchema,
});
export const TrackSchema = z.object({
  id,
  layerId: id,
  path: z.string().min(1).max(120).regex(/^[A-Za-z0-9_.]+$/),
  keyframes: z.array(KeyframeSchema).max(500),
});

export const TargetSchema = z.object({ layerId: id, path: z.string().min(1).max(120).regex(/^[A-Za-z0-9_.]+$/) });

export const PARAM_TYPES = ['text', 'number', 'boolean', 'color', 'gradientPreset', 'image', 'select', 'multiSelect', 'position', 'scale'] as const;
export const ExposedParamSchema = z.object({
  key: z.string().min(1).max(48).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'key must be an identifier'),
  label: z.string().min(1).max(80),
  description: z.string().max(400),
  type: z.enum(PARAM_TYPES),
  targets: z.array(TargetSchema).max(16),
  default: z.unknown(),
  min: finite.optional(),
  max: finite.optional(),
  step: finite.optional(),
  maxLength: z.number().int().min(1).max(2000).optional(),
  options: z.array(z.object({ label: z.string().max(80), value: z.unknown() })).max(64).optional(),
  required: z.boolean().optional(),
  locked: z.boolean().optional(),
  lockReason: z.string().max(200).optional(),
  roles: z.array(z.string().max(32)).max(16).optional(),
  tokenBinding: z.string().max(80).nullable().optional(),
  group: z.string().max(40).optional(),
});

export const LayoutOverrideSchema = z.object({
  x: num(-4, 5).optional(),
  y: num(-4, 5).optional(),
  scale: num(0.01, 20).optional(),
  size: num(0.005, 1).optional(),
  maxWidth: num(0.05, 1).optional(),
  visible: z.boolean().optional(),
});

export const SceneSchema = z.object({
  id,
  schemaVersion: z.literal(SCHEMA_VERSION),
  seed: z.number().int().min(0).max(2 ** 31),
  meta: z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000),
    tags: z.array(z.string().max(40)).max(32),
    category: z.string().max(40).optional(),
  }),
  canvas: z.object({
    width: z.number().int().min(16).max(4096),
    height: z.number().int().min(16).max(4096),
    fps: z.number().int().min(1).max(120),
    duration: num(0.1, 600),
    loop: z.boolean(),
    background: ColorSchema,
    camera: z.object({ fov: num(10, 120), distance: num(0.5, 100), yaw: num(-360, 360), pitch: num(-89, 89) }),
  }),
  layers: z.array(LayerSchema).max(200),
  tracks: z.array(TrackSchema).max(400),
  tokens: z.object({ bindings: z.array(TargetSchema.extend({ token: z.string().max(80) })).max(200) }),
  exposed: z.array(ExposedParamSchema).max(64),
  responsive: z.object({
    focalPoint: Vec2Schema,
    rules: z.array(z.object({
      layerId: id,
      safeArea: z.boolean(),
      scaleWith: z.enum(['min', 'width', 'height']),
    })).max(200),
    overrides: z.record(z.string().max(48), z.record(z.string().max(64), LayoutOverrideSchema)),
  }),
  interactions: z.array(z.object({ id, type: z.literal('pointer'), layerId: id, effect: z.enum(['attract', 'repel', 'parallax']), strength: num(0, 4) })).max(32),
  fallback: z.object({ staticFrame: num(0, 600), reducedMotion: z.enum(['static', 'reduced']) }),
  export: z.object({ posterTime: num(0, 600) }),
});

export type SceneDocument = z.infer<typeof SceneSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type LayerType = Layer['type'];
export type LayerOf<T extends LayerType> = Extract<Layer, { type: T }>;
export type GradientProps = z.infer<typeof GradientPropsSchema>;
export type MeshProps = z.infer<typeof MeshPropsSchema>;
export type ParticleProps = z.infer<typeof ParticlePropsSchema>;
export type TextProps = z.infer<typeof TextPropsSchema>;
export type ImageProps = z.infer<typeof ImagePropsSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type Easing = z.infer<typeof EasingSchema>;
export type ExposedParam = z.infer<typeof ExposedParamSchema>;
export type ParamType = ExposedParam['type'];
export type Target = z.infer<typeof TargetSchema>;
export type LayoutOverride = z.infer<typeof LayoutOverrideSchema>;
export type Vec2 = z.infer<typeof Vec2Schema>;
