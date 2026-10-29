import type { Stroke } from '../../shared/scene/schema';

/**
 * Paints freehand strokes with Canvas 2D. Shared by the drawing layer (into its texture) and the
 * editor's live overlay (while you draw), so a stroke looks the same during and after drawing.
 *
 * Pen: width follows pressure and tapers at both ends, drawn segment by segment through the
 * midpoints so it stays smooth. Pencil: thin and grainy (two light, slightly offset passes).
 * Brush: calligraphic, thick or thin with the direction of travel, tapering at both ends.
 * Marker: one even, round line. Highlighter: a wide, translucent line laid down once (overlaps
 * within a stroke don't darken). `reveal` (0–1) draws the strokes in order up to that share of
 * their total length, which is how a drawing "draws itself on".
 */
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type PaintOptions = { scale: number; reveal?: number; thickness?: number; offsetX?: number; offsetY?: number };

export function strokeLength(s: Pick<Stroke, 'points'>) {
  let len = 0;
  for (let i = 3; i < s.points.length; i += 3) len += Math.hypot(s.points[i] - s.points[i - 3], s.points[i + 1] - s.points[i - 2]);
  return len;
}

/** Width at a point for the pen, from pressure (mouse and touch report 0.5 or nothing: treat as medium). */
const penWidth = (size: number, pressure: number) => size * (0.28 + 0.95 * (pressure > 0 ? pressure : 0.5));

/** The points of a stroke cut off after `budget` pixels of its length (interpolating the last one). */
function clip(points: number[], budget: number): number[] {
  if (budget <= 0) return points.slice(0, 3);
  const out = points.slice(0, 3);
  let left = budget;
  for (let i = 3; i < points.length; i += 3) {
    const seg = Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2]);
    if (seg >= left) {
      const k = seg === 0 ? 1 : left / seg;
      out.push(points[i - 3] + (points[i] - points[i - 3]) * k, points[i - 2] + (points[i + 1] - points[i - 2]) * k, points[i - 1] + (points[i + 2] - points[i - 1]) * k);
      return out;
    }
    out.push(points[i], points[i + 1], points[i + 2]);
    left -= seg;
  }
  return out;
}

export function paintStrokes(ctx: Ctx, strokes: Stroke[], o: PaintOptions) {
  const reveal = o.reveal ?? 1, thick = o.thickness ?? 1, ox = o.offsetX ?? 0, oy = o.offsetY ?? 0, k = o.scale;
  let budget = reveal >= 1 ? Infinity : reveal * strokes.reduce((a, s) => a + strokeLength(s), 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (budget <= 0) break;
    const len = strokeLength(s);
    const pts = budget >= len ? s.points : clip(s.points, budget);
    budget -= len;
    paintOne(ctx, s, pts, k, thick, ox, oy);
  }
  ctx.globalAlpha = 1;
}

function paintOne(ctx: Ctx, s: Stroke, p: number[], k: number, thick: number, ox: number, oy: number) {
  const X = (i: number) => (p[i] + ox) * k, Y = (i: number) => (p[i + 1] + oy) * k;
  const n = p.length / 3;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  if (s.brush === 'highlighter') ctx.globalAlpha = 0.38; else ctx.globalAlpha = 1;
  const base = s.size * thick * (s.brush === 'highlighter' ? 2.4 : 1) * k;
  if (n === 1) { // a dot
    const r = (s.brush === 'pen' ? penWidth(s.size * thick, p[2]) : s.size * thick) * k / 2;
    ctx.beginPath(); ctx.arc(X(0), Y(0), Math.max(0.5, r), 0, Math.PI * 2); ctx.fill();
    return;
  }
  if (s.brush === 'marker' || s.brush === 'highlighter') {
    // One continuous path through the midpoints, so it's smooth and laid down only once.
    ctx.lineWidth = Math.max(0.5, base);
    ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    for (let i = 1; i < n - 1; i++) { const mx = (X(i * 3) + X((i + 1) * 3)) / 2, my = (Y(i * 3) + Y((i + 1) * 3)) / 2; ctx.quadraticCurveTo(X(i * 3), Y(i * 3), mx, my); }
    ctx.lineTo(X((n - 1) * 3), Y((n - 1) * 3));
    ctx.stroke();
    return;
  }
  // Pen, pencil, brush: short curved segments between midpoints, each with its own width.
  const taper = (i: number) => 0.35 + 0.65 * Math.min(1, i / 5, (n - 1 - i) / 5);
  const widthAt = (i: number) => {
    const pr = p[i * 3 + 2];
    if (s.brush === 'pencil') return s.size * thick * 0.5 * (0.6 + 0.6 * (pr > 0 ? pr : 0.5));
    if (s.brush === 'brush') {
      const j = Math.min(n - 1, i + 1), a = Math.atan2(p[j * 3 + 1] - p[i * 3 + 1], p[j * 3] - p[i * 3]);
      return s.size * thick * (0.22 + 0.95 * Math.abs(Math.sin(a - Math.PI / 4))) * taper(i);
    }
    return penWidth(s.size * thick, pr) * taper(i);
  };
  const passes = s.brush === 'pencil' ? [[-0.5, 0.3, 0.55], [0.45, -0.35, 0.55]] : [[0, 0, 1]];
  for (const [jx, jy, alpha] of passes) {
    ctx.globalAlpha = alpha;
    let px = X(0) + jx, py = Y(0) + jy;
    for (let i = 1; i < n; i++) {
      const last = i === n - 1;
      const ex = (last ? X(i * 3) : (X(i * 3) + X((i + 1) * 3)) / 2) + jx, ey = (last ? Y(i * 3) : (Y(i * 3) + Y((i + 1) * 3)) / 2) + jy;
      ctx.lineWidth = Math.max(0.5, widthAt(i) * k);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(X(i * 3) + jx, Y(i * 3) + jy, ex, ey); ctx.stroke();
      px = ex; py = ey;
    }
  }
  ctx.globalAlpha = 1;
}

/** The box that holds every stroke, including their width. */
export function strokesBounds(strokes: Stroke[], thickness = 1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const pad = (s.size * thickness * (s.brush === 'highlighter' ? 2.4 : 1.25)) / 2 + 2;
    for (let i = 0; i < s.points.length; i += 3) {
      x0 = Math.min(x0, s.points[i] - pad); y0 = Math.min(y0, s.points[i + 1] - pad);
      x1 = Math.max(x1, s.points[i] + pad); y1 = Math.max(y1, s.points[i + 1] + pad);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
