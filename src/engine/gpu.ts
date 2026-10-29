import * as THREE from 'three';
import type { AssetResolver, ResolvedAsset } from './assets';

export type ShaderIssue = { message: string; viewId: string | null };

/**
 * Owns one WebGL2 context. Several SceneRenderers may share a GPUContext (thumbnails, context
 * previews) so pages never create dozens of live contexts. Also owns texture/geometry caches.
 */
export class GPUContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  lost = false;
  /** Set by SceneRenderer before each layer draw so compile errors can be attributed. */
  currentView: string | null = null;
  shaderErrors = new Map<string, string>();
  private geometries = new Map<string, THREE.BufferGeometry>();
  private textures = new Map<string, { tex: THREE.Texture; refs: number; bytes: number }>();
  private textureLoads = new Map<string, Promise<THREE.Texture | null>>();
  private lostListeners = new Set<(lost: boolean) => void>();
  compileMs = 0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, opts: { alpha?: boolean; preserveDrawingBuffer?: boolean; antialias?: boolean } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas as any,
      antialias: opts.antialias ?? true,
      alpha: opts.alpha ?? true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
      powerPreference: 'high-performance',
    });
    // We pass sRGB values straight through: no implicit colour-space conversion anywhere.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.debug.checkShaderErrors = true;
    this.renderer.debug.onShaderError = (gl, _program, vs, fs) => {
      const log = (gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || 'Shader failed to compile').trim();
      this.shaderErrors.set(this.currentView ?? '?', log);
    };
    const el = canvas as any;
    if (el.addEventListener) {
      el.addEventListener('webglcontextlost', (e: Event) => { e.preventDefault(); this.lost = true; this.lostListeners.forEach((f) => f(true)); }, false);
      el.addEventListener('webglcontextrestored', () => {
        this.lost = false;
        this.geometries.forEach((g) => g.dispose());
        this.geometries.clear();
        this.textures.forEach((t) => t.tex.dispose());
        this.textures.clear();
        this.textureLoads.clear();
        this.lostListeners.forEach((f) => f(false));
      }, false);
    }
  }

  onContextChange(fn: (lost: boolean) => void) { this.lostListeners.add(fn); return () => { this.lostListeners.delete(fn); }; }

  /** Testing aid for the performance inspector: simulate a GPU reset. */
  simulateContextLoss() {
    const ext = this.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 1200);
    return true;
  }

  geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geometries.get(key);
    if (!g) this.geometries.set(key, (g = make()));
    return g;
  }

  /** Load a texture for an asset id; cached per resolved version and ref-counted. */
  async texture(assetId: string, resolver: AssetResolver): Promise<{ tex: THREE.Texture; key: string; asset: ResolvedAsset } | { missing: true; asset: ResolvedAsset }> {
    const asset = await resolver.resolve(assetId);
    if ('missing' in asset) return { missing: true, asset };
    const key = `${assetId}@${asset.version ?? asset.url}`;
    const hit = this.textures.get(key);
    if (hit) { hit.refs++; return { tex: hit.tex, key, asset }; }
    let p = this.textureLoads.get(key);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(asset.url);
          if (!res.ok) return null;
          // Premultiplied so filtering at transparent edges doesn't bleed black; the shader un-premultiplies.
          const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'premultiply' } as any);
          const tex = new THREE.Texture(bmp as any);
          tex.flipY = false;
          tex.colorSpace = THREE.NoColorSpace;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.generateMipmaps = true;
          tex.anisotropy = 4;
          tex.needsUpdate = true;
          this.textures.set(key, { tex, refs: 0, bytes: bmp.width * bmp.height * 4 * 1.33 });
          return tex;
        } catch {
          return null;
        }
      })();
      this.textureLoads.set(key, p);
    }
    const tex = await p;
    if (!tex) return { missing: true, asset };
    this.textures.get(key)!.refs++;
    return { tex, key, asset };
  }

  releaseTexture(key: string) {
    const t = this.textures.get(key);
    if (!t) return;
    if (--t.refs <= 0) { t.tex.dispose(); this.textures.delete(key); this.textureLoads.delete(key); }
  }

  textureBytes() {
    let n = 0;
    this.textures.forEach((t) => (n += t.bytes));
    return n;
  }

  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.textures.forEach((t) => t.tex.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
