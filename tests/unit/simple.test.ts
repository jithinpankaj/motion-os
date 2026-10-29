import { describe, it, expect } from 'vitest';
import { applyKitToTokens, closestFont, colorsInText, fontsInCss, fontsInDocument, inferTone, kitFromTokens, mergePalette, paletteFromPixels, parseColor, prettyFontName, suggestRoles } from '../../shared/brandImport';
import { DEFAULT_BRAND_TOKENS } from '../../shared/brand';
import { buildMotion, fitCanvas, freeSpot, isBackgroundLayer, MOTION_STYLES, RecipeSchema, type Design } from '../../shared/motionStyles';
import { deserializeScene } from '../../shared/scene/serialize';
import { evaluateLayers } from '../../shared/timeline';
import { safeFetch, setFetchImpl } from '../../server/services/safeFetch';
import { parseFigmaLink } from '../../server/services/figma';
import { parseLinkedInPost, defaultLinkedInVersion } from '../../server/analytics/providers';

describe('brand import parsing', () => {
  it('parses CSS colour syntaxes and skips transparent values', () => {
    expect(parseColor('#abc')).toBe('#aabbcc');
    expect(parseColor('#FF5A36')).toBe('#ff5a36');
    expect(parseColor('rgb(22, 163, 160)')).toBe('#16a3a0');
    expect(parseColor('rgba(0,0,0,0)')).toBeNull();
    expect(parseColor('#00000000')).toBeNull();
    expect(parseColor('hsl(0, 100%, 50%)')).toBe('#ff0000');
  });
  it('finds colour codes written in guideline documents', () => {
    const found = colorsInText('Navy HEX #0B1F3A RGB 11 31 58. Coral C 0 M 65 Y 79 K 0', 'doc');
    const hexes = mergePalette(found).map((c) => c.hex);
    expect(hexes).toContain('#0b1f3a');
    expect(hexes.some((h) => h.startsWith('#ff'))).toBe(true);
  });
  it('reads fonts from CSS and documents, and maps them to available fonts', () => {
    expect(fontsInCss('h1{font-family:"sohne-var", Helvetica} code{font-family: SourceCodePro, monospace}')).toEqual(['Sohne', 'Source Code Pro']);
    expect(fontsInDocument('Headline font: Playfair Display\nBody font: Inter')).toEqual(['Playfair Display', 'Inter']);
    expect(prettyFontName('__Inter_Fallback_a1b2c3')).toBe('Inter');
    expect(closestFont('Inter')).toEqual({ family: 'Inter', exact: true });
    expect(closestFont('Playfair Display').exact).toBe(false);
    expect(closestFont('JetBrains Mono').family).toBe('Geist Mono');
  });
  it('clusters image pixels into a palette and suggests readable roles', () => {
    const px = new Uint8ClampedArray(400 * 4);
    for (let i = 0; i < 400; i++) px.set(i < 200 ? [11, 31, 58, 255] : i < 300 ? [255, 90, 54, 255] : [245, 241, 234, 255], i * 4);
    const pal = paletteFromPixels(px, 'img');
    expect(pal.length).toBe(3);
    const roles = suggestRoles(pal);
    expect(roles['color.night']).toBe('#0b1f3a');
    expect(roles['color.paper']).toBe('#f5f1ea');
    expect(roles['color.primary']).toBe('#ff5a36');
  });
  it('suggests a personality from copy and explains why', () => {
    const t = inferTone('Calm, trusted care for your wellbeing. Simple and secure.');
    expect(t.personality).toBe('calm');
    expect(t.reason).toMatch(/calm|trusted|care/);
    expect(new Set(t.voice).size).toBe(t.voice.length);
  });
  it('merges a reviewed import into tokens without dropping untouched ones', () => {
    const next = applyKitToTokens(DEFAULT_BRAND_TOKENS, { roles: { 'color.primary': '#16a3a0' }, displayFont: 'Fraunces', personality: 'energetic', voice: ['bold'], logoAssetId: 'ast_logo1' });
    expect(next.length).toBeGreaterThanOrEqual(DEFAULT_BRAND_TOKENS.length);
    const kit = kitFromTokens(next);
    expect(kit.colors['color.primary']).toBe('#16a3a0');
    expect(kit.colors['color.accent']).toBe('#ff5a36');
    expect(kit.displayFont).toBe('Fraunces');
    expect(kit.personality).toBe('energetic');
    expect(kit.logoAssetId).toBe('ast_logo1');
  });
});

describe('motion styles', () => {
  const kit = kitFromTokens(DEFAULT_BRAND_TOKENS);
  const design: Design = { name: 'Poster', width: 1080, height: 1350, background: null, layers: [
    { assetId: 'ast_bg', name: 'Background', x: 0.5, y: 0.5, w: 1, h: 1.25 },
    { assetId: 'ast_sun', name: 'Sun', x: 0.7, y: 0.28, w: 0.37, h: 0.37 },
    { assetId: 'ast_text', name: 'Headline', x: 0.4, y: 0.87, w: 0.7, h: 0.1 },
  ] };
  it('every style produces a valid scene for a design and for brand-only', () => {
    for (const s of MOTION_STYLES) {
      for (const d of s.needsDesign ? [design] : [design, null]) {
        for (const personality of ['calm', 'balanced', 'energetic', 'playful'] as const) {
          const doc = buildMotion({ design: d, brand: kit, style: s.key, personality, headline: 'Hello', showLogo: true, duration: 8 });
          expect(() => deserializeScene(JSON.parse(JSON.stringify(doc)))).not.toThrow();
          expect(evaluateLayers(doc, 4).length).toBe(doc.layers.length);
        }
      }
    }
  });
  it('detects the background layer and fits canvases', () => {
    expect(isBackgroundLayer(design.layers[0], 1080, 1350)).toBe(true);
    expect(isBackgroundLayer(design.layers[1], 1080, 1350)).toBe(false);
    expect(fitCanvas(2048, 2560)).toEqual({ width: 1536, height: 1920 });
  });
  it('places the headline away from the design’s own text', () => {
    const doc = buildMotion({ design, brand: kit, style: 'build', headline: 'Feel the season' });
    const t = doc.layers.find((l) => l.type === 'text')!;
    expect(Math.abs(t.transform.y - 0.87)).toBeGreaterThan(0.2);
    expect(freeSpot(design.layers.slice(1), 1080, 1350, { w: 0.3, h: 0.2 }, [{ x: 0.7, y: 0.28 }, { x: 0.2, y: 0.5 }])).toEqual({ x: 0.2, y: 0.5 });
  });
  it('parts arrive and are fully visible mid-loop in build style', () => {
    const doc = buildMotion({ design, brand: kit, style: 'build', personality: 'balanced' });
    const at = (t: number) => evaluateLayers(doc, t).filter((l) => l.type === 'image' && l.name !== 'Background').map((l) => l.opacity);
    expect(at(0.05).every((o) => o < 0.05)).toBe(true);
    expect(at(4).every((o) => o > 0.99)).toBe(true);
  });
  it('recipes validate and reject bad layer ids', () => {
    const r = { design, style: 'float', personality: 'calm', headline: '', showLogo: false, keepBackground: null, duration: 8, format: 'original' };
    expect(RecipeSchema.safeParse(r).success).toBe(true);
    expect(RecipeSchema.safeParse({ ...r, design: { ...design, layers: [{ ...design.layers[0], assetId: '../x' }] } }).success).toBe(false);
  });
});

describe('outbound safety and link parsing', () => {
  it('blocks private and non-http destinations', async () => {
    await expect(safeFetch('http://127.0.0.1:8787/api/session')).rejects.toThrow(/private/);
    await expect(safeFetch('http://localhost/')).rejects.toThrow(/private/);
    await expect(safeFetch('http://[::1]/')).rejects.toThrow(/private/);
    await expect(safeFetch('http://10.0.0.5/')).rejects.toThrow(/private/);
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/http/);
  });
  it('re-checks every redirect hop', async () => {
    setFetchImpl(async (url) => (url.startsWith('https://public.example') ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }) : new Response('secret')));
    try {
      // Host checks stay on: the redirect target is a link-local metadata address.
      await expect(safeFetch('https://public.example/')).rejects.toThrow();
    } finally { setFetchImpl((u, i) => fetch(u, i)); }
  });
  it('parses Figma and LinkedIn links', () => {
    expect(parseFigmaLink('https://www.figma.com/design/AbCdEfGhIjKl/Poster?node-id=12-34')).toEqual({ fileKey: 'AbCdEfGhIjKl', nodeId: '12:34' });
    expect(() => parseFigmaLink('https://evil.com/design/AbCdEfGhIjKl')).toThrow();
    expect(parseLinkedInPost('https://www.linkedin.com/embed/feed/update/urn:li:share:7123456789')).toBe('urn:li:share:7123456789');
    expect(() => parseLinkedInPost('https://www.linkedin.com/posts/foo')).toThrow();
    expect(defaultLinkedInVersion(new Date(Date.UTC(2026, 9, 29)))).toBe('202608');
  });
});
