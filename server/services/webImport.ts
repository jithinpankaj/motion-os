import { HttpError } from '../http';
import { svgProblems } from './sniff';
import { safeFetch } from './safeFetch';
import { colorsInText, fontsInCss, inferTone, mergePalette, parseColor, type BrandFindings, type FoundColor } from '../../shared/brandImport';

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((x) => x !== undefined);
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

/** Read a public website and extract brand colours, fonts, logo candidates and copy for tone. */
export async function importFromWebsite(rawUrl: string): Promise<BrandFindings> {
  const url = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  const page = await safeFetch(url, { accept: 'text/html,application/xhtml+xml', maxBytes: 3e6 });
  if (!page.ok) throw new HttpError(502, 'fetch_failed', `The site answered with HTTP ${page.status}`);
  if (!/html/i.test(page.contentType)) throw new HttpError(400, 'not_html', 'That link is not a web page');
  const html = page.body.toString('utf8');
  const base = page.url;
  const abs = (u: string | undefined) => { if (!u) return undefined; try { return new URL(decode(u), base).toString(); } catch { return undefined; } };
  const notes: string[] = [];
  const tags = (name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
  const meta = (key: string) => tags('meta').find((t) => (attr(t, 'name') ?? attr(t, 'property'))?.toLowerCase() === key);
  const metaContent = (key: string) => { const t = meta(key); return t ? decode(attr(t, 'content') ?? '') : undefined; };

  // CSS: inline <style>, style attributes, and up to six linked stylesheets.
  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const inline = [...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join(';');
  const sheets = tags('link').filter((t) => /stylesheet/i.test(attr(t, 'rel') ?? '')).map((t) => abs(attr(t, 'href'))).filter(Boolean) as string[];
  let fetched = 0;
  for (const href of sheets.slice(0, 6)) {
    if (/fonts\.googleapis\.com/.test(href)) { css += `\n/* ${href} */`; continue; }
    try { const r = await safeFetch(href, { accept: 'text/css', maxBytes: 2e6, timeoutMs: 6000 }); if (r.ok) { css += '\n' + r.body.toString('utf8'); fetched++; } } catch { /* one bad stylesheet should not fail the import */ }
  }
  if (sheets.length > 6) notes.push(`Read 6 of ${sheets.length} stylesheets.`);
  if (sheets.length && !fetched) notes.push('Stylesheets could not be read; colours come from the page itself.');

  const colors: FoundColor[] = [];
  const theme = parseColor(metaContent('theme-color') ?? '');
  if (theme) colors.push({ hex: theme, weight: 40, source: 'theme-color' });
  // Custom properties named like brand roles are the strongest signal on modern sites.
  for (const m of css.matchAll(/--([\w-]*(?:brand|primary|secondary|accent|main|highlight|cta)[\w-]*)\s*:\s*([^;}{]+)/gi)) {
    const hex = parseColor(m[2]);
    if (hex) colors.push({ hex, weight: 12, source: `--${m[1]}`, name: m[1] });
  }
  for (const m of css.matchAll(/(?:^|[;{\s])(background(?:-color)?|color|fill|border-color)\s*:\s*([^;}{]+)/gi)) {
    for (const c of colorsInText(m[2], m[1].toLowerCase(), m[1].startsWith('background') ? 1.5 : 1)) colors.push(c);
  }
  colors.push(...colorsInText(inline, 'inline style', 2));
  if (!colors.length) notes.push('No colours were found in the page CSS. Try uploading your logo instead.');

  const fonts = fontsInCss(css + '\n' + tags('link').map((t) => attr(t, 'href') ?? '').join('\n'));

  // Inline SVG logos: an <svg> labelled as a logo, or inside a link/element whose class or label says logo/home.
  const logoSvgs: string[] = [];
  for (const m of html.matchAll(/<(a|div|span|header)\b([^>]*)>\s*(<svg\b[\s\S]*?<\/svg>)/gi)) {
    const ctx = m[2], svg = m[3];
    const own = svg.match(/^<svg\b[^>]*>/i)?.[0] ?? '';
    if (!/logo|brand|home|wordmark/i.test(ctx + own) || svg.length > 60_000 || svgProblems(svg).length) continue;
    const withNs = /xmlns=/.test(own) ? svg : svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    // currentColor inherits from the page; resolve it to the page's text colour so the logo stays visible.
    logoSvgs.push(withNs.replace(/currentColor/g, theme ?? '#111111'));
    if (logoSvgs.length >= 3) break;
  }

  // Logo candidates, best first: touch icons, mask icons and SVG favicons are the brand mark itself.
  const logos: string[] = [];
  for (const t of tags('link')) {
    const rel = (attr(t, 'rel') ?? '').toLowerCase();
    if (/apple-touch-icon|mask-icon/.test(rel)) { const u = abs(attr(t, 'href')); if (u) logos.push(u); }
  }
  for (const t of tags('link')) if (/(^|\s)icon(\s|$)/.test((attr(t, 'rel') ?? '').toLowerCase())) { const u = abs(attr(t, 'href')); if (u && /\.(svg|png)(\?|$)/i.test(u)) logos.push(u); }
  for (const t of tags('img')) {
    const s = `${attr(t, 'class') ?? ''} ${attr(t, 'id') ?? ''} ${attr(t, 'alt') ?? ''} ${attr(t, 'src') ?? ''}`;
    // Only the site's own logo: alt/class mentions logo and the site name, or it lives at a /logo path.
    if (/logo|brand/i.test(s) && logos.length < 8) { const u = abs(attr(t, 'src')); if (u && !u.startsWith('data:')) logos.push(u); }
  }
  const og = abs(metaContent('og:image'));
  if (og) logos.push(og);

  const title = decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '');
  const description = metaContent('description') ?? metaContent('og:description') ?? '';
  const name = metaContent('og:site_name') ?? title.split(/[|\-–—:]/)[0].trim();
  const bodyText = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').slice(0, 20000);
  const palette = mergePalette(colors, 10);
  const tone = inferTone(`${title} ${description} ${bodyText}`, palette);
  return {
    source: 'website', name: name || undefined, colors: palette, fonts,
    logoUrl: logoSvgs.length ? undefined : logos[0], logoCandidates: [...new Set(logos)].slice(0, 6), logoSvgs,
    description: description || undefined,
    voice: tone.voice, personality: tone.personality, personalityReason: tone.reason, notes,
  };
}
