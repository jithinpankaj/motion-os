import { api } from './api';
import { invalidateAssets } from './assets';
/** A positioned part of an imported design: centre as a fraction of the design, size as a fraction of its shorter side. */
export type DesignLayer = { assetId: string; name: string; x: number; y: number; w: number; h: number };
export type Design = { name: string; width: number; height: number; background: string | null; layers: DesignLayer[] };

/**
 * Turns an uploaded design into positioned layers so each part can move on its own.
 * Everything is rasterised here in the browser (PNG with transparency) and uploaded as normal
 * assets; the original file never leaves the device.
 *
 *   PNG / JPEG / WebP / GIF  → one layer
 *   SVG                      → one layer per top-level element (wrapper groups are unwrapped)
 *   PDF / Illustrator (.ai)  → the chosen page; one layer per PDF layer (optional content group)
 *   Photoshop (.psd)         → one layer per visible pixel layer (grouped when there are many)
 */
export type ImportedDesign = Design & { notes: string[]; source: string };
type Piece = { name: string; canvas: HTMLCanvasElement | OffscreenCanvas; left: number; top: number };
type Progress = (message: string) => void;

const MAX_SIDE = 2048;
const MAX_LAYERS = 24;

export type FileKind = 'raster' | 'svg' | 'pdf' | 'psd';

export async function detectKind(file: File): Promise<FileKind> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const ascii = String.fromCharCode(...head.slice(0, 16));
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (ascii.startsWith('8BPS')) return 'psd';
  if (ascii.startsWith('%!PS-Adobe')) throw new Error('This Illustrator file was saved without PDF compatibility. In Illustrator choose File → Save As, tick “Create PDF Compatible File”, or export as SVG.');
  if (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'raster';
  if (head[0] === 0xff && head[1] === 0xd8) return 'raster';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'raster';
  if (ascii.startsWith('GIF8')) return 'raster';
  const text = new TextDecoder().decode(head).trimStart();
  if (/^(<\?xml|<!--|<!DOCTYPE svg|<svg)/i.test(text)) return 'svg';
  throw new Error('Unsupported file. Upload PNG, JPG, WebP, SVG, PDF, Illustrator (.ai) or Photoshop (.psd).');
}

const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

/** Alpha bounding box; null when the piece is empty. */
function trim(c: HTMLCanvasElement | OffscreenCanvas) {
  const ctx = (c as HTMLCanvasElement).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  const { width: w, height: h } = c;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), 'image/png'));
}

export async function uploadPng(c: HTMLCanvasElement, name: string, category = 'design', tags = 'design-import') {
  const r = await api<{ id: string }>('/assets', { raw: await toBlob(c), query: { name: name.slice(0, 160) || 'Layer', kind: 'image', category, tags } });
  return r.id;
}

/** Crop, upload and position pieces relative to a W×H design. */
async function finish(name: string, W: number, H: number, pieces: Piece[], background: string | null, notes: string[], source: string, progress: Progress): Promise<ImportedDesign> {
  if (pieces.length > MAX_LAYERS) {
    // Merge neighbours so very busy files stay usable; order (and so stacking) is preserved.
    const per = Math.ceil(pieces.length / MAX_LAYERS);
    const merged: Piece[] = [];
    for (let i = 0; i < pieces.length; i += per) {
      const c = canvas(W, H), ctx = c.getContext('2d')!;
      for (const p of pieces.slice(i, i + per)) ctx.drawImage(p.canvas as CanvasImageSource, p.left, p.top);
      merged.push({ name: pieces.slice(i, i + per).map((p) => p.name).join(' + ').slice(0, 80), canvas: c, left: 0, top: 0 });
    }
    notes.push(`${pieces.length} layers were combined into ${merged.length} groups so they stay easy to animate.`);
    pieces = merged;
  }
  const min = Math.min(W, H);
  const layers: DesignLayer[] = [];
  let i = 0;
  for (const p of pieces) {
    i++;
    const box = trim(p.canvas);
    if (!box) continue;
    progress(`Uploading layer ${i} of ${pieces.length}…`);
    const out = canvas(box.w, box.h);
    out.getContext('2d')!.drawImage(p.canvas as CanvasImageSource, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const assetId = await uploadPng(out, `${name} · ${p.name}`);
    layers.push({ assetId, name: p.name, x: (p.left + box.x + box.w / 2) / W, y: (p.top + box.y + box.h / 2) / H, w: box.w / min, h: box.h / min });
  }
  if (!layers.length) throw new Error('The design looks empty — nothing visible was found.');
  invalidateAssets();
  return { name, width: W, height: H, background, layers, notes, source };
}

const baseName = (f: File) => f.name.replace(/\.[^.]+$/, '') || 'Design';

// ---------- raster ----------

async function importRaster(file: File, progress: Progress) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 4096 / Math.max(bmp.width, bmp.height));
  const c = canvas(bmp.width * s, bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const notes = s < 1 ? ['Large image scaled to 4096 px on the long side.'] : [];
  return finish(baseName(file), c.width, c.height, [{ name: baseName(file), canvas: c, left: 0, top: 0 }], null, notes, 'image', progress);
}

// ---------- SVG ----------

const NON_RENDER = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'filter', 'pattern', 'symbol', 'marker', 'script', 'foreignobject']);
const nameOf = (el: Element, i: number) => el.getAttribute('data-name') ?? el.getAttribute('inkscape:label') ?? el.getAttribute('id')?.replace(/[_-]+/g, ' ') ?? `${el.tagName.toLowerCase()} ${i + 1}`;

function loadSvgImage(text: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('The SVG could not be drawn')); };
    img.src = url;
  });
}

export async function importSvgText(text: string, name: string, progress: Progress): Promise<ImportedDesign> {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('That SVG file could not be read');
  const vb = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  let w = vb?.[2] ?? parseFloat(root.getAttribute('width') ?? '0');
  let h = vb?.[3] ?? parseFloat(root.getAttribute('height') ?? '0');
  if (!w || !h) { w = 1080; h = 1080; }
  const s = MAX_SIDE / Math.max(w, h);
  const W = Math.round(w * s), H = Math.round(h * s);
  const renderable = (el: Element) => [...el.children].filter((c) => !NON_RENDER.has(c.tagName.toLowerCase()));
  const shared = [...root.children].filter((c) => NON_RENDER.has(c.tagName.toLowerCase()) && c.tagName.toLowerCase() !== 'script');
  // Unwrap single wrapper groups (Figma/Illustrator exports wrap everything in one <g>).
  const wrappers: Element[] = [];
  let level: Element = root;
  while (renderable(level).length === 1 && renderable(level)[0].tagName.toLowerCase() === 'g') {
    level = renderable(level)[0];
    wrappers.push(level);
    shared.push(...[...level.children].filter((c) => NON_RENDER.has(c.tagName.toLowerCase())));
  }
  const kids = renderable(level);
  const ser = new XMLSerializer();
  const pieceFor = async (nodes: Element[], label: string): Promise<Piece> => {
    const shell = root.cloneNode(false) as Element;
    shell.setAttribute('width', String(W));
    shell.setAttribute('height', String(H));
    if (!shell.getAttribute('viewBox')) shell.setAttribute('viewBox', `0 0 ${w} ${h}`);
    for (const d of shared) shell.appendChild(d.cloneNode(true));
    let parent: Element = shell;
    for (const wr of wrappers) { const c = wr.cloneNode(false) as Element; for (const d of [...wr.children].filter((x) => NON_RENDER.has(x.tagName.toLowerCase()))) c.appendChild(d.cloneNode(true)); parent.appendChild(c); parent = c; }
    for (const n of nodes) parent.appendChild(n.cloneNode(true));
    const img = await loadSvgImage(ser.serializeToString(shell));
    const c = canvas(W, H);
    c.getContext('2d')!.drawImage(img, 0, 0, W, H);
    return { name: label, canvas: c, left: 0, top: 0 };
  };
  const pieces: Piece[] = [];
  const notes: string[] = [];
  if (kids.length <= 1) {
    pieces.push(await pieceFor(kids, name));
    notes.push('This SVG has a single element, so it moves as one piece. Keep top-level groups separate when exporting to animate parts.');
  } else {
    for (let i = 0; i < kids.length; i++) {
      progress(`Reading layer ${i + 1} of ${kids.length}…`);
      pieces.push(await pieceFor([kids[i]], nameOf(kids[i], i)));
    }
  }
  return finish(name, W, H, pieces, null, notes, 'svg', progress);
}

// ---------- PDF / Illustrator ----------

async function pdfjs() {
  const lib = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  lib.GlobalWorkerOptions.workerSrc = worker;
  return lib;
}

export async function pdfPages(file: File): Promise<{ count: number; thumbs: string[] }> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const thumbs: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 12); n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 160 / Math.max(page.view[2], page.view[3]) });
    const c = canvas(vp.width, vp.height);
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
    thumbs.push(c.toDataURL('image/png'));
  }
  const count = doc.numPages;
  await doc.destroy();
  return { count, thumbs };
}

async function importPdf(file: File, pageNo: number, progress: Progress): Promise<ImportedDesign> {
  const lib = await pdfjs();
  progress('Opening document…');
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
    const vp = page.getViewport({ scale: MAX_SIDE / Math.max(page.view[2] - page.view[0], page.view[3] - page.view[1]) });
    const W = Math.round(vp.width), H = Math.round(vp.height);
    const render = async (occ?: any) => {
      const c = canvas(W, H);
      await page.render({ canvasContext: c.getContext('2d', { willReadFrequently: true })!, viewport: vp, background: 'rgba(0,0,0,0)', ...(occ ? { optionalContentConfigPromise: Promise.resolve(occ) } : {}) }).promise;
      return c;
    };
    const cfg = await doc.getOptionalContentConfig();
    const groups: { id: string; name: string }[] = [];
    const all = Object.entries((cfg as any).getGroups?.() ?? {}) as [string, any][];
    for (const [id, g] of all) if (g.visible) groups.push({ id, name: g.name ?? `Layer ${groups.length + 1}` });
    const notes: string[] = [];
    const pieces: Piece[] = [];
    const isAi = /\.ai$/i.test(file.name);
    if (groups.length >= 2) {
      // Content outside any layer renders in every pass; render it once and subtract it from each layer.
      const hideAll = async () => { const c = await doc.getOptionalContentConfig(); for (const id of Object.keys((c as any).getGroups?.() ?? {})) c.setVisibility(id, false); return c; };
      const base = await render(await hideAll());
      const baseData = base.getContext('2d')!.getImageData(0, 0, W, H).data;
      const hasBase = !!trim(base);
      if (hasBase) pieces.push({ name: 'Base', canvas: base, left: 0, top: 0 });
      for (let i = 0; i < groups.length; i++) {
        progress(`Reading layer ${i + 1} of ${groups.length}…`);
        const c = await hideAll();
        c.setVisibility(groups[i].id, true);
        const out = await render(c);
        if (hasBase) {
          const ctx = out.getContext('2d')!;
          const img = ctx.getImageData(0, 0, W, H);
          const d = img.data;
          for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - baseData[k]) + Math.abs(d[k + 1] - baseData[k + 1]) + Math.abs(d[k + 2] - baseData[k + 2]) + Math.abs(d[k + 3] - baseData[k + 3]) < 6) d[k + 3] = 0;
          ctx.putImageData(img, 0, 0);
        }
        pieces.push({ name: groups[i].name, canvas: out, left: 0, top: 0 });
      }
    } else {
      progress('Rendering page…');
      pieces.push({ name: baseName(file), canvas: await render(), left: 0, top: 0 });
      notes.push(isAi
        ? 'No separate layers were found, so the artwork moves as one piece. For layers, export from Illustrator as SVG, or save a PDF with “Create Acrobat Layers from Top-Level Layers”.'
        : 'This page has no layers, so it moves as one piece. Export an SVG or a layered PDF to animate parts separately.');
    }
    return finish(baseName(file), W, H, pieces, null, notes, isAi ? 'illustrator' : 'pdf', progress);
  } finally { await doc.destroy(); }
}

// ---------- Photoshop ----------

async function importPsd(file: File, progress: Progress): Promise<ImportedDesign> {
  progress('Reading Photoshop layers…');
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(await file.arrayBuffer(), { skipThumbnail: true, skipLinkedFilesData: true, useImageData: false });
  const s = Math.min(1, 4096 / Math.max(psd.width, psd.height));
  const W = Math.round(psd.width * s), H = Math.round(psd.height * s);
  const notes: string[] = [];
  const draw = (target: CanvasRenderingContext2D, l: any) => {
    if (!l.canvas) return;
    target.globalAlpha = l.opacity ?? 1;
    target.drawImage(l.canvas, (l.left ?? 0) * s, (l.top ?? 0) * s, l.canvas.width * s, l.canvas.height * s);
    target.globalAlpha = 1;
  };
  const leaves = (nodes: any[] = []): any[] => nodes.flatMap((n) => (n.hidden ? [] : n.children ? leaves(n.children) : n.canvas ? [n] : []));
  const top = (psd.children ?? []).filter((n: any) => !n.hidden);
  let pieces: Piece[] = [];
  const all = leaves(top);
  const groupsOf = all.length > MAX_LAYERS ? top : all;
  for (const n of groupsOf) {
    const c = canvas(W, H), ctx = c.getContext('2d')!;
    for (const leaf of n.children ? leaves(n.children) : [n]) draw(ctx, leaf);
    pieces.push({ name: n.name ?? 'Layer', canvas: c, left: 0, top: 0 });
  }
  if (all.length > MAX_LAYERS) notes.push(`${all.length} layers were grouped by their top-level folders.`);
  if (!pieces.length && psd.canvas) {
    const c = canvas(W, H); c.getContext('2d')!.drawImage(psd.canvas as any, 0, 0, W, H);
    pieces = [{ name: baseName(file), canvas: c, left: 0, top: 0 }];
    notes.push('No pixel layers found; the flattened image was used.');
  }
  if (all.some((l: any) => l.effects) || (psd.children ?? []).some((l: any) => l.adjustment)) notes.push('Layer styles (shadows, strokes) and adjustment layers are not applied. Rasterise them in Photoshop if they matter.');
  return finish(baseName(file), W, H, pieces, null, notes, 'photoshop', progress);
}

// ---------- entry points ----------

export async function importDesignFile(file: File, opts: { page?: number; progress?: Progress } = {}): Promise<ImportedDesign> {
  const progress = opts.progress ?? (() => {});
  if (file.size > 150e6) throw new Error('Files up to 150 MB can be imported');
  const kind = await detectKind(file);
  if (kind === 'raster') return importRaster(file, progress);
  if (kind === 'svg') return importSvgText(await file.text(), baseName(file), progress);
  if (kind === 'pdf') return importPdf(file, opts.page ?? 1, progress);
  return importPsd(file, progress);
}

export async function importFigma(link: string): Promise<ImportedDesign> {
  const r = await api<{ name: string; width: number; height: number; background: string | null; layers: { assetId: string; name: string; box: { x: number; y: number; width: number; height: number } }[]; notes: string[] }>('/design-import/figma', { body: { link } });
  const min = Math.min(r.width, r.height);
  invalidateAssets();
  return {
    name: r.name, width: r.width, height: r.height, background: r.background, notes: r.notes, source: 'figma',
    layers: r.layers.map((l) => ({ assetId: l.assetId, name: l.name, x: (l.box.x + l.box.width / 2) / r.width, y: (l.box.y + l.box.height / 2) / r.height, w: l.box.width / min, h: l.box.height / min })),
  };
}

/** Rasterise an SVG string (element maker, uploaded SVG elements) to a trimmed PNG asset. */
export async function svgToAsset(svg: string, name: string, size = 1024, category = 'element') {
  const img = await loadSvgImage(svg);
  const ratio = (img.naturalWidth || 1) / (img.naturalHeight || 1);
  const c = canvas(ratio >= 1 ? size : size * ratio, ratio >= 1 ? size / ratio : size);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const box = trim(c) ?? { x: 0, y: 0, w: c.width, h: c.height };
  const out = canvas(box.w, box.h);
  out.getContext('2d')!.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const id = await uploadPng(out, name, category, category);
  invalidateAssets();
  return { id, width: box.w, height: box.h };
}

/** Sample pixels for palette extraction (logo / image / PDF page). */
export async function samplePixels(source: Blob | HTMLCanvasElement, size = 160): Promise<Uint8ClampedArray> {
  let bmp: CanvasImageSource;
  if (source instanceof Blob) {
    if (source.type === 'image/svg+xml' || /^\s*(<\?xml|<svg)/i.test(await source.slice(0, 200).text())) bmp = await loadSvgImage(await source.text());
    else bmp = await createImageBitmap(source);
  } else bmp = source;
  const w = (bmp as any).width || 1, h = (bmp as any).height || 1;
  const s = Math.min(1, size / Math.max(w, h));
  const c = canvas(w * s, h * s);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

/** Text and rendered pages of a guidelines PDF, for colour codes, font names and palette. */
export async function readPdfForBrand(file: File, progress: Progress = () => {}) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  let text = '';
  const pixels: Uint8ClampedArray[] = [];
  try {
    const n = Math.min(doc.numPages, 40);
    for (let i = 1; i <= n; i++) {
      progress(`Reading page ${i} of ${n}…`);
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it: any) => (it.str ?? '') + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
      if (i <= 6) {
        const vp = page.getViewport({ scale: 200 / Math.max(page.view[2], page.view[3]) });
        const c = canvas(vp.width, vp.height);
        await page.render({ canvasContext: c.getContext('2d', { willReadFrequently: true })!, viewport: vp }).promise;
        pixels.push(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data);
      }
    }
  } finally { await doc.destroy(); }
  return { text, pixels };
}

/** Upload a PNG/JPEG/WebP/SVG file as a reusable element (trimmed, transparent PNG). */
export async function elementFromFile(file: File, category = 'element') {
  const kind = await detectKind(file);
  const name = baseName(file);
  if (kind === 'svg') return svgToAsset(await file.text(), name, 1024, category);
  if (kind !== 'raster') throw new Error('Elements can be PNG, JPG, WebP or SVG');
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const c = canvas(bmp.width * s, bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const box = trim(c) ?? { x: 0, y: 0, w: c.width, h: c.height };
  const out = canvas(box.w, box.h);
  out.getContext('2d')!.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const id = await uploadPng(out, name, category, category);
  invalidateAssets();
  return { id, width: box.w, height: box.h };
}
