import type { ExposedParam, SceneDocument } from './scene/schema';
import { validateParamValue, type ParamValues } from './params';
import { analyzeCompatibility, EXPORT_FORMATS, type ExportFormatId } from './compat';
import { CHANNEL_FORMATS, type ChannelFormat } from './formats';
import { hexToHsv } from './util/color';

/**
 * Local, deterministic assistant. It never executes generated code and every suggested value is
 * validated against the template's parameter rules (locks, options, ranges) before it is offered.
 * The provider interface allows an LLM to be added later behind the same validation.
 */
export type AssistantTemplate = { id: string; name: string; description: string; category: string; interaction: string; channels: string[]; colors: string[]; tags?: string[] };
export type Suggestion = { key: string; label: string; value: unknown; reason: string };
export type AssistantAnswer = { intent: 'search' | 'tune' | 'channel' | 'export' | 'help'; text: string; templates?: { id: string; score: number; why: string }[]; suggestions?: Suggestion[]; notes?: string[] };

const SYN: Record<string, string[]> = {
  calm: ['aurora', 'soft', 'slow', 'gentle', 'gradient', 'serene', 'luminous'],
  energetic: ['kinetic', 'bold', 'particles', 'fast', 'launch', 'typography'],
  tech: ['mesh', 'particles', 'liquid', 'product', '3d', 'signal'],
  friendly: ['organic', 'blobs', 'warm', 'soft'],
  bold: ['kinetic', 'typography', 'move'],
  product: ['mesh', 'spotlight', 'launch', 'liquid'],
  event: ['kinetic', 'launch', 'typography'],
  interactive: ['pointer', 'particles'],
  text: ['typography', 'kinetic'],
  '3d': ['mesh', 'liquid', 'sphere'],
};
const WORDS = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const HUES: Record<string, number> = { red: 0, orange: 25, warm: 20, yellow: 55, green: 120, teal: 175, cyan: 185, blue: 220, cool: 210, purple: 275, violet: 270, pink: 320, magenta: 310 };

function hueDistance(a: number, b: number) { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }

export function searchTemplates(query: string, templates: AssistantTemplate[]) {
  const q = WORDS(query);
  const expanded = new Set(q.flatMap((w) => [w, ...(SYN[w] ?? [])]));
  const channel = CHANNEL_FORMATS.find((f) => q.some((w) => f.name.toLowerCase().includes(w) && w.length > 3));
  const hueWord = q.find((w) => w in HUES);
  return templates.map((t) => {
    const hay = WORDS([t.name, t.description, t.category, t.interaction, ...(t.tags ?? [])].join(' '));
    let score = 0;
    const why: string[] = [];
    for (const w of expanded) if (hay.some((h) => h.startsWith(w))) { score += q.includes(w) ? 3 : 1; why.push(w); }
    if (channel && (!t.channels.length || t.channels.includes(channel.id))) { score += 1; why.push(channel.name); }
    if (hueWord && t.colors.length) {
      const best = Math.min(...t.colors.map((c) => { const [h, s] = hexToHsv(c); return s < 0.2 ? 180 : hueDistance(h, HUES[hueWord]); }));
      if (best < 40) { score += 2; why.push(`${hueWord} tones`); }
    }
    return { id: t.id, score, why: [...new Set(why)].slice(0, 4).join(', ') };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}

function numericNudge(p: ExposedParam, current: number, dir: 1 | -1, amount = 0.25): number {
  const min = p.min ?? 0, max = p.max ?? Math.max(1, current * 2);
  let v = current + dir * (max - min) * amount;
  if (p.step) v = Math.round(v / p.step) * p.step;
  return Math.min(max, Math.max(min, +v.toFixed(4)));
}

export function suggestParameters(query: string, scene: SceneDocument, values: ParamValues, brandColors: Record<string, string> = {}): Suggestion[] {
  const q = query.toLowerCase();
  const out: Suggestion[] = [];
  const editable = scene.exposed.filter((p) => !p.locked);
  const val = (p: ExposedParam) => (p.key in values ? values[p.key] : p.default);
  const calmer = /\b(calm|calmer|slower|subtle|gentle|less|quieter|softer)\b/.test(q);
  const livelier = /\b(more|energetic|faster|bolder|intense|livelier|punchier|dynamic)\b/.test(q) && !calmer;
  for (const p of editable) {
    if ((p.type === 'number' || p.type === 'scale') && /intens|speed|liquid|pull|density|grain/.test(p.key + p.label.toLowerCase())) {
      if (calmer || livelier) {
        const next = numericNudge(p, Number(val(p)), calmer ? -1 : 1);
        if (next !== val(p)) out.push({ key: p.key, label: p.label, value: next, reason: calmer ? 'Lower values read calmer and reduce visual load.' : 'Higher values add energy within the brand-approved range.' });
      }
    }
  }
  const hueWord = Object.keys(HUES).find((w) => q.includes(w));
  if (hueWord) {
    for (const p of editable) {
      if (!p.options?.length || !['gradientPreset', 'color'].includes(p.type)) continue;
      const scored = p.options.map((o) => {
        const colors: string[] = p.type === 'color' ? [o.value as string] : (o.value as any[]).map((s) => s.color);
        const sat = colors.map((c) => hexToHsv(c)).filter(([, s, v]) => s > 0.25 && v > 0.2);
        const d = sat.length ? Math.min(...sat.map(([h]) => hueDistance(h, HUES[hueWord]))) : 999;
        return { o, d };
      }).sort((a, b) => a.d - b.d);
      if (scored[0] && scored[0].d < 45) out.push({ key: p.key, label: p.label, value: scored[0].o.value, reason: `"${scored[0].o.label}" is the closest approved option to ${hueWord}.` });
    }
  }
  if (/\bbrand\b/.test(q)) {
    for (const p of editable.filter((x) => x.type === 'color' && x.tokenBinding && brandColors[x.tokenBinding!])) {
      out.push({ key: p.key, label: p.label, value: brandColors[p.tokenBinding!], reason: `Bound to brand token ${p.tokenBinding}.` });
    }
  }
  // Only offer suggestions that pass the template's own validation (options, ranges, locks).
  return out.filter((s) => validateParamValue(scene.exposed.find((p) => p.key === s.key)!, s.value).ok);
}

export function channelAdvice(scene: SceneDocument, values: ParamValues, format: ChannelFormat): string[] {
  const notes: string[] = [];
  const aspect = format.width / format.height;
  for (const p of scene.exposed.filter((x) => x.type === 'text')) {
    const text = String(values[p.key] ?? p.default ?? '');
    const longest = Math.max(...text.split('\n').map((l) => l.length));
    if (aspect < 0.7 && longest > 14) notes.push(`${p.label}: lines over ~14 characters wrap in tall formats like ${format.name}. Consider a line break.`);
    if (format.height < 500 && text.includes('\n')) notes.push(`${p.label}: ${format.name} is only ${format.height}px tall; a single line reads better.`);
  }
  if (format.safe.top > 0.1 || format.safe.bottom > 0.1) notes.push(`${format.name} reserves ${Math.round(format.safe.top * 100)}% at the top and ${Math.round(format.safe.bottom * 100)}% at the bottom for platform UI; text is kept inside automatically.`);
  if (scene.interactions.length) notes.push('Pointer interactions are not available on this channel unless it is an interactive embed.');
  if (!notes.length) notes.push(`${format.name} works well with this template as-is.`);
  return notes;
}

export function explainExport(scene: SceneDocument, format: ExportFormatId): string[] {
  const meta = EXPORT_FORMATS.find((f) => f.id === format)!;
  const r = analyzeCompatibility(scene, format);
  const lines = [`${meta.label}: ${meta.implemented ? 'available' : 'not available yet'} — ${meta.note}.`];
  for (const i of r.items.filter((x) => x.level !== 'ok')) lines.push(`${i.feature}: ${i.message}`);
  if (r.flashing.length) lines.push(...r.flashing);
  return lines;
}

export function answer(query: string, ctx: { templates: AssistantTemplate[]; scene?: SceneDocument; values?: ParamValues; brandColors?: Record<string, string>; format?: string }): AssistantAnswer {
  const q = query.toLowerCase();
  const fmtWord = EXPORT_FORMATS.find((f) => q.includes(f.id.replace('-', ' ')) || q.includes(f.id) || q.includes(f.label.toLowerCase().split(' ')[0]));
  if (ctx.scene && (/\b(export|lottie|gif|svg|webm|gltf|compatib)/.test(q)) && fmtWord) {
    return { intent: 'export', text: `Here is how this motion translates to ${fmtWord.label}.`, notes: explainExport(ctx.scene, fmtWord.id) };
  }
  const channel = CHANNEL_FORMATS.find((f) => q.includes(f.name.toLowerCase()) || q.includes(f.id.replace('-', ' ')) || (q.includes('story') && f.id === 'instagram-story') || (q.includes('banner') && f.id === 'website-banner'));
  if (ctx.scene && channel && /\b(adapt|for|fit|work|look|channel|post|use)\b/.test(q)) {
    return { intent: 'channel', text: `Adapting for ${channel.name} (${channel.width}×${channel.height}).`, notes: channelAdvice(ctx.scene, ctx.values ?? {}, channel) };
  }
  if (ctx.scene) {
    const s = suggestParameters(query, ctx.scene, ctx.values ?? {}, ctx.brandColors);
    if (s.length) return { intent: 'tune', text: `${s.length} brand-safe change${s.length > 1 ? 's' : ''} you can apply:`, suggestions: s };
  }
  const results = searchTemplates(query, ctx.templates);
  if (results.length) return { intent: 'search', text: `Found ${results.length} approved template${results.length > 1 ? 's' : ''} matching “${query}”.`, templates: results.slice(0, 6) };
  return { intent: 'help', text: 'Try: “calm template for a story”, “make it warmer”, “more energetic”, “adapt for website banner”, or “can I export this as Lottie?”.' };
}
