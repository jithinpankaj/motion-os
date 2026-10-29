import geist from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url';
import geistMono from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url';
import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import spaceGrotesk from '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url';
import fraunces from '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url';
import instrument from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url';

/** Bundled scene fonts. Exports load the same files in the worker so output matches the preview. */
export const SCENE_FONTS: { family: string; url: string; weight: string; category: string }[] = [
  { family: 'Geist', url: geist, weight: '100 900', category: 'Sans' },
  { family: 'Inter', url: inter, weight: '100 900', category: 'Sans' },
  { family: 'Space Grotesk', url: spaceGrotesk, weight: '300 700', category: 'Grotesk' },
  { family: 'Fraunces', url: fraunces, weight: '100 900', category: 'Serif' },
  { family: 'Instrument Serif', url: instrument, weight: '400', category: 'Serif' },
  { family: 'Geist Mono', url: geistMono, weight: '100 900', category: 'Mono' },
];

const loaded = new Map<string, Promise<boolean>>();
const fontSet = (): FontFaceSet | undefined => (globalThis as any).document?.fonts ?? (globalThis as any).fonts;

/** Load a font family (bundled or uploaded asset). Resolves false when unavailable. */
export function ensureFont(family: string, url?: string): Promise<boolean> {
  const key = family;
  let p = loaded.get(key);
  if (p) return p;
  const entry = SCENE_FONTS.find((f) => f.family === family);
  const src = url ?? entry?.url;
  if (!src || typeof FontFace === 'undefined') return Promise.resolve(false);
  const absolute = new URL(src, (globalThis as any).location?.href ?? 'http://localhost/').toString();
  p = new FontFace(family, `url(${absolute})`, { weight: entry?.weight ?? '100 900' })
    .load()
    .then((face) => { fontSet()?.add(face); return true; })
    .catch(() => false);
  loaded.set(key, p);
  return p;
}

export const isKnownFont = (family: string) => SCENE_FONTS.some((f) => f.family === family);
