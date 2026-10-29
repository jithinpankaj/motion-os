import { createLayer, createScene } from './defaults';
import type { ExposedParam, GradientProps, Layer, SceneDocument } from './schema';

type Stops = GradientProps['stops'];
const s = (...c: string[]): Stops => c.map((color, i) => ({ color, pos: i / (c.length - 1) }));

/** Brand-approved gradient palettes. Used by presets and by `gradientPreset` parameters. */
export const GRADIENT_PRESETS: { key: string; name: string; stops: Stops }[] = [
  { key: 'aurora', name: 'Aurora', stops: [{ color: '#050816', pos: 0 }, { color: '#0b3d5c', pos: 0.3 }, { color: '#16a3a0', pos: 0.55 }, { color: '#8b5cf6', pos: 0.8 }, { color: '#f0abfc', pos: 1 }] },
  { key: 'dusk', name: 'Dusk', stops: s('#12021f', '#4a1257', '#c2416b', '#ff9e6d', '#ffe2b8') },
  { key: 'ocean', name: 'Ocean', stops: s('#020b18', '#06305a', '#0f6fa8', '#3fd0d4', '#d8fff6') },
  { key: 'ember', name: 'Ember', stops: s('#100604', '#4a0f06', '#b3260e', '#ff6a2a', '#ffd38a') },
  { key: 'citrus', name: 'Citrus', stops: s('#0d1a05', '#2f6b12', '#a6d930', '#f6f05a', '#fffbe0') },
  { key: 'mono', name: 'Mono', stops: s('#050505', '#161616', '#2c2c2c', '#5a5a5a', '#d8d8d8') },
];
const presetOptions = (keys: string[]) => keys.map((k) => { const p = GRADIENT_PRESETS.find((g) => g.key === k)!; return { label: p.name, value: p.stops }; });

const textRule = (layerId: string) => ({ layerId, safeArea: true, scaleWith: 'min' as const });
const scene = (id: string, name: string, category: string, description: string, layers: Layer[], extra: Partial<SceneDocument> = {}) =>
  createScene({ id, meta: { name, description, tags: [category.toLowerCase()], category }, layers, ...extra });

const headlineParam = (layerId: string, def: string, maxLength = 32): ExposedParam => ({
  key: 'headline', label: 'Headline', description: 'Primary message. Keep it short so it fits every channel.', type: 'text',
  targets: [{ layerId, path: 'props.text' }], default: def, maxLength, required: true, group: 'Content',
});

export function auroraFlow(id = 'scn_aurora_flow'): SceneDocument {
  const bg = createLayer('gradient', { id: 'ly_aurora_bg', name: 'Aurora field' });
  bg.props = { ...bg.props, mode: 'aurora', stops: GRADIENT_PRESETS[0].stops, noiseFreq: 1.4, noiseAmp: 0.7, distortion: 0.45, speed: 1, grain: 0.05, flowAngle: 25 };
  const head = createLayer('text', { id: 'ly_aurora_head', name: 'Headline', transform: { x: 0.5, y: 0.6, rotation: 0, scale: 1 } });
  head.props = { ...head.props, text: 'Northern\nLight', fontFamily: 'Instrument Serif', weight: 400, size: 0.17, tracking: -0.02, lineHeight: 0.92, maxChars: 28, animation: { preset: 'mask', start: 0.4, duration: 1.4, stagger: 0.35, easing: 'expoOut', exit: true } };
  const sub = createLayer('text', { id: 'ly_aurora_sub', name: 'Eyebrow', transform: { x: 0.5, y: 0.83, rotation: 0, scale: 1 } });
  sub.props = { ...sub.props, text: 'AURORA FLOW — 2026', fontFamily: 'Geist Mono', weight: 500, size: 0.022, tracking: 0.28, color: '#d7f7f2', animation: { preset: 'fade', start: 1.2, duration: 1, stagger: 0, easing: 'easeOut', exit: true } };
  return scene(id, 'Aurora Flow', 'Gradient', 'Slow, luminous aurora bands with a serif reveal. Built for calm hero moments.', [bg, head, sub], {
    exposed: [
      headlineParam(head.id, 'Northern\nLight', 28),
      { key: 'eyebrow', label: 'Eyebrow', description: 'Small label above the fold.', type: 'text', targets: [{ layerId: sub.id, path: 'props.text' }], default: 'AURORA FLOW — 2026', maxLength: 32, group: 'Content' },
      { key: 'palette', label: 'Colour theme', description: 'Brand-approved gradient palettes.', type: 'gradientPreset', targets: [{ layerId: bg.id, path: 'props.stops' }], default: GRADIENT_PRESETS[0].stops, options: presetOptions(['aurora', 'dusk', 'ocean', 'ember', 'mono']), group: 'Style' },
      { key: 'intensity', label: 'Intensity', description: 'How strongly the bands move.', type: 'number', targets: [{ layerId: bg.id, path: 'props.noiseAmp' }], default: 0.7, min: 0.2, max: 1.2, step: 0.01, group: 'Motion' },
      { key: 'speed', label: 'Speed', description: 'Cycles per loop. Whole numbers keep the loop seamless.', type: 'number', targets: [{ layerId: bg.id, path: 'props.speed' }], default: 1, min: 1, max: 3, step: 1, group: 'Motion' },
      { key: 'headlineColor', label: 'Headline colour', description: 'Typography colour is fixed by the brand system.', type: 'color', targets: [{ layerId: head.id, path: 'props.color' }], default: '#f5f5f2', locked: true, lockReason: 'Brand rule: headlines use Paper White for contrast on gradients.', tokenBinding: 'color.paper', group: 'Style' },
    ],
    responsive: { focalPoint: { x: 0.5, y: 0.55 }, rules: [textRule(head.id), textRule(sub.id)], overrides: { 'instagram-story': { [sub.id]: { y: 0.74 } }, 'website-banner': { [head.id]: { y: 0.5, size: 0.42 }, [sub.id]: { visible: false } } } },
  });
}

export function liquidMesh(id = 'scn_liquid_mesh'): SceneDocument {
  const bg = createLayer('gradient', { id: 'ly_liquid_bg', name: 'Backdrop' });
  bg.props = { ...bg.props, mode: 'radial', stops: [{ color: '#1a1830', pos: 0 }, { color: '#0a0a12', pos: 0.55 }, { color: '#020203', pos: 1 }], noiseAmp: 0.1, distortion: 0.05, grain: 0.04, scale: 1.1, center: { x: 0.5, y: 0.42 } };
  const mesh = createLayer('mesh', { id: 'ly_liquid_mesh', name: 'Liquid sphere' });
  mesh.props = { ...mesh.props, position: { x: 0, y: 0.3, z: 0 }, scale: 1.2, displacement: { amount: 0.24, frequency: 0.85, speed: 1 }, material: { ...mesh.props.material, color: '#3557ff', color2: '#ff4fd8', iridescence: 0.75, fresnel: 2.2, roughness: 0.25 } };
  const head = createLayer('text', { id: 'ly_liquid_head', name: 'Headline', transform: { x: 0.5, y: 0.82, rotation: 0, scale: 1 } });
  head.props = { ...head.props, text: 'Liquid Metal', fontFamily: 'Geist', weight: 700, size: 0.09, tracking: -0.045, maxChars: 24, animation: { preset: 'slide', start: 0.3, duration: 1.1, stagger: 0.4, easing: 'expoOut', exit: true } };
  return scene(id, 'Liquid Mesh', 'Mesh', 'An iridescent, breathing sphere with vertex displacement. Product launches and tech moments.', [bg, mesh, head], {
    tracks: [{ id: 'tr_liquid_rot', layerId: mesh.id, path: 'props.rotation.x', keyframes: [{ id: 'k1', t: 0, value: -8, easing: 'easeInOut' }, { id: 'k2', t: 4, value: 14, easing: 'easeInOut' }, { id: 'k3', t: 8, value: -8, easing: 'linear' }] }],
    exposed: [
      headlineParam(head.id, 'Liquid Metal', 24),
      { key: 'colorA', label: 'Base colour', description: 'Body colour of the sphere.', type: 'color', targets: [{ layerId: mesh.id, path: 'props.material.color' }], default: '#3557ff', options: [{ label: 'Electric', value: '#3557ff' }, { label: 'Jade', value: '#12b886' }, { label: 'Ember', value: '#ff5a36' }, { label: 'Graphite', value: '#5c5f66' }], group: 'Style' },
      { key: 'colorB', label: 'Sheen colour', description: 'Iridescent edge colour.', type: 'color', targets: [{ layerId: mesh.id, path: 'props.material.color2' }], default: '#ff4fd8', options: [{ label: 'Magenta', value: '#ff4fd8' }, { label: 'Cyan', value: '#4fe3ff' }, { label: 'Gold', value: '#ffc94f' }], group: 'Style' },
      { key: 'intensity', label: 'Liquidity', description: 'Surface displacement strength.', type: 'number', targets: [{ layerId: mesh.id, path: 'props.displacement.amount' }], default: 0.24, min: 0, max: 0.5, step: 0.01, group: 'Motion' },
      { key: 'shape', label: 'Shape', description: 'Base geometry.', type: 'select', targets: [{ layerId: mesh.id, path: 'props.geometry.kind' }], default: 'sphere', options: [{ label: 'Sphere', value: 'sphere' }, { label: 'Torus', value: 'torus' }, { label: 'Cylinder', value: 'cylinder' }], group: 'Style' },
    ],
    responsive: { focalPoint: { x: 0.5, y: 0.42 }, rules: [textRule(head.id)], overrides: {} },
  });
}

export function organicBlobs(id = 'scn_organic_blobs'): SceneDocument {
  const bg = createLayer('gradient', { id: 'ly_blobs_bg', name: 'Blob field' });
  bg.props = { ...bg.props, mode: 'organic', stops: [{ color: '#1a0633', pos: 0 }, { color: '#7b2ff7', pos: 0.35 }, { color: '#ff5e62', pos: 0.7 }, { color: '#ffc27a', pos: 1 }], noiseFreq: 1.1, noiseAmp: 0.85, distortion: 0.5, speed: 1, grain: 0.07, scale: 1 };
  const head = createLayer('text', { id: 'ly_blobs_head', name: 'Headline', transform: { x: 0.5, y: 0.5, rotation: 0, scale: 1 } });
  head.props = { ...head.props, text: 'Soft\nPower', fontFamily: 'Fraunces', weight: 600, size: 0.16, tracking: -0.04, lineHeight: 0.9, color: '#fff7ee', maxChars: 24, animation: { preset: 'scale', start: 0.3, duration: 1.3, stagger: 0.3, easing: 'backOut', exit: true } };
  return scene(id, 'Organic Blobs', 'Gradient', 'Warm metaball forms that drift and merge. Friendly announcements and lifestyle content.', [bg, head], {
    exposed: [
      headlineParam(head.id, 'Soft\nPower', 24),
      { key: 'palette', label: 'Colour theme', description: 'Brand-approved gradient palettes.', type: 'gradientPreset', targets: [{ layerId: bg.id, path: 'props.stops' }], default: bg.props.stops, options: [{ label: 'Sunset', value: bg.props.stops }, ...presetOptions(['dusk', 'citrus', 'ocean'])], group: 'Style' },
      { key: 'intensity', label: 'Intensity', description: 'Blob movement amount.', type: 'number', targets: [{ layerId: bg.id, path: 'props.noiseAmp' }], default: 0.85, min: 0.3, max: 1.4, step: 0.01, group: 'Motion' },
      { key: 'grain', label: 'Film grain', description: 'Texture amount.', type: 'number', targets: [{ layerId: bg.id, path: 'props.grain' }], default: 0.07, min: 0, max: 0.2, step: 0.01, group: 'Style' },
    ],
    responsive: { focalPoint: { x: 0.5, y: 0.5 }, rules: [textRule(head.id)], overrides: {} },
  });
}

export function particleField(id = 'scn_particle_field'): SceneDocument {
  const bg = createLayer('gradient', { id: 'ly_field_bg', name: 'Night' });
  bg.props = { ...bg.props, mode: 'radial', stops: [{ color: '#101028', pos: 0 }, { color: '#05050c', pos: 0.6 }, { color: '#000000', pos: 1 }], noiseAmp: 0.05, distortion: 0, grain: 0.03, scale: 1.2 };
  const p = createLayer('particles', { id: 'ly_field_particles', name: 'Particle field' });
  p.props = { ...p.props, count: 16000, size: 3.2, colorA: '#7dd3fc', colorB: '#c084fc', lifetime: 4, velocity: 0.03, noise: 0.35, emitterSize: { x: 1.2, y: 1.2 }, attractors: [{ x: 0.5, y: 0.45, strength: 0.7 }], pointer: 'repel', pointerStrength: 1.2 };
  const head = createLayer('text', { id: 'ly_field_head', name: 'Headline', transform: { x: 0.5, y: 0.84, rotation: 0, scale: 1 } });
  head.props = { ...head.props, text: 'Signal from noise', fontFamily: 'Space Grotesk', weight: 500, size: 0.06, tracking: -0.02, maxChars: 32, animation: { preset: 'word', start: 0.6, duration: 1.2, stagger: 0.6, easing: 'expoOut', exit: true } };
  return scene(id, 'Particle Field', 'Particles', 'Thousands of GPU particles orbiting an attractor; reacts to the pointer in interactive embeds.', [bg, p, head], {
    exposed: [
      headlineParam(head.id, 'Signal from noise', 32),
      { key: 'density', label: 'Density', description: 'Number of particles (brand density token caps the maximum).', type: 'number', targets: [{ layerId: p.id, path: 'props.count' }], default: 16000, min: 2000, max: 30000, step: 1000, tokenBinding: 'particles.density', group: 'Motion' },
      { key: 'colorA', label: 'Primary glow', description: 'Particle colour A.', type: 'color', targets: [{ layerId: p.id, path: 'props.colorA' }], default: '#7dd3fc', options: [{ label: 'Ice', value: '#7dd3fc' }, { label: 'Lime', value: '#bef264' }, { label: 'Amber', value: '#fbbf24' }], group: 'Style' },
      { key: 'colorB', label: 'Secondary glow', description: 'Particle colour B.', type: 'color', targets: [{ layerId: p.id, path: 'props.colorB' }], default: '#c084fc', options: [{ label: 'Violet', value: '#c084fc' }, { label: 'Rose', value: '#fb7185' }, { label: 'White', value: '#ffffff' }], group: 'Style' },
      { key: 'gravity', label: 'Pull', description: 'Attractor strength.', type: 'number', targets: [{ layerId: p.id, path: 'props.attractors.0.strength' }], default: 0.7, min: 0, max: 1.4, step: 0.01, group: 'Motion' },
    ],
    responsive: { focalPoint: { x: 0.5, y: 0.45 }, rules: [textRule(head.id)], overrides: {} },
    interactions: [{ id: 'ix_pointer', type: 'pointer', layerId: p.id, effect: 'repel', strength: 1.2 }],
  });
}

export function kineticType(id = 'scn_kinetic_type'): SceneDocument {
  const bg = createLayer('gradient', { id: 'ly_kin_bg', name: 'Paper' });
  bg.props = { ...bg.props, mode: 'noise', stops: GRADIENT_PRESETS[5].stops.slice(0, 4), noiseFreq: 2.4, noiseAmp: 0.4, distortion: 0.2, grain: 0.12, speed: 1 };
  const big = createLayer('text', { id: 'ly_kin_big', name: 'Headline', transform: { x: 0.5, y: 0.4, rotation: 0, scale: 1 } });
  big.props = { ...big.props, text: 'MOVE', fontFamily: 'Geist', weight: 800, size: 0.3, tracking: -0.06, lineHeight: 0.9, color: '#f2f2f2', maxChars: 10, animation: { preset: 'stagger', start: 0.2, duration: 1.1, stagger: 0.55, easing: 'expoOut', exit: true } };
  const tag = createLayer('text', { id: 'ly_kin_tag', name: 'Tagline', transform: { x: 0.5, y: 0.6, rotation: 0, scale: 1 } });
  tag.props = { ...tag.props, text: 'WITH INTENT', fontFamily: 'Geist Mono', weight: 500, size: 0.042, tracking: 0.32, color: '#ff5a36', maxChars: 20, animation: { preset: 'scramble', start: 0.9, duration: 1.4, stagger: 0.4, easing: 'linear', exit: true } };
  const foot = createLayer('text', { id: 'ly_kin_foot', name: 'Footer', transform: { x: 0.5, y: 0.9, rotation: 0, scale: 1 } });
  foot.props = { ...foot.props, text: 'Twylo · Launch week', fontFamily: 'Geist', weight: 400, size: 0.026, tracking: 0, color: '#9a9a9a', animation: { preset: 'word', start: 1.6, duration: 0.9, stagger: 0.5, easing: 'easeOut', exit: true } };
  return scene(id, 'Kinetic Typography', 'Typography', 'Bold staggered type with a scramble tagline on textured paper. Events and launches.', [bg, big, tag, foot], {
    tracks: [{ id: 'tr_kin_scale', layerId: big.id, path: 'transform.scale', keyframes: [{ id: 'k1', t: 0, value: 1, easing: 'easeInOut' }, { id: 'k2', t: 4, value: 1.07, easing: 'easeInOut' }, { id: 'k3', t: 8, value: 1, easing: 'linear' }] }],
    exposed: [
      headlineParam(big.id, 'MOVE', 10),
      { key: 'tagline', label: 'Tagline', description: 'Scrambled accent line.', type: 'text', targets: [{ layerId: tag.id, path: 'props.text' }], default: 'WITH INTENT', maxLength: 20, group: 'Content' },
      { key: 'footer', label: 'Footer', description: 'Event or campaign line.', type: 'text', targets: [{ layerId: foot.id, path: 'props.text' }], default: 'Twylo · Launch week', maxLength: 40, group: 'Content' },
      { key: 'accent', label: 'Accent', description: 'Tagline colour from the brand accent set.', type: 'color', targets: [{ layerId: tag.id, path: 'props.color' }], default: '#ff5a36', options: [{ label: 'Signal', value: '#ff5a36' }, { label: 'Volt', value: '#d4ff3a' }, { label: 'Sky', value: '#5ab0ff' }], tokenBinding: 'color.accent', group: 'Style' },
    ],
    responsive: { focalPoint: { x: 0.5, y: 0.45 }, rules: [textRule(big.id), textRule(tag.id), textRule(foot.id)], overrides: { 'website-banner': { [big.id]: { x: 0.28, y: 0.5, size: 0.62 }, [tag.id]: { x: 0.7, y: 0.5, size: 0.11 }, [foot.id]: { visible: false } } } },
  });
}

export const LAUNCH_PRESETS = [
  { key: 'aurora-flow', build: auroraFlow },
  { key: 'liquid-mesh', build: liquidMesh },
  { key: 'organic-blobs', build: organicBlobs },
  { key: 'particle-field', build: particleField },
  { key: 'kinetic-type', build: kineticType },
] as const;
