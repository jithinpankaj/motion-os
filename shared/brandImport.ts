import { contrastRatio, hexToRgb, luminance, oklabToSrgb, rgbToHex, srgbToOklab, type RGB } from './util/color';
import type { BrandToken } from './brand';

/**
 * Brand import: every source (website, logo/image, guidelines PDF, pasted codes) produces the same
 * `BrandFindings`, which the user reviews before anything is written to the brand kit.
 */
export type FoundColor = { hex: string; weight: number; source: string; name?: string };
export type Personality = 'calm' | 'balanced' | 'energetic' | 'playful';
export type BrandFindings = {
  source: 'website' | 'image' | 'pdf' | 'codes';
  name?: string;
  colors: FoundColor[];
  fonts: string[];
  logoUrl?: string;
  logoCandidates?: string[];
  /** Inline SVG logos found on a website (already checked for active content). */
  logoSvgs?: string[];
  description?: string;
  voice: string[];
  personality: Personality;
  personalityReason: string;
  notes: string[];
};

export const COLOR_ROLES = [
  { key: 'color.night', label: 'Background', description: 'Primary background' },
  { key: 'color.paper', label: 'Text', description: 'Primary text' },
  { key: 'color.primary', label: 'Primary', description: 'Primary brand colour' },
  { key: 'color.secondary', label: 'Secondary', description: 'Secondary brand colour' },
  { key: 'color.accent', label: 'Accent', description: 'Accent / call to action' },
  { key: 'color.support', label: 'Support', description: 'Supporting colour' },
] as const;
export type ColorRoleKey = (typeof COLOR_ROLES)[number]['key'];

export const PERSONALITIES: { key: Personality; label: string; description: string; speed: number; amplitude: number; easing: string }[] = [
  { key: 'calm', label: 'Calm', description: 'Slow, smooth, generous pauses. Premium, trustworthy, wellbeing.', speed: 0.6, amplitude: 0.6, easing: 'easeInOut' },
  { key: 'balanced', label: 'Balanced', description: 'Confident and clear. Works for most brands.', speed: 1, amplitude: 1, easing: 'expoOut' },
  { key: 'energetic', label: 'Energetic', description: 'Quick, punchy entrances. Launches, sport, tech.', speed: 1.5, amplitude: 1.3, easing: 'expoOut' },
  { key: 'playful', label: 'Playful', description: 'Bouncy overshoot and wobble. Consumer, kids, food.', speed: 1.2, amplitude: 1.4, easing: 'backOut' },
];
export const personalityOf = (k: string | undefined) => PERSONALITIES.find((p) => p.key === k) ?? PERSONALITIES[1];

// ---------- colour parsing ----------

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000', navy: '#000080', orange: '#ffa500', purple: '#800080', teal: '#008080', yellow: '#ffff00', gray: '#808080', grey: '#808080' };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function hslToHex(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return rgbToHex([f(0), f(8), f(4)]);
}

/** Parse one CSS-ish colour value. Returns null for transparent or unparseable values. */
export function parseColor(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      if (h.length === 4 && h[3] === '0') return null;
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    if (h.length === 6) return `#${h}`;
    if (h.length === 8) return parseInt(h.slice(6), 16) < 26 ? null : `#${h.slice(0, 6)}`;
    return null;
  }
  m = v.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const ch = (s: string) => (s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) / 255);
    if (m[4] !== undefined && (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) < 0.1) return null;
    return rgbToHex([clamp01(ch(m[1])), clamp01(ch(m[2])), clamp01(ch(m[3]))]);
  }
  m = v.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined && (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) < 0.1) return null;
    return hslToHex(parseFloat(m[1]) % 360, clamp01(parseFloat(m[2]) / 100), clamp01(parseFloat(m[3]) / 100));
  }
  return NAMED[v] ?? null;
}

const COLOR_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^)]{5,60}\)|hsla?\([^)]{5,60}\)/g;

/** Every colour mentioned in free text (CSS, guideline copy, pasted lists), with counts. */
export function colorsInText(text: string, source: string, weight = 1): FoundColor[] {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(COLOR_RE)) {
    const hex = parseColor(m[0]);
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + weight);
  }
  // Guideline documents often write "RGB 12 34 56" or "R12 G34 B56" without CSS syntax.
  for (const m of text.matchAll(/\bR(?:GB)?[:\s]*(\d{1,3})[\s,/]+G?[:\s]*(\d{1,3})[\s,/]+B?[:\s]*(\d{1,3})\b/g)) {
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    if (r > 255 || g > 255 || b > 255) continue;
    const hex = rgbToHex([r / 255, g / 255, b / 255]);
    counts.set(hex, (counts.get(hex) ?? 0) + weight);
  }
  // CMYK percentages ("C 100 M 45 Y 0 K 10") converted naively; flagged in the source label.
  for (const m of text.matchAll(/\bC[:\s]*(\d{1,3})[\s,/]+M[:\s]*(\d{1,3})[\s,/]+Y[:\s]*(\d{1,3})[\s,/]+K[:\s]*(\d{1,3})\b/g)) {
    const [c, mm, y, k] = [+m[1], +m[2], +m[3], +m[4]].map((x) => Math.min(100, x) / 100);
    const hex = rgbToHex([(1 - c) * (1 - k), (1 - mm) * (1 - k), (1 - y) * (1 - k)]);
    counts.set(hex, (counts.get(hex) ?? 0) + weight * 0.5);
  }
  return [...counts].map(([hex, w]) => ({ hex, weight: w, source }));
}

// ---------- palette clustering ----------

const dist2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Merge perceptually-near colours (OKLab) and keep the heaviest `max`. */
export function mergePalette(colors: FoundColor[], max = 8, threshold = 0.05): FoundColor[] {
  const sorted = [...colors].sort((a, b) => b.weight - a.weight);
  const out: (FoundColor & { lab: RGB })[] = [];
  for (const c of sorted) {
    const lab = srgbToOklab(hexToRgb(c.hex));
    const near = out.find((o) => dist2(o.lab, lab) < threshold * threshold);
    if (near) near.weight += c.weight;
    else out.push({ ...c, lab });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, max).map(({ lab: _lab, ...c }) => c);
}

/** k-means in OKLab over sampled pixels (RGBA bytes). Used for logos, images and PDF pages. */
export function paletteFromPixels(data: Uint8ClampedArray | Uint8Array, source: string, k = 8): FoundColor[] {
  const pts: RGB[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    pts.push(srgbToOklab([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255]));
  }
  if (!pts.length) return [];
  // Deterministic farthest-point initialisation keeps results stable across runs.
  const centers: RGB[] = [pts[0]];
  while (centers.length < Math.min(k, pts.length)) {
    let best = 0, bestD = -1;
    for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 2000))) {
      const d = Math.min(...centers.map((c) => dist2(c, pts[i])));
      if (d > bestD) { bestD = d; best = i; }
    }
    if (bestD < 1e-5) break;
    centers.push(pts[best]);
  }
  const assign = new Int32Array(pts.length);
  for (let iter = 0; iter < 10; iter++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) { const d = dist2(centers[c], pts[i]); if (d < bd) { bd = d; bi = c; } }
      assign[i] = bi;
      const s = sum[bi]; s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++;
    }
    for (let c = 0; c < centers.length; c++) if (sum[c][3]) centers[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  const counts = centers.map(() => 0);
  for (let i = 0; i < pts.length; i++) counts[assign[i]]++;
  return mergePalette(centers.map((c, i) => ({ hex: rgbToHex(oklabToSrgb(c)), weight: counts[i] / pts.length, source })).filter((c) => c.weight > 0.01), k);
}

const chroma = (hex: string) => { const [, a, b] = srgbToOklab(hexToRgb(hex)); return Math.hypot(a, b); };

/** Suggest role assignments: darkest neutral → background, best-contrast light → text, most vivid → primary… */
export function suggestRoles(colors: FoundColor[]): Partial<Record<ColorRoleKey, string>> {
  const list = colors.map((c) => c.hex);
  if (!list.length) return {};
  const roles: Partial<Record<ColorRoleKey, string>> = {};
  const used = new Set<string>();
  const take = (key: ColorRoleKey, hex: string | undefined) => { if (hex) { roles[key] = hex; used.add(hex); } };
  const byLum = [...list].sort((a, b) => luminance(a) - luminance(b));
  const dark = byLum[0];
  take('color.night', luminance(dark) < 0.2 ? dark : '#0b0b0f');
  const light = [...byLum].reverse().find((h) => contrastRatio(h, roles['color.night']!) >= 4.5);
  take('color.paper', light ?? '#f5f5f2');
  const vivid = list.filter((h) => !used.has(h)).sort((a, b) => chroma(b) - chroma(a) || 0);
  // Keep source order (weight) among clearly-chromatic colours so the most used brand colour becomes primary.
  const chromatic = list.filter((h) => !used.has(h) && chroma(h) > 0.06);
  const ordered = chromatic.length ? [...chromatic, ...vivid.filter((h) => !chromatic.includes(h))] : vivid;
  take('color.primary', ordered[0]);
  take('color.secondary', ordered.find((h) => !used.has(h)));
  take('color.accent', ordered.filter((h) => !used.has(h)).sort((a, b) => chroma(b) - chroma(a))[0]);
  take('color.support', ordered.find((h) => !used.has(h)));
  return roles;
}

// ---------- fonts ----------

export const AVAILABLE_FONTS = ['Geist', 'Inter', 'Space Grotesk', 'Fraunces', 'Instrument Serif', 'Geist Mono'];
const GENERIC = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica', 'helvetica neue', 'arial', 'inherit', 'initial', 'cursive', 'emoji', 'apple color emoji', 'segoe ui emoji', 'noto color emoji', 'var', 'unset']);
const SERIF_HINT = /serif|garamond|times|georgia|caslon|baskerville|bodoni|playfair|merriweather|lora|tiempos|freight|canela|ivy|didot|fraunces|libre/i;
const MONO_HINT = /mono|code|courier|consolas|menlo/i;

/** Brand fonts named in CSS `font-family` stacks (first non-generic family of each stack). */
export function fontsInCss(css: string): string[] {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    for (const part of m[1].split(',')) {
      const f = part.trim().replace(/^["']|["']$/g, '').replace(/!important/, '').trim();
      if (!f || f.startsWith('var(') || GENERIC.has(f.toLowerCase())) continue;
      counts.set(f, (counts.get(f) ?? 0) + 1);
      break;
    }
  }
  for (const m of css.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s)]+)/g)) {
    for (const fam of m[1].matchAll(/family=([^&:]+)/g)) {
      const f = decodeURIComponent(fam[1]).replace(/\+/g, ' ');
      counts.set(f, (counts.get(f) ?? 0) + 3);
    }
  }
  const seen = new Set<string>();
  return [...counts].sort((a, b) => b[1] - a[1]).map(([f]) => prettyFontName(f)).filter((f) => f && !seen.has(f.toLowerCase()) && seen.add(f.toLowerCase())).slice(0, 6);
}

/** "sohne-var" → "Sohne", "SourceCodePro" → "Source Code Pro", "Inter_Fallback_abc" → "Inter". */
export function prettyFontName(raw: string): string {
  let f = raw.replace(/["']/g, '').trim();
  if (/fallback/i.test(f)) f = f.split(/[_\s-]*fallback/i)[0];
  f = f.replace(/[-_ ](var|variable|vf|webfont|web|regular|normal|text|subset|latin)$/i, '').replace(/^__/, '').replace(/_[a-f0-9]{4,}$/i, '');
  f = f.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return f.split(' ').map((w) => (w.length <= 2 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}
export const isMonoFont = (f: string) => MONO_HINT.test(f);

/** Map any font name to one that renders in scenes today; exact match when available. */
export function closestFont(name: string): { family: string; exact: boolean } {
  const exact = AVAILABLE_FONTS.find((f) => f.toLowerCase() === name.toLowerCase());
  if (exact) return { family: exact, exact: true };
  if (MONO_HINT.test(name)) return { family: 'Geist Mono', exact: false };
  if (SERIF_HINT.test(name)) return { family: /display|italic|instrument/i.test(name) ? 'Instrument Serif' : 'Fraunces', exact: false };
  if (/grotesk|grotesque|neue|akzidenz|haas|futura|avenir|circular|gt |manrope|poppins|montserrat/i.test(name)) return { family: 'Space Grotesk', exact: false };
  return { family: 'Inter', exact: false };
}

/** Font names written in guideline documents ("Typeface: Söhne", "Primary font — Inter"). */
export function fontsInDocument(text: string): string[] {
  const out = new Set<string>();
  // Font names are capitalised words; stop at the next label ("Body font: …") or line end.
  for (const m of text.matchAll(/(?:typeface|font(?:\s*family)?)s?\s*[:\-–—]\s*(\p{Lu}[\p{L}\d\-]*(?:[ \t]+\p{Lu}[\p{L}\d\-]*){0,3})/giu)) {
    const name = m[1].replace(/(\s+(Body|Headline|Primary|Secondary|Font|Fonts|Typeface))+$/i, '').trim();
    if (name.length >= 3) out.add(name);
  }
  const known = ['Inter', 'Helvetica Neue', 'Helvetica', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Lato', 'Source Sans', 'Futura', 'Avenir', 'Gotham', 'Proxima Nova', 'Circular', 'Graphik', 'Söhne', 'Neue Haas Grotesk', 'Space Grotesk', 'Playfair Display', 'Merriweather', 'Georgia', 'Garamond', 'Fraunces', 'Geist', 'IBM Plex Sans', 'DM Sans', 'Manrope', 'Work Sans', 'Nunito', 'Raleway', 'Instrument Serif', 'Canela', 'Tiempos'];
  for (const k of known) if (new RegExp(`\\b${k.replace(/ /g, '\\s+')}\\b`, 'i').test(text)) out.add(k);
  return [...out].slice(0, 6);
}

// ---------- tone ----------

const TONE_WORDS: Record<Personality, string[]> = {
  calm: ['calm', 'peace', 'wellbeing', 'wellness', 'mindful', 'trusted', 'trust', 'secure', 'premium', 'luxury', 'timeless', 'care', 'health', 'gentle', 'simple', 'serene', 'elegant', 'heritage', 'private', 'bank', 'insurance', 'clinic'],
  energetic: ['fast', 'faster', 'power', 'powerful', 'bold', 'launch', 'speed', 'performance', 'sport', 'win', 'game', 'gaming', 'boost', 'growth', 'scale', 'instant', 'real-time', 'ai', 'future', 'innovative', 'disrupt', 'energy'],
  playful: ['fun', 'play', 'playful', 'joy', 'happy', 'delight', 'delicious', 'snack', 'kids', 'family', 'friendly', 'colourful', 'colorful', 'party', 'yum', 'smile', 'creative', 'quirky'],
  balanced: ['clear', 'confident', 'professional', 'modern', 'reliable', 'smart', 'team', 'platform', 'together', 'better', 'helpful'],
};

/** Suggest a motion personality and voice words from brand copy. Heuristic — always confirmed by the user. */
export function inferTone(text: string, colors: FoundColor[] = []): { personality: Personality; voice: string[]; reason: string } {
  const words = text.toLowerCase().match(/[a-z][a-z\-]+/g) ?? [];
  const score: Record<Personality, number> = { calm: 0, balanced: 0.5, energetic: 0, playful: 0 };
  const hits: Record<Personality, Set<string>> = { calm: new Set(), balanced: new Set(), energetic: new Set(), playful: new Set() };
  for (const w of words) for (const p of Object.keys(TONE_WORDS) as Personality[]) if (TONE_WORDS[p].includes(w)) { score[p]++; hits[p].add(w); }
  const vivid = colors.filter((c) => chroma(c.hex) > 0.15).length;
  if (vivid >= 3) { score.playful += 0.75; score.energetic += 0.5; }
  if (colors.length && vivid === 0) score.calm += 0.75;
  const personality = (Object.keys(score) as Personality[]).sort((a, b) => score[b] - score[a])[0];
  const voice = [...new Set([...hits[personality], ...hits.balanced])].slice(0, 5);
  const reason = hits[personality].size
    ? `Your copy uses words like ${[...hits[personality]].slice(0, 3).map((w) => `“${w}”`).join(', ')}.`
    : vivid >= 3 ? 'Your palette is bright and saturated.' : colors.length && vivid === 0 ? 'Your palette is muted and restrained.' : 'No strong signal found, so we picked a neutral default.';
  return { personality, voice, reason };
}

// ---------- findings → tokens ----------

export type BrandKitChoice = {
  roles: Partial<Record<ColorRoleKey, string>>;
  displayFont?: string;
  bodyFont?: string;
  logoAssetId?: string | null;
  personality: Personality;
  voice: string[];
};

/** Merge a reviewed import into existing tokens. Untouched tokens are kept as they are. */
export function applyKitToTokens(tokens: BrandToken[], kit: BrandKitChoice): BrandToken[] {
  const out = tokens.map((t) => ({ ...t }));
  const set = (key: string, category: BrandToken['category'], value: any, description: string) => {
    const i = out.findIndex((t) => t.key === key);
    if (i >= 0) out[i] = { ...out[i], value, category };
    else out.push({ key, category, value, description });
  };
  for (const r of COLOR_ROLES) if (kit.roles[r.key]) set(r.key, 'color', kit.roles[r.key], r.description);
  const brandStops = (['color.night', 'color.primary', 'color.secondary', 'color.accent'] as const).map((k) => kit.roles[k]).filter(Boolean) as string[];
  if (brandStops.length >= 2) set('gradient.brand', 'gradient', brandStops.map((color, i) => ({ color, pos: +(i / (brandStops.length - 1)).toFixed(3) })), 'Brand gradient (from import)');
  if (kit.displayFont) {
    const cur = out.find((t) => t.key === 'type.display')?.value ?? { weight: 700, tracking: -0.03 };
    set('type.display', 'typography', { ...cur, family: kit.displayFont }, 'Display headlines');
  }
  if (kit.bodyFont) set('type.body', 'typography', { family: kit.bodyFont, weight: 400, tracking: 0 }, 'Body copy');
  if (kit.logoAssetId !== undefined) set('brand.logo', 'behaviour', kit.logoAssetId ?? '', 'Primary logo asset');
  const p = personalityOf(kit.personality);
  set('brand.personality', 'behaviour', p.key, 'Motion personality');
  set('brand.voice', 'behaviour', kit.voice.join(', ').slice(0, 80), 'Brand voice words');
  set('motion.intensity', 'intensity', Math.min(1, +(0.5 * p.amplitude).toFixed(2)), 'Global motion intensity (0–1)');
  return out;
}

/** Read the simple brand kit back out of tokens (for Create and the Brand kit page). */
export function kitFromTokens(tokens: { key: string; value: any }[]) {
  const v = (k: string) => tokens.find((t) => t.key === k)?.value;
  const colors = Object.fromEntries(COLOR_ROLES.map((r) => [r.key, v(r.key) as string | undefined])) as Record<ColorRoleKey, string | undefined>;
  return {
    colors,
    palette: COLOR_ROLES.map((r) => colors[r.key]).filter(Boolean) as string[],
    displayFont: (v('type.display')?.family as string) ?? 'Geist',
    bodyFont: (v('type.body')?.family as string) ?? (v('type.display')?.family as string) ?? 'Inter',
    logoAssetId: (v('brand.logo') as string) || null,
    personality: personalityOf(v('brand.personality')).key,
    voice: String(v('brand.voice') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    gradient: (v('gradient.brand') as { color: string; pos: number }[] | undefined) ?? null,
  };
}
export type BrandKit = ReturnType<typeof kitFromTokens>;
