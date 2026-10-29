import { z } from 'zod';

/**
 * Native Motion Scene format. This schema is the single source of truth for scene documents:
 * the studio, playground, export worker and server all validate against it.
 */
export const SCHEMA_VERSION = 3;

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
  /** Squash and stretch: extra scale across (X) and up/down (Y) in the layer's own axes. Groups pass it to their children. */
  scaleX: num(0.01, 20).default(1),
  scaleY: num(0.01, 20).default(1),
});

/** New modes are only ever appended, so saved files keep their meaning. grain and halftone are texture effects. */
export const GRADIENT_MODES = ['linear', 'radial', 'mesh', 'aurora', 'noise', 'organic', 'conic', 'diamond', 'grain', 'halftone'] as const;
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

export const SHAPE_KINDS = ['rect', 'ellipse', 'polygon', 'star'] as const;
export const FILL_TYPES = ['solid', 'linear', 'radial', 'none'] as const;
/** Vector shape drawn with a signed-distance shader. Sizes are in canvas pixels. */
export const ShapePropsSchema = z.object({
  kind: z.enum(SHAPE_KINDS),
  width: num(1, 8000),
  height: num(1, 8000),
  radius: num(0, 4000),
  sides: z.number().int().min(3).max(12),
  innerRadius: num(0.05, 0.95),
  fill: z.object({ type: z.enum(FILL_TYPES), color: ColorSchema, color2: ColorSchema, angle: num(-360, 360) }),
  stroke: z.object({ color: ColorSchema, width: num(0, 400) }),
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
  z.object({ ...base, type: z.literal('shape'), props: ShapePropsSchema }),
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

/**
 * Interactive motion (v3). Plain-language model for non-specialists:
 *  - inputs ("controls"): toggles (boolean), buttons (trigger) and sliders (number)
 *  - animations ("moves"): named keyframe timelines that play once, loop or ping-pong
 *  - rules: WHEN something happens (start, a control changes, someone clicks/hovers a layer)
 *           AND optional conditions hold, DO actions (play/stop a move, change a control)
 *  - bindings: a slider drives a property directly across a range
 */
/** Variable types. boolean/trigger/number are the original "controls"; the rest are advanced variables. */
export const VAR_TYPES = ['boolean', 'trigger', 'number', 'string', 'enum', 'vector2', 'color'] as const;
export const Vec2ValueSchema = z.object({ x: finite, y: finite });
export const VarValueSchema = z.union([z.boolean(), finite, z.string().max(200), Vec2ValueSchema]);
export const InputSchema = z.object({
  id,
  name: z.string().trim().min(1).max(40),
  type: z.enum(VAR_TYPES),
  default: VarValueSchema,
  min: finite.optional(),
  max: finite.optional(),
  /** Sliders can follow the pointer: across (x) or up and down (y), eased by `smoothing` (0 snappy … 1 lazy). */
  follow: z.enum(['pointerX', 'pointerY']).optional(),
  smoothing: num(0, 0.98).optional(),
  /** Follow only while someone drags this layer; letting go sends it back to its default. */
  dragLayer: id.optional(),
  /** Springiness when it moves (0 = settles smoothly, higher = overshoots and wobbles). */
  bounce: num(0, 0.95).optional(),
  /** Enum choices. */
  options: z.array(z.string().trim().min(1).max(40)).max(32).optional(),
  /** Longest allowed text for string variables. */
  maxLength: z.number().int().min(1).max(200).optional(),
  description: z.string().max(200).optional(),
});
export const AnimationSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  duration: num(0.05, 120),
  loop: z.enum(['once', 'loop', 'pingpong']),
  tracks: z.array(TrackSchema).max(400),
  /** A plain-language note on why the move is built the way it is, shown above its timeline. */
  note: z.string().max(600).optional(),
});
export const COMPARE_OPS = ['>', '<', '=', '>=', '<=', '!='] as const;
export const TEXT_OPS = ['is', 'isNot', 'contains', 'startsWith'] as const;
const CompareSchema = z.enum(COMPARE_OPS);
export const WhenSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('trigger'), inputId: id }),
  z.object({ type: z.literal('boolean'), inputId: id, value: z.boolean() }),
  z.object({ type: z.literal('number'), inputId: id, op: CompareSchema, value: finite }),
  /** Pointer events on a layer; without a layer, anywhere on the canvas. */
  z.object({ type: z.literal('pointer'), event: z.enum(['click', 'enter', 'leave', 'down', 'up']), layerId: id.optional() }),
  z.object({ type: z.literal('finished'), animationId: id }),
  /** A key is pressed while the motion is focused or under the pointer ("any" for every key). */
  z.object({ type: z.literal('key'), key: z.string().min(1).max(20) }),
  /** A named event sent by an "emit" action (or by the page hosting the motion). */
  z.object({ type: z.literal('event'), name: z.string().trim().min(1).max(40) }),
  /** The state machine enters a state. */
  z.object({ type: z.literal('stateEnter'), stateId: id }),
  /** Any variable changes value (useful for text, choice, vector and colour variables). */
  z.object({ type: z.literal('changed'), inputId: id }),
]);

// ---------- conditions: leaves and nested groups (all / any / none) ----------
export const EVENT_FIELDS = ['key', 'name', 'value', 'x', 'y'] as const;
export const LeafConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('boolean'), inputId: id, value: z.boolean() }),
  z.object({ type: z.literal('number'), inputId: id, op: CompareSchema, value: finite }),
  z.object({ type: z.literal('text'), inputId: id, op: z.enum(TEXT_OPS), value: z.string().max(200) }),
  z.object({ type: z.literal('range'), inputId: id, min: finite, max: finite }),
  /** Compare two variables. */
  z.object({ type: z.literal('compare'), inputId: id, op: CompareSchema, otherId: id }),
  z.object({ type: z.literal('vector'), inputId: id, axis: z.enum(['x', 'y']), op: CompareSchema, value: finite }),
  z.object({ type: z.literal('state'), stateId: id, is: z.boolean() }),
  z.object({ type: z.literal('playing'), animationId: id, is: z.boolean() }),
  /** Compare a field of the event that triggered the rule (the key pressed, the pointer position…). */
  z.object({ type: z.literal('event'), field: z.enum(EVENT_FIELDS), op: z.enum([...COMPARE_OPS, ...TEXT_OPS]), value: z.union([finite, z.string().max(200)]) }),
]);
export type LeafCondition = z.infer<typeof LeafConditionSchema>;
export type ConditionGroup = { type: 'group'; op: 'all' | 'any' | 'none'; items: Condition[] };
export type Condition = LeafCondition | ConditionGroup;
export const ConditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() => z.object({ type: z.literal('group'), op: z.enum(['all', 'any', 'none']), items: z.array(ConditionSchema).max(24) }));
export const ConditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([LeafConditionSchema, ConditionGroupSchema]));

/** Sounds that ship with the app (synthesised in the browser, so they cost nothing to load). */
export const BUILTIN_SOUNDS = ['click', 'tap', 'pop', 'blip', 'bubble', 'boing', 'squish', 'whoosh', 'sparkle', 'chime', 'success', 'bonk', 'tick', 'spin'] as const;

// ---------- actions: steps run in order; "parallel" and "branch" contain steps of their own ----------
export const LeafActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play'), animationId: id, direction: z.enum(['forward', 'reverse']), from: z.enum(['start', 'current']), loop: z.enum(['once', 'loop', 'pingpong']).optional() }),
  z.object({ type: z.literal('stop'), animationId: id }),
  z.object({ type: z.literal('pause'), animationId: id }),
  z.object({ type: z.literal('setBoolean'), inputId: id, value: z.enum(['on', 'off', 'toggle']) }),
  z.object({ type: z.literal('fire'), inputId: id }),
  z.object({ type: z.literal('setNumber'), inputId: id, mode: z.enum(['set', 'add']), value: finite }),
  /** Set a text, choice, vector or colour variable. */
  z.object({ type: z.literal('setVar'), inputId: id, value: VarValueSchema }),
  /** Play a sound: one of the built-in sounds, or an uploaded audio file (assetId). */
  z.object({ type: z.literal('sound'), sound: z.enum(BUILTIN_SOUNDS).nullable(), assetId: id.nullable(), volume: num(0, 1) }),
  z.object({ type: z.literal('setState'), stateId: id }),
  z.object({ type: z.literal('visibility'), layerId: id, visible: z.enum(['show', 'hide', 'toggle']) }),
  /** Send a named event: other rules can react to it, and so can the page the motion is embedded in. */
  z.object({ type: z.literal('emit'), name: z.string().trim().min(1).max(40), value: z.union([finite, z.string().max(200)]).optional() }),
  z.object({ type: z.literal('wait'), seconds: num(0, 60) }),
  z.object({ type: z.literal('waitFor'), animationId: id }),
]);
export type LeafAction = z.infer<typeof LeafActionSchema>;
export type ParallelAction = { type: 'parallel'; actions: Action[] };
export type BranchAction = { type: 'branch'; if: ConditionGroup; then: Action[]; else: Action[] };
export type Action = LeafAction | ParallelAction | BranchAction;
export const ActionSchema: z.ZodType<Action> = z.lazy(() => z.union([
  LeafActionSchema,
  z.object({ type: z.literal('parallel'), actions: z.array(ActionSchema).max(16) }),
  z.object({ type: z.literal('branch'), if: ConditionGroupSchema, then: z.array(ActionSchema).max(16), else: z.array(ActionSchema).max(16) }),
]));

/** How a connection moves between states and plays its moves. Every field is optional; see DEFAULT_TRANSITION. */
export const TransitionSchema = z.object({
  /** Cross-blend time in seconds when a move takes over properties. */
  duration: num(0, 10).optional(),
  /** Wait this long before the transition starts. */
  delay: num(0, 60).optional(),
  easing: EasingSchema.optional(),
  playback: z.enum(['restart', 'continue', 'reverse']).optional(),
  loop: z.enum(['default', 'once', 'loop', 'pingpong']).optional(),
  /** What happens when this fires while another transition (or this rule's steps) is still running. */
  interruption: z.enum(['allow', 'wait', 'queue', 'ignore']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  blend: z.enum(['crossfade', 'replace', 'additive']).optional(),
  /** Play the target state's move when entering it (default true). */
  playStateMove: z.boolean().optional(),
});
export const RuleSchema = z.object({
  id, when: WhenSchema,
  /** Conditions; `match` says whether all (default), any or none of them must hold. Items may be nested groups. */
  only: z.array(ConditionSchema).max(24),
  match: z.enum(['all', 'any', 'none']).optional(),
  do: z.array(ActionSchema).max(32),
  /** Steps run as a connection leaves its starting state, before it enters the next one. */
  exit: z.array(ActionSchema).max(32).optional(),
  name: z.string().trim().max(60).optional(),
  /** A connection between states: fires only in `from` (any state if missing) and moves to `to`. */
  from: id.optional(),
  to: id.optional(),
  transition: TransitionSchema.optional(),
  enabled: z.boolean().optional(),
});
export const BindingSchema = z.object({
  id, inputId: id, layerId: id, path: z.string().min(1).max(120).regex(/^[A-Za-z0-9_.]+$/),
  from: z.tuple([finite, finite]), to: z.tuple([finite, finite]),
  /** true: shift the property by the mapped amount from its designed value, instead of setting it. */
  relative: z.boolean().optional(),
});
/** A state on the Interaction Canvas: entering it plays its move. x/y place the node on the canvas. */
export const StateSchema = z.object({ id, name: z.string().trim().min(1).max(40), animationId: id.nullable(), x: num(-10000, 10000), y: num(-10000, 10000) });
export const MachineSchema = z.object({
  inputs: z.array(InputSchema).max(48),
  animations: z.array(AnimationSchema).max(64),
  rules: z.array(RuleSchema).max(128),
  bindings: z.array(BindingSchema).max(64),
  states: z.array(StateSchema).max(32).optional(),
  initialState: id.nullable().optional(),
  /** Transition settings new connections start with (editable in Advanced Controls). */
  defaults: TransitionSchema.optional(),
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
  machine: MachineSchema,
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
export type ShapeProps = z.infer<typeof ShapePropsSchema>;
export type Machine = z.infer<typeof MachineSchema>;
export type Input = z.infer<typeof InputSchema>;
export type Animation = z.infer<typeof AnimationSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type When = z.infer<typeof WhenSchema>;
export type BuiltinSound = (typeof BUILTIN_SOUNDS)[number];
export type Binding = z.infer<typeof BindingSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
export type MachineState = z.infer<typeof StateSchema>;
export type VarValue = z.infer<typeof VarValueSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type Easing = z.infer<typeof EasingSchema>;
export type ExposedParam = z.infer<typeof ExposedParamSchema>;
export type ParamType = ExposedParam['type'];
export type Target = z.infer<typeof TargetSchema>;
export type LayoutOverride = z.infer<typeof LayoutOverrideSchema>;
export type Vec2 = z.infer<typeof Vec2Schema>;
export type Transform = z.infer<typeof TransformSchema>;
