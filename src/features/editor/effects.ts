import type { GradientProps } from '../../../shared/scene/schema';
import { defaultGradient } from '../../../shared/scene/defaults';
import { addLayer } from './store';

/**
 * Ready-made gradients and textures for the creation rail. Each is a gradient layer with designed
 * settings (every value stays editable in the inspector). `swatch` is a small CSS preview for the menu.
 */
export type EffectPreset = { key: string; label: string; hint: string; swatch: string; name: string; props: Partial<GradientProps>; opacity?: number };
const stops = (...colors: string[]) => colors.map((color, i) => ({ color, pos: +(i / (colors.length - 1)).toFixed(3) }));

export const GRADIENTS: EffectPreset[] = [
  { key: 'gLinear', label: 'Linear', hint: 'A straight blend', name: 'Sunset gradient', swatch: 'linear-gradient(120deg, #ff4e50, #fc913a 50%, #f9d423)',
    props: { mode: 'linear', stops: stops('#ff4e50', '#fc913a', '#f9d423'), angle: 30, scale: 0.55, interpolation: 'smooth', noiseAmp: 0.12, distortion: 0.08, speed: 0 } },
  { key: 'gRadial', label: 'Radial', hint: 'A glow from the centre', name: 'Glow gradient', swatch: 'radial-gradient(circle at 50% 50%, #fff3d6, #ffb86b 35%, #e2583e 65%, #2a1030)',
    props: { mode: 'radial', stops: stops('#fff3d6', '#ffb86b', '#e2583e', '#2a1030'), noiseAmp: 0.1, distortion: 0.1, speed: 0 } },
  { key: 'gConic', label: 'Conic', hint: 'Colours sweep around a point', name: 'Prism gradient', swatch: 'conic-gradient(#7b61ff, #00c2ff, #3fe0a0, #ffd23f, #ff5f8f, #7b61ff)',
    props: { mode: 'conic', stops: stops('#7b61ff', '#00c2ff', '#3fe0a0', '#ffd23f', '#ff5f8f', '#7b61ff'), interpolation: 'smooth', noiseAmp: 0.2, distortion: 0.15, speed: 1 } },
  { key: 'gDiamond', label: 'Diamond', hint: 'Square rings from the centre', name: 'Diamond gradient', swatch: 'conic-gradient(from 45deg, #8bd3dd, #f582ae, #8bd3dd, #f582ae, #8bd3dd)',
    props: { mode: 'diamond', stops: stops('#fef6e4', '#f582ae', '#8bd3dd', '#001858'), angle: 0, noiseAmp: 0.1, distortion: 0.05, speed: 0 } },
  { key: 'gMesh', label: 'Mesh', hint: 'Soft colour clouds that drift', name: 'Mesh gradient', swatch: 'radial-gradient(at 20% 25%, #ffd6e0, transparent 55%), radial-gradient(at 80% 30%, #c1e7ff, transparent 55%), radial-gradient(at 35% 80%, #d7f9d1, transparent 55%), radial-gradient(at 80% 80%, #e3d4ff, transparent 55%), #fff1b8',
    props: { mode: 'mesh', stops: stops('#ffd6e0', '#c1e7ff', '#d7f9d1', '#fff1b8', '#e3d4ff'), noiseAmp: 0.6, distortion: 0.25, speed: 1 } },
  { key: 'gAurora', label: 'Aurora', hint: 'Luminous ribbons', name: 'Aurora gradient', swatch: 'linear-gradient(180deg, #0a0f2c, #1b6b8f 45%, #7c4dff 75%, #ff7ab6)',
    props: {} },
  { key: 'gBlobs', label: 'Blobs', hint: 'Liquid shapes that merge', name: 'Blob gradient', swatch: 'radial-gradient(circle at 42% 58%, #ff5e62, #b04aa8 40%, #4a1a6e 62%, #1a0633)',
    props: { mode: 'organic', stops: stops('#1a0633', '#7b2ff7', '#ff5e62', '#ffc27a'), interpolation: 'oklab', noiseFreq: 1.1, noiseAmp: 0.85, distortion: 0.5, speed: 1, grain: 0.07, scale: 1 } },
];

export const TEXTURES: EffectPreset[] = [
  { key: 'tFilm', label: 'Film grain', hint: 'Flickering specks over everything below', name: 'Film grain', swatch: 'radial-gradient(#fff 0.6px, transparent 1px) 0 0 / 4px 4px, radial-gradient(#000 0.6px, transparent 1px) 2px 2px / 5px 5px, #8a8a8a',
    props: { mode: 'grain', stops: stops('#ffffff', '#000000'), grain: 0.32, scale: 0.5, speed: 2 } },
  { key: 'tPaper', label: 'Paper grain', hint: 'A still, warm tooth', name: 'Paper grain', swatch: 'radial-gradient(#3b2f2f 0.5px, transparent 1px) 0 0 / 3px 3px, #efe6d8',
    props: { mode: 'grain', stops: stops('#fffaf0', '#3b2f2f'), grain: 0.22, scale: 0.75, speed: 0 } },
  { key: 'tNoise', label: 'Noise field', hint: 'Smoky, slowly moving noise', name: 'Noise field', swatch: 'radial-gradient(circle at 30% 30%, #eee, transparent 40%), radial-gradient(circle at 70% 70%, #777, transparent 45%), #222',
    props: { mode: 'noise', stops: stops('#111111', '#777777', '#eeeeee'), noiseFreq: 3, noiseAmp: 0.8, distortion: 0.4, speed: 1 } },
  { key: 'tHalftone', label: 'Halftone', hint: 'A printed dot screen', name: 'Halftone', swatch: 'radial-gradient(#1d1d1f 1.4px, transparent 1.8px) 0 0 / 5px 5px, #f4efe6',
    props: { mode: 'halftone', stops: stops('#f4efe6', '#1d1d1f'), scale: 1, angle: 45, noiseAmp: 0.2, speed: 0 } },
];

export function addEffect(p: EffectPreset) {
  addLayer('gradient', { name: p.name, ...(p.opacity !== undefined ? { opacity: p.opacity } : {}), props: { ...defaultGradient(), ...p.props } } as any);
}
