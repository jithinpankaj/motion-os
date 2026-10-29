import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useReducedMotion } from '../lib/prefs';

/**
 * A soft-bodied pill button in the studio's materials: satin graphite in light mode, satin silver in dark.
 * The outline is a ring of points on springs: it swells toward the pointer, dents where you press
 * and wobbles back when you let go (each point is a damped spring coupled to its neighbours, so the
 * surface moves as one). An SVG lighting filter turns the outline into a soft dome lit from where
 * the pointer is, and an iridescent rim wakes up while you're near it, the same accent as Ask
 * Claude. The simulation sleeps when the button is at rest. Reduced motion: same object, still.
 */
const N = 56, PAD = 28, SIGMA = 46;

/**
 * A tile of fine, soft grain, drawn once and shared by every plush button: every pixel is a grey
 * close to the middle, so blended over the gradient it reads as texture rather than speckles.
 */
let grainTile: string | null = null;
function grain() {
  if (grainTile || typeof document === 'undefined') return grainTile;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 110; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return (grainTile = c.toDataURL('image/png'));
}

export function PlushButton({ label, icon, onClick, width = 196, height = 62 }: { label: ReactNode; icon?: ReactNode; onClick: () => void; width?: number; height?: number }) {
  const id = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  const path = useRef<SVGPathElement>(null), shadow = useRef<SVGPathElement>(null), clip = useRef<SVGPathElement>(null);
  const lights = useRef<SVGFEPointLightElement[]>([]);
  const rim = useRef<SVGPathElement>(null), rimGrad = useRef<SVGLinearGradientElement>(null);
  const wake = useRef<() => void>(() => {});
  const content = useRef<HTMLSpanElement>(null);
  const state = useRef({ px: 0, py: 0, hover: false, down: false, d: new Float64Array(N), v: new Float64Array(N), sx: 1, sy: 1, vsx: 0, vsy: 0, lx: 0, ly: 0, glow: 0 });
  const W = width + PAD * 2, H = height + PAD * 2, cx = W / 2, cy = H / 2;

  // The resting outline: a fully rounded pill, sampled evenly along its perimeter.
  const base = useRef<{ x: number; y: number; nx: number; ny: number }[]>([]);
  if (!base.current.length) {
    const rad = height / 2, flat = width - height, per = 2 * flat + 2 * Math.PI * rad;
    const pts = Array.from({ length: N }, (_, i) => {
      let u = (i / N) * per;
      if (u < flat) return { x: cx - flat / 2 + u, y: cy - rad };
      u -= flat;
      if (u < Math.PI * rad) { const a = -Math.PI / 2 + u / rad; return { x: cx + flat / 2 + Math.cos(a) * rad, y: cy + Math.sin(a) * rad }; }
      u -= Math.PI * rad;
      if (u < flat) return { x: cx + flat / 2 - u, y: cy + rad };
      u -= flat;
      const a = Math.PI / 2 + u / rad; return { x: cx - flat / 2 + Math.cos(a) * rad, y: cy + Math.sin(a) * rad };
    });
    base.current = pts.map((p, i) => {
      const p0 = pts[(i - 1 + N) % N], p1 = pts[(i + 1) % N];
      const tx = p1.x - p0.x, ty = p1.y - p0.y, l = Math.hypot(tx, ty) || 1;
      return { ...p, nx: ty / l, ny: -tx / l };
    });
  }

  useEffect(() => {
    const s = state.current;
    s.lx = cx - width * 0.28; s.ly = cy - height * 0.9;
    let raf = 0, last = performance.now(), t = 0;
    const draw = () => {
      const pts = base.current.map((p, i) => {
        const dx = (p.x - cx) * s.sx + cx + p.nx * s.d[i], dy = (p.y - cy) * s.sy + cy + p.ny * s.d[i];
        return [dx, dy] as const;
      });
      // Closed Catmull-Rom spline through the points, as cubic Béziers.
      let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
      for (let i = 0; i < N; i++) {
        const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N];
        d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
      }
      path.current?.setAttribute('d', d + 'Z');
      shadow.current?.setAttribute('d', d + 'Z');
      rim.current?.setAttribute('d', d + 'Z');
      clip.current?.setAttribute('d', d + 'Z');
      if (rim.current) rim.current.style.opacity = String(Math.max(0, Math.min(1, s.glow)));
      rimGrad.current?.setAttribute('gradientTransform', `rotate(${(t * 40) % 360} 0.5 0.5)`);
      for (const l of lights.current) { l?.setAttribute('x', s.lx.toFixed(1)); l?.setAttribute('y', s.ly.toFixed(1)); }
      if (content.current) {
        const ox = s.hover ? (s.px - cx) * 0.035 : 0, oy = s.hover ? (s.py - cy) * 0.05 : 0;
        content.current.style.transform = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px) scale(${s.sx.toFixed(4)}, ${s.sy.toFixed(4)})`;
      }
    };
    if (reduced) { draw(); return; }
    let running = false;
    const step = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000); last = now; t += dt;
      const k = 210, c = 13, couple = 60;
      for (let i = 0; i < N; i++) {
        const p = base.current[i];
        const w = s.hover ? Math.exp(-((p.x - s.px) ** 2 + (p.y - s.py) ** 2) / (2 * SIGMA * SIGMA)) : 0;
        // Swell toward the pointer; press dents it.
        const target = (s.down ? -3.5 : 3) * w;
        const nb = s.d[(i - 1 + N) % N] + s.d[(i + 1) % N] - 2 * s.d[i];
        s.v[i] += (k * (target - s.d[i]) - c * s.v[i] + couple * nb) * dt;
      }
      for (let i = 0; i < N; i++) s.d[i] += s.v[i] * dt;
      // Whole-body squash on press, with a wobbly rebound on release.
      const tsx = s.down ? 1.025 : 1, tsy = s.down ? 0.95 : 1;
      s.vsx += (260 * (tsx - s.sx) - 11 * s.vsx) * dt; s.sx += s.vsx * dt;
      s.vsy += (260 * (tsy - s.sy) - 11 * s.vsy) * dt; s.sy += s.vsy * dt;
      // The light drifts toward the pointer (above and slightly in front of it).
      const lxT = s.hover ? s.px - 10 : cx - width * 0.28, lyT = s.hover ? s.py - height * 0.7 : cy - height * 0.9;
      s.lx += (lxT - s.lx) * Math.min(1, dt * 7); s.ly += (lyT - s.ly) * Math.min(1, dt * 7);
      s.glow += ((s.hover ? 1 : 0) - s.glow) * Math.min(1, dt * 6);
      draw();
      // Sleep once everything has settled and nobody is touching it.
      let energy = Math.abs(s.sx - 1) + Math.abs(s.sy - 1) + Math.abs(s.vsx) + Math.abs(s.vsy) + s.glow;
      for (let i = 0; i < N; i++) energy += Math.abs(s.d[i]) + Math.abs(s.v[i]) * 0.1;
      if (!s.hover && !s.down && energy < 0.02) { running = false; return; }
      raf = requestAnimationFrame(step);
    };
    wake.current = () => { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(step); } };
    draw();
    return () => { cancelAnimationFrame(raf); running = false; };
  }, [reduced, cx, cy, width, height]);

  const at = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    state.current.px = e.clientX - r.left + PAD; state.current.py = e.clientY - r.top + PAD;
    wake.current();
  };
  const light = (i: number) => (el: SVGFEPointLightElement | null) => { if (el) lights.current[i] = el; };

  return (
    <button type="button" className="plush" style={{ width, height }} onClick={onClick}
      onPointerEnter={(e) => { at(e); state.current.hover = true; }} onPointerMove={at}
      onPointerLeave={() => { state.current.hover = false; state.current.down = false; wake.current(); }}
      onPointerDown={(e) => { at(e); state.current.down = true; }} onPointerUp={() => { state.current.down = false; wake.current(); }}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { state.current.down = true; state.current.px = W / 2; state.current.py = H / 2; state.current.hover = true; wake.current(); } }}
      onKeyUp={() => { state.current.down = false; state.current.hover = false; wake.current(); }}
      onFocus={() => wake.current()} onBlur={() => wake.current()}>
      <svg className="plush-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden style={{ left: -PAD, top: -PAD }}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0.2" y1="0" x2="0.45" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--plush-hi)' }} />
            <stop offset="0.55" style={{ stopColor: 'var(--plush-mid)' }} />
            <stop offset="1" style={{ stopColor: 'var(--plush-lo)' }} />
          </linearGradient>
          <linearGradient ref={rimGrad} id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d9be86" /><stop offset="0.3" stopColor="#4a8f86" /><stop offset="0.55" stopColor="#1f4e86" /><stop offset="0.8" stopColor="#a87a32" /><stop offset="1" stopColor="#d9be86" />
          </linearGradient>
          <filter id={`${id}-satin`} x="-15%" y="-35%" width="130%" height="170%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="dome" />
            <feDiffuseLighting in="dome" surfaceScale="2.6" diffuseConstant="1" style={{ lightingColor: '#ffffff' }} result="diffuse">
              <fePointLight ref={light(0)} x="0" y="0" z="120" />
            </feDiffuseLighting>
            <feGaussianBlur in="diffuse" stdDeviation="2" result="diffuse" />
            <feComposite in="SourceGraphic" in2="diffuse" operator="arithmetic" k1="0.42" k2="0.66" result="shaded" />
            <feSpecularLighting in="dome" surfaceScale="2.6" specularConstant="0.34" specularExponent="28" style={{ lightingColor: 'var(--plush-sheen)' }} result="spec">
              <fePointLight ref={light(1)} x="0" y="0" z="120" />
            </feSpecularLighting>
            <feGaussianBlur in="spec" stdDeviation="2" result="spec" />
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
            <feComposite in="shaded" in2="specIn" operator="arithmetic" k2="1" k3="1" />
          </filter>
          <filter id={`${id}-shadow`} x="-30%" y="-60%" width="160%" height="220%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>
        <path ref={shadow} className="plush-shadow" transform="translate(0 11)" filter={`url(#${id}-shadow)`} />
        <path ref={path} fill={`url(#${id}-fill)`} filter={`url(#${id}-satin)`} />
        <path ref={rim} fill="none" stroke={`url(#${id}-rim)`} strokeWidth="1.6" style={{ opacity: 0 }} />
      </svg>
      {/* Grain lives in its own layer, so its flicker never re-runs the satin lighting underneath. */}
      <svg className="plush-svg plush-grain-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden style={{ left: -PAD, top: -PAD }}>
        <defs>
          <clipPath id={`${id}-clip`}><path ref={clip} /></clipPath>
          <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.35" /><stop offset="0.6" stopColor="#fff" stopOpacity="0.7" /><stop offset="1" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
          {/* The colour glow: the studio's metallic palette, rising softly from the bottom edge. */}
          <linearGradient id={`${id}-glow`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#1f4e86" /><stop offset="0.5" stopColor="#4a8f86" /><stop offset="1" stopColor="#d9be86" />
          </linearGradient>
          <linearGradient id={`${id}-glow-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
          <mask id={`${id}-glow-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}><rect x={0} y={PAD} width={W} height={height} fill={`url(#${id}-glow-fade)`} /></mask>
          <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}><rect x={0} y={PAD} width={W} height={height} fill={`url(#${id}-fade)`} /></mask>
          <pattern id={`${id}-grain`} patternUnits="userSpaceOnUse" width="64" height="64"><image href={grain() ?? ''} width="64" height="64" /></pattern>
        </defs>
        <g clipPath={`url(#${id}-clip)`} mask={`url(#${id}-glow-mask)`} className="plush-glow"><rect x={0} y={PAD} width={W} height={height} fill={`url(#${id}-glow)`} /></g>
        {/* Fine grain over the whole body, a little stronger toward the bottom, drifting slowly. It follows the soft body's outline. */}
        <g clipPath={`url(#${id}-clip)`} mask={`url(#${id}-mask)`} className="plush-grain"><rect className="plush-grain-r" x={-48} y={-48} width={W + 96} height={H + 96} fill={`url(#${id}-grain)`} /></g>
      </svg>
      <span ref={content} className="plush-content">{icon}<span>{label}</span></span>
    </button>
  );
}
