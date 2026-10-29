import geist from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url';
import geistMono from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url';
import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import spaceGrotesk from '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url';
import fraunces from '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url';
import instrument from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url';

import bricolage from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2?url';
import bungee from '@fontsource/bungee/files/bungee-latin-400-normal.woff2?url';
import caveat from '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url';
import oi from '@fontsource/oi/files/oi-latin-400-normal.woff2?url';
import barriecito from '@fontsource/barriecito/files/barriecito-latin-400-normal.woff2?url';

/**
 * Scene fonts. Open-licence (OFL) fonts from Google Fonts and Free Faces are bundled with the app,
 * so exports load the same files and match the preview exactly. Fontshare fonts are free to use but
 * their licence doesn't allow redistributing the files, so they load from Fontshare's own servers
 * (their CSS API) instead of being copied into the app.
 */
export type SceneFont = { family: string; weight: string; category: string; source: 'Google Fonts' | 'Free Faces' | 'Fontshare'; url?: string; fontshare?: string };
export const SCENE_FONTS: SceneFont[] = [
  { family: 'Geist', url: geist, weight: '100 900', category: 'Sans', source: 'Google Fonts' },
  { family: 'Inter', url: inter, weight: '100 900', category: 'Sans', source: 'Google Fonts' },
  { family: 'Bricolage Grotesque', url: bricolage, weight: '200 800', category: 'Grotesk', source: 'Google Fonts' },
  { family: 'Space Grotesk', url: spaceGrotesk, weight: '300 700', category: 'Grotesk', source: 'Free Faces' },
  { family: 'Fraunces', url: fraunces, weight: '100 900', category: 'Serif', source: 'Google Fonts' },
  { family: 'Instrument Serif', url: instrument, weight: '400', category: 'Serif', source: 'Google Fonts' },
  { family: 'Bungee', url: bungee, weight: '400', category: 'Display', source: 'Google Fonts' },
  { family: 'Oi', url: oi, weight: '400', category: 'Display', source: 'Free Faces' },
  { family: 'Barriecito', url: barriecito, weight: '400', category: 'Display', source: 'Free Faces' },
  { family: 'Caveat', url: caveat, weight: '400 700', category: 'Handwriting', source: 'Google Fonts' },
  { family: 'Geist Mono', url: geistMono, weight: '100 900', category: 'Mono', source: 'Google Fonts' },
  { family: 'Satoshi', fontshare: 'satoshi@300,400,500,700,900', weight: '300 900', category: 'Sans', source: 'Fontshare' },
  { family: 'Cabinet Grotesk', fontshare: 'cabinet-grotesk@400,500,700,800,900', weight: '400 900', category: 'Grotesk', source: 'Fontshare' },
  { family: 'Clash Display', fontshare: 'clash-display@400,500,600,700', weight: '400 700', category: 'Display', source: 'Fontshare' },
  { family: 'Zodiak', fontshare: 'zodiak@400,700,800', weight: '400 800', category: 'Serif', source: 'Fontshare' },
];

const loaded = new Map<string, Promise<boolean>>();
const fontSet = (): FontFaceSet | undefined => (globalThis as any).document?.fonts ?? (globalThis as any).fonts;

/** Fontshare serves one file per weight; read them from its CSS and register each. */
async function loadFontshare(family: string, spec: string) {
  const css = await (await fetch(`https://api.fontshare.com/v2/css?f[]=${spec}&display=swap`)).text();
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => ({
    url: m[1].match(/url\('([^']+\.woff2)'\)/)?.[1], weight: m[1].match(/font-weight:\s*(\d+)/)?.[1], style: m[1].match(/font-style:\s*(\w+)/)?.[1] ?? 'normal',
  })).filter((f) => f.url && f.style === 'normal');
  if (!faces.length) return false;
  await Promise.all(faces.map(async (f) => {
    const face = await new FontFace(family, `url(${f.url!.startsWith('//') ? 'https:' + f.url : f.url})`, { weight: f.weight ?? '400' }).load();
    fontSet()?.add(face);
  }));
  return true;
}

/** Load a font family (bundled, from Fontshare, or an uploaded asset). Resolves false when unavailable. */
export function ensureFont(family: string, url?: string): Promise<boolean> {
  const key = family;
  let p = loaded.get(key);
  if (p) return p;
  const entry = SCENE_FONTS.find((f) => f.family === family);
  if (!url && entry?.fontshare) {
    p = loadFontshare(family, entry.fontshare).catch(() => false);
    loaded.set(key, p);
    return p;
  }
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
