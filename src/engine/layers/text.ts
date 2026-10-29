import * as THREE from 'three';
import type { LayerOf, TextProps } from '../../../shared/scene/schema';
import { ease } from '../../../shared/util/easing';
import { ensureFont, isKnownFont } from '../fonts';
import { QUAD_VERT, TEXT_FRAG } from '../shaders';
import { applyBlend, placeQuad, revealProgress, type Bounds, type FrameContext, type LayerView } from './base';

type Glyph = { ch: string; x: number; w: number; line: number; word: number };
type Layout = { glyphs: Glyph[]; lines: { y: number; w: number; x: number }[]; boxW: number; boxH: number; size: number; lineH: number; font: string; pad: number; scale: number; truncated: boolean };

const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?<>/';
const makeCanvas = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};
let measureCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
const measurer = () => (measureCtx ??= makeCanvas(8, 8).getContext('2d') as any)!;

export function layoutText(p: TextProps, family: string, width: number, height: number, renderScale: number): Layout {
  const minDim = Math.min(width, height);
  const size = p.size * minDim;
  const lineH = size * p.lineHeight;
  const track = p.tracking * size;
  const font = `${p.weight} ${size}px "${family}", "Geist", system-ui, sans-serif`;
  const m = measurer();
  m.font = font;
  const widthOf = (s: string) => (s.length ? m.measureText(s).width + track * (s.length - 1) : 0);
  let text = p.text;
  let truncated = false;
  if (p.maxChars && [...text].length > p.maxChars) { text = [...text].slice(0, Math.max(1, p.maxChars - 1)).join('') + '…'; truncated = true; }
  const maxW = p.maxWidth * width;
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(' ');
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && widthOf(next) > maxW) { lines.push(cur); cur = w; } else cur = next;
    }
    lines.push(cur);
  }
  const lineWidths = lines.map(widthOf);
  const boxW = Math.max(1, ...lineWidths);
  const boxH = lines.length * lineH;
  const pad = Math.ceil(size * 0.6);
  const glyphs: Glyph[] = [];
  let word = 0;
  const outLines = lines.map((line, li) => {
    const lw = lineWidths[li];
    const x0 = p.align === 'left' ? 0 : p.align === 'right' ? boxW - lw : (boxW - lw) / 2;
    const chars = [...line];
    let prefix = '';
    chars.forEach((ch) => {
      const x = x0 + (prefix.length ? m.measureText(prefix).width + track * prefix.length : 0);
      glyphs.push({ ch, x, w: m.measureText(ch).width, line: li, word });
      if (ch === ' ') word++;
      prefix += ch;
    });
    word++;
    return { y: li * lineH, w: lw, x: x0 };
  });
  const scale = Math.min(renderScale, 4096 / (boxW + pad * 2), 4096 / (boxH + pad * 2));
  return { glyphs, lines: outLines, boxW, boxH, size, lineH, font, pad, scale, truncated };
}

export class TextView implements LayerView {
  readonly scene = new THREE.Scene();
  readonly key: string;
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private tex: THREE.Texture | null = null;
  private layout: Layout | null = null;
  private layoutKey = '';
  private drawSig = '';
  private family = 'Geist';
  private fontReady: Promise<void> = Promise.resolve();
  private fontVersion = 0;
  private lastBounds: Bounds | null = null;

  constructor(layer: LayerOf<'text'>, private ctx: FrameContext) {
    this.key = textKey(layer);
    this.mat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: TEXT_FRAG, uniforms: { uTex: { value: null }, uOpacity: { value: 1 } } });
    this.mesh = new THREE.Mesh(ctx.gpu.geometry('quad', () => new THREE.PlaneGeometry(1, 1)), this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.loadFont(layer);
  }

  private loadFont(layer: LayerOf<'text'>) {
    const { fontFamily, fontAssetId } = layer.props;
    const done = (ok: boolean, fam: string) => {
      this.family = ok ? fam : 'Geist';
      this.fontVersion++;
      this.ctx.issue(layer.id, ok ? null : `Font “${fontFamily}” is unavailable — showing Geist instead`);
    };
    ensureFont('Geist');
    if (fontAssetId) {
      this.fontReady = this.ctx.assets.resolve(fontAssetId).then(async (a) => {
        if ('missing' in a) return done(false, '');
        done(await ensureFont(`asset-${fontAssetId}`, a.url), `asset-${fontAssetId}`);
      });
    } else if (isKnownFont(fontFamily)) {
      this.family = fontFamily;
      this.fontReady = ensureFont(fontFamily).then((ok) => done(ok, fontFamily));
    } else {
      done(false, '');
    }
  }

  camera(ctx: FrameContext) { return ctx.ortho; }

  sync(layer: LayerOf<'text'>, ctx: FrameContext) {
    const p = layer.props;
    applyBlend(this.mat, layer.blend);
    this.mat.uniforms.uOpacity.value = layer.opacity;
    const lk = [p.text, this.family, p.weight, p.size, p.tracking, p.lineHeight, p.maxWidth, p.maxChars, p.align, ctx.width, ctx.height, ctx.renderScale.toFixed(3), this.fontVersion].join('|');
    if (lk !== this.layoutKey) {
      this.layoutKey = lk;
      this.layout = layoutText(p, this.family, ctx.width, ctx.height, ctx.renderScale);
      const L = this.layout;
      const cw = Math.max(2, Math.ceil((L.boxW + L.pad * 2) * L.scale)), ch = Math.max(2, Math.ceil((L.boxH + L.pad * 2) * L.scale));
      if (!this.canvas || this.canvas.width !== cw || this.canvas.height !== ch) {
        this.canvas = makeCanvas(cw, ch);
        this.tex?.dispose();
        this.tex = new THREE.CanvasTexture(this.canvas as any);
        this.tex.colorSpace = THREE.NoColorSpace;
        this.tex.minFilter = THREE.LinearFilter;
        this.tex.generateMipmaps = false;
        this.mat.uniforms.uTex.value = this.tex;
      }
      this.drawSig = '';
      if (L.truncated) ctx.issue(layer.id, `Text exceeds ${p.maxChars} characters and was truncated`);
    }
    const L = this.layout!;
    const progress = this.progress(layer, ctx, L);
    const scrambleTick = p.animation.preset === 'scramble' && progress.some((v) => v > 0 && v < 1) ? Math.floor(ctx.t * 24) : 0;
    const sig = `${p.color}|${p.animation.preset}|${scrambleTick}|${progress.map((v) => v.toFixed(3)).join(',')}`;
    if (sig !== this.drawSig) {
      this.drawSig = sig;
      this.draw(layer, L, progress, ctx);
      this.tex!.needsUpdate = true;
    }
    const w = (L.boxW + L.pad * 2), h = (L.boxH + L.pad * 2);
    placeQuad(this.mesh, layer, ctx, w, h);
    this.lastBounds = { cx: layer.transform.x * ctx.width, cy: layer.transform.y * ctx.height, w: L.boxW * layer.transform.scale * layer.transform.scaleX, h: L.boxH * layer.transform.scale * layer.transform.scaleY, rotation: layer.transform.rotation };
  }

  /** Per-unit reveal progress (unit = glyph, word or line depending on the preset). */
  private progress(layer: LayerOf<'text'>, ctx: FrameContext, L: Layout): number[] {
    const a = layer.props.animation;
    const preset = ctx.motion === 'reduced' && a.preset !== 'none' ? 'fade' : a.preset;
    if (preset === 'none' || ctx.motion === 'static') return [1];
    const units = preset === 'fade' ? 1 : preset === 'word' ? Math.max(1, (L.glyphs.at(-1)?.word ?? 0) + 1) : preset === 'slide' || preset === 'mask' ? L.lines.length : L.glyphs.length;
    const spread = units > 1 ? a.duration * a.stagger : 0;
    const unitDur = Math.max(0.05, a.duration - spread);
    return Array.from({ length: units }, (_, i) => ease(a.easing, revealProgress(ctx, a.start + (units > 1 ? (i / (units - 1)) * spread : 0), unitDur, a.exit)));
  }

  private draw(layer: LayerOf<'text'>, L: Layout, prog: number[], ctx: FrameContext) {
    const c = this.canvas!.getContext('2d') as CanvasRenderingContext2D;
    const preset = ctx.motion === 'reduced' && layer.props.animation.preset !== 'none' ? 'fade' : ctx.motion === 'static' ? 'none' : layer.props.animation.preset;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas!.width, this.canvas!.height);
    c.setTransform(L.scale, 0, 0, L.scale, L.pad * L.scale, L.pad * L.scale);
    c.font = L.font;
    c.fillStyle = layer.props.color;
    c.textBaseline = 'alphabetic';
    const baseline = (li: number) => L.lines[li].y + (L.lineH + L.size * 0.68) / 2;
    const seed = ctx.doc.seed;
    L.glyphs.forEach((g, i) => {
      if (g.ch === ' ') return;
      const y = baseline(g.line);
      let e = 1, dx = 0, dy = 0, s = 1, ch = g.ch;
      switch (preset) {
        case 'fade': e = prog[0]; break;
        case 'stagger': e = prog[i]; dy = (1 - e) * L.size * 0.45; break;
        case 'word': e = prog[g.word]; dy = (1 - e) * L.size * 0.28; break;
        case 'slide': e = prog[g.line]; dx = -(1 - e) * L.size * 0.8; break;
        case 'scale': e = prog[i]; s = 0.35 + 0.65 * e; break;
        case 'mask': e = prog[g.line]; dy = (1 - e) * (L.lineH + L.size * 0.5); break;
        case 'scramble': {
          e = prog[i];
          if (e < 1) ch = SCRAMBLE[(Math.floor(ctx.t * 24) * 31 + i * 17 + seed) % SCRAMBLE.length];
          break;
        }
      }
      if (e <= 0.001 && preset !== 'mask') return;
      c.save();
      if (preset === 'mask') {
        c.beginPath();
        c.rect(-L.pad, L.lines[g.line].y - L.size * 0.25, L.boxW + L.pad * 2, L.lineH + L.size * 0.5);
        c.clip();
        c.globalAlpha = 1;
      } else c.globalAlpha = preset === 'scramble' ? (e < 1 ? 0.35 + 0.5 * e : 1) * Math.min(1, e * 4) : e;
      if (s !== 1) {
        c.translate(g.x + g.w / 2, y - L.size * 0.35);
        c.scale(s, s);
        c.translate(-(g.x + g.w / 2), -(y - L.size * 0.35));
      }
      c.fillText(ch, g.x + dx, y + dy);
      c.restore();
    });
  }

  bounds() { return this.lastBounds; }
  ready() { return this.fontReady; }
  dispose() { this.tex?.dispose(); this.mat.dispose(); }
}

export const textKey = (l: LayerOf<'text'>) => `text:${l.props.fontFamily}:${l.props.fontAssetId ?? ''}`;
