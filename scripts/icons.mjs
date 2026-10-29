// usage: node scripts/icons.mjs
//
// Builds the app's hand-drawn icon set (src/ui/icons.ts) from Phosphor (https://phosphoricons.com,
// MIT licence). Each icon's outline is redrawn with a gentle wobble: straight edges become slight
// curves, points drift along a smooth noise field (so a line bends as a whole and keeps its weight),
// a finer field varies the weight a touch, and every icon gets its own small tilt. The result is
// deterministic: the same icon always looks the same. "Expressive" icons also get an accent shape
// (Phosphor's filled variant) that the app prints slightly off-register in a warm colour.
import { writeFileSync } from 'node:fs';

const V = '2.1.1';
const MAP = {
  home: 'house', explore: 'compass', studio: 'magic-wand', campaigns: 'megaphone', brand: 'palette', assets: 'images', integrations: 'plugs',
  settings: 'gear-six', play: 'play', pause: 'pause', stepBack: 'skip-back', stepFwd: 'skip-forward', restart: 'arrow-counter-clockwise', loop: 'repeat',
  plus: 'plus', minus: 'minus', trash: 'trash', copy: 'copy', eye: 'eye', eyeOff: 'eye-slash', lock: 'lock-simple', unlock: 'lock-simple-open',
  chevronDown: 'caret-down', chevronRight: 'caret-right', chevronLeft: 'caret-left', chevronUp: 'caret-up', x: 'x', search: 'magnifying-glass', check: 'check',
  alert: 'warning', info: 'info', sound: 'speaker-high', mute: 'speaker-slash', link: 'link-simple', key: 'diamond', layers: 'stack', type: 'text-t',
  image: 'image', sphere: 'globe-simple', sparkles: 'sparkle', gradient: 'gradient', group: 'folder-simple', grid: 'grid-four', maximize: 'corners-out',
  fit: 'frame-corners', zoomIn: 'magnifying-glass-plus', zoomOut: 'magnifying-glass-minus', download: 'download-simple', upload: 'upload-simple',
  undo: 'arrow-u-up-left', redo: 'arrow-u-up-right', more: 'dots-three', user: 'user', logout: 'sign-out', command: 'command', code: 'code',
  history: 'clock-counter-clockwise', branch: 'git-branch', compare: 'columns', shield: 'shield', send: 'paper-plane-tilt', clock: 'clock',
  refresh: 'arrows-clockwise', external: 'arrow-square-out', wand: 'magic-wand', drag: 'dots-six-vertical', gauge: 'gauge', monitor: 'monitor',
  phone: 'device-mobile', film: 'film-strip', file: 'file', folder: 'folder-simple', crosshair: 'crosshair-simple', move: 'arrows-out-cardinal',
  orbit: 'planet', safe: 'selection', stack: 'rows', chart: 'chart-bar', library: 'books', shapes: 'shapes', globe: 'globe', sun: 'sun', moon: 'moon',
  heart: 'heart', rect: 'square', ellipse: 'circle', polygon: 'hexagon', star: 'star', particles: 'confetti', pin: 'push-pin', text: 'text-t', remix: 'shuffle',
};
// Icons that carry a warm accent fill (their Phosphor "fill" shape, printed off-register behind the line).
const ACCENT = ['home', 'globe', 'library', 'settings', 'heart', 'star', 'sparkles', 'sun', 'moon', 'play', 'image', 'film', 'shapes', 'particles', 'pin', 'studio', 'folder'];
// A filled heart for "liked" (line + full warm fill).
const EXTRA_FILL = { heartFill: 'heart' };

const fetchPaths = async (weight, file) => {
  const res = await fetch(`https://unpkg.com/@phosphor-icons/core@${V}/assets/${weight}/${weight === 'regular' ? file : `${file}-fill`}.svg`);
  if (!res.ok) throw new Error(`${weight}/${file}: ${res.status}`);
  return [...(await res.text()).matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
};

// ---- path parsing: everything to absolute M / L / C / Q / A / Z ----
function parse(d) {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  const out = []; let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null;
  const num = () => parseFloat(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'M') { x = ox + num(); y = oy + num(); sx = x; sy = y; out.push(['M', x, y]); cmd = rel ? 'l' : 'L'; lc = lq = null; continue; }
    if (C === 'Z') { out.push(['Z']); x = sx; y = sy; lc = lq = null; continue; }
    if (C === 'L') { x = ox + num(); y = oy + num(); out.push(['L', x, y]); lc = lq = null; continue; }
    if (C === 'H') { x = (rel ? x : 0) + num(); out.push(['L', x, y]); lc = lq = null; continue; }
    if (C === 'V') { y = (rel ? y : 0) + num(); out.push(['L', x, y]); lc = lq = null; continue; }
    if (C === 'C') { const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()]; out.push(['C', ...a]); lc = [a[2], a[3]]; x = a[4]; y = a[5]; lq = null; continue; }
    if (C === 'S') { const r1 = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y]; const a = [ox + num(), oy + num(), ox + num(), oy + num()]; out.push(['C', ...r1, ...a]); lc = [a[0], a[1]]; x = a[2]; y = a[3]; lq = null; continue; }
    if (C === 'Q') { const a = [ox + num(), oy + num(), ox + num(), oy + num()]; out.push(['Q', ...a]); lq = [a[0], a[1]]; x = a[2]; y = a[3]; lc = null; continue; }
    if (C === 'T') { const q = lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y]; const a = [ox + num(), oy + num()]; out.push(['Q', ...q, ...a]); lq = q; x = a[0]; y = a[1]; lc = null; continue; }
    if (C === 'A') { const rx = num(), ry = num(), rot = num(), la = num(), sw = num(); x = ox + num(); y = oy + num(); out.push(['A', rx, ry, rot, la, sw, x, y]); lc = lq = null; continue; }
    throw new Error(`unknown command ${cmd}`);
  }
  return out;
}

// ---- the hand: smooth noise fields ----
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };
function hand(seed) {
  const p = [1, 2, 3, 4, 5, 6].map((k) => hash(`${seed}:${k}`) * Math.PI * 2);
  const BEND = 6.5, GRAIN = 1.6, f1 = 0.021, f2 = 0.017, g = 0.11;
  const tilt = (hash(`${seed}:tilt`) - 0.5) * 3.2 * (Math.PI / 180);
  return (x, y) => {
    // rotate a touch around the centre, then drift along the smooth field, plus a little grain
    const cx = 128 + (x - 128) * Math.cos(tilt) - (y - 128) * Math.sin(tilt), cy = 128 + (x - 128) * Math.sin(tilt) + (y - 128) * Math.cos(tilt);
    const dx = BEND * (Math.sin(cy * f1 + p[0]) * 0.6 + Math.sin((cx + cy) * f2 + p[1]) * 0.4) + GRAIN * Math.sin(cx * g + cy * g * 0.7 + p[2]);
    const dy = BEND * (Math.sin(cx * f1 + p[3]) * 0.6 + Math.sin((cx - cy) * f2 + p[4]) * 0.4) + GRAIN * Math.sin(cy * g + cx * g * 0.6 + p[5]);
    return [cx + dx, cy + dy];
  };
}
const r1 = (n) => +n.toFixed(1);
function sketch(d, seed) {
  const h = hand(seed);
  const out = []; let px = 0, py = 0, sx = 0, sy = 0;
  for (const s of parse(d)) {
    if (s[0] === 'M') { [px, py] = [s[1], s[2]]; [sx, sy] = [px, py]; const [a, b] = h(px, py); out.push(`M${r1(a)} ${r1(b)}`); continue; }
    if (s[0] === 'Z') { // close with a gently bowed line back to the start
      if (Math.hypot(sx - px, sy - py) > 1) out.push(line(h, px, py, sx, sy));
      out.push('Z'); [px, py] = [sx, sy]; continue;
    }
    if (s[0] === 'L') { out.push(line(h, px, py, s[1], s[2])); [px, py] = [s[1], s[2]]; continue; }
    if (s[0] === 'C') { const [a, b] = h(s[1], s[2]), [c, e] = h(s[3], s[4]), [f, k] = h(s[5], s[6]); out.push(`C${r1(a)} ${r1(b)} ${r1(c)} ${r1(e)} ${r1(f)} ${r1(k)}`); [px, py] = [s[5], s[6]]; continue; }
    if (s[0] === 'Q') { const [a, b] = h(s[1], s[2]), [f, k] = h(s[3], s[4]); out.push(`Q${r1(a)} ${r1(b)} ${r1(f)} ${r1(k)}`); [px, py] = [s[3], s[4]]; continue; }
    if (s[0] === 'A') { const [f, k] = h(s[6], s[7]); out.push(`A${r1(s[1])} ${r1(s[2])} ${s[3]} ${s[4]} ${s[5]} ${r1(f)} ${r1(k)}`); [px, py] = [s[6], s[7]]; continue; }
  }
  return out.join('');
}
// A straight edge becomes a slight curve: its thirds follow the field, so long lines bow like a pen stroke.
function line(h, x0, y0, x1, y1) {
  const at = (t) => h(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  const [a, b] = at(1 / 3), [c, e] = at(2 / 3), [f, k] = at(1);
  return `C${r1(a)} ${r1(b)} ${r1(c)} ${r1(e)} ${r1(f)} ${r1(k)}`;
}

const lines = [];
for (const [key, file] of Object.entries(MAP)) {
  const outline = (await fetchPaths('regular', file)).map((d) => sketch(d, key)).join('');
  const accent = ACCENT.includes(key) ? (await fetchPaths('fill', file)).map((d) => sketch(d, `${key}:accent`)).join('') : undefined;
  lines.push(`  ${key}: { d: ${JSON.stringify(outline)}${accent ? `, accent: ${JSON.stringify(accent)}` : ''} },`);
}
for (const [key, file] of Object.entries(EXTRA_FILL)) {
  const outline = (await fetchPaths('regular', file)).map((d) => sketch(d, file)).join('');
  const fill = (await fetchPaths('fill', file)).map((d) => sketch(d, `${file}:accent`)).join('');
  lines.push(`  ${key}: { d: ${JSON.stringify(outline)}, accent: ${JSON.stringify(fill)}, solid: true },`);
}
writeFileSync(new URL('../src/ui/icons.ts', import.meta.url), `/**
 * The app's hand-drawn icons, generated by scripts/icons.mjs from Phosphor (phosphoricons.com,
 * MIT licence, @phosphor-icons/core ${V}). Each outline is redrawn with a gentle, deterministic wobble
 * on Phosphor's 256 × 256 grid. \`accent\` is a filled shape the app prints off-register in a warm
 * colour behind the line; \`solid\` icons print it in place, fully (like a filled heart).
 * Regenerate rather than hand-edit.
 */
export type HandIcon = { d: string; accent?: string; solid?: boolean };
export const ICONS: Record<string, HandIcon> = {
${lines.join('\n')}
};
`);
console.log(lines.length, 'icons written');
