import { create } from 'zustand';
import type { BuiltinSound } from '../../shared/scene/schema';
import type { AssetResolver } from '../engine/assets';

/**
 * Sound for interactive motion. Built-in sounds are synthesised with Web Audio (nothing to download,
 * no licences); uploaded sounds are fetched once and cached. Browsers only allow audio after the
 * person has interacted with the page, so a sound fired before that is skipped rather than queued.
 */

export const SOUND_LABELS: Record<BuiltinSound, string> = {
  click: 'Click', tap: 'Soft tap', pop: 'Pop', blip: 'Blip', bubble: 'Bubble', boing: 'Boing', squish: 'Squish',
  whoosh: 'Whoosh', sparkle: 'Sparkle', chime: 'Chime', success: 'Success', bonk: 'Bonk', tick: 'Tick', spin: 'Reel spin',
};

export const useSound = create<{ muted: boolean; toggle: () => void }>((set, get) => ({
  muted: (() => { try { return localStorage.getItem('mos.muted') === '1'; } catch { return false; } })(),
  toggle: () => { const muted = !get().muted; try { localStorage.setItem('mos.muted', muted ? '1' : '0'); } catch {} set({ muted }); },
}));

let ctx: AudioContext | null = null;
const audio = () => {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
};

/** A short envelope-shaped oscillator: pitch glides from f0 to f1 over `dur` seconds. */
function tone(a: AudioContext, out: AudioNode, o: { type?: OscillatorType; f0: number; f1?: number; at?: number; dur: number; gain?: number; attack?: number }) {
  const t = a.currentTime + (o.at ?? 0);
  const osc = a.createOscillator(), g = a.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.5, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

/** Filtered noise burst (whooshes, clicks, squishes). */
function noise(a: AudioContext, out: AudioNode, o: { at?: number; dur: number; from: number; to: number; gain?: number; q?: number; type?: BiquadFilterType }) {
  const t = a.currentTime + (o.at ?? 0);
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * o.dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf;
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? 1.2;
  f.frequency.setValueAtTime(o.from, t);
  f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.5, t + o.dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

const SYNTH: Record<BuiltinSound, (a: AudioContext, out: AudioNode) => void> = {
  click: (a, o) => { noise(a, o, { dur: 0.03, from: 4000, to: 2500, gain: 0.6, q: 2 }); tone(a, o, { f0: 1800, f1: 1200, dur: 0.03, gain: 0.25 }); },
  tap: (a, o) => tone(a, o, { f0: 220, f1: 120, dur: 0.09, gain: 0.6 }),
  pop: (a, o) => tone(a, o, { f0: 900, f1: 260, dur: 0.09, gain: 0.55 }),
  blip: (a, o) => tone(a, o, { type: 'square', f0: 660, dur: 0.06, gain: 0.12 }),
  bubble: (a, o) => tone(a, o, { f0: 280, f1: 900, dur: 0.12, gain: 0.45 }),
  boing: (a, o) => {
    const t = a.currentTime, osc = a.createOscillator(), lfo = a.createOscillator(), depth = a.createGain(), g = a.createGain();
    osc.frequency.setValueAtTime(180, t); osc.frequency.exponentialRampToValueAtTime(360, t + 0.35);
    lfo.frequency.value = 18; depth.gain.setValueAtTime(60, t); depth.gain.exponentialRampToValueAtTime(1, t + 0.45);
    lfo.connect(depth).connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(g).connect(o); osc.start(t); lfo.start(t); osc.stop(t + 0.52); lfo.stop(t + 0.52);
  },
  squish: (a, o) => { noise(a, o, { dur: 0.16, from: 1400, to: 300, gain: 0.5, type: 'lowpass', q: 6 }); tone(a, o, { f0: 160, f1: 90, dur: 0.14, gain: 0.3 }); },
  whoosh: (a, o) => noise(a, o, { dur: 0.35, from: 300, to: 3200, gain: 0.35, q: 0.8 }),
  sparkle: (a, o) => [1568, 2093, 2637, 3136].forEach((f, i) => tone(a, o, { f0: f, at: i * 0.045, dur: 0.18, gain: 0.16, type: 'triangle' })),
  chime: (a, o) => { tone(a, o, { f0: 880, dur: 1.1, gain: 0.3, attack: 0.004 }); tone(a, o, { f0: 1320, dur: 0.8, gain: 0.15, attack: 0.004 }); tone(a, o, { f0: 2640, dur: 0.4, gain: 0.06 }); },
  success: (a, o) => [523, 659, 784, 1047].forEach((f, i) => tone(a, o, { f0: f, at: i * 0.08, dur: i === 3 ? 0.45 : 0.16, gain: 0.25, type: 'triangle' })),
  bonk: (a, o) => tone(a, o, { type: 'square', f0: 180, f1: 90, dur: 0.18, gain: 0.15 }),
  tick: (a, o) => noise(a, o, { dur: 0.015, from: 6000, to: 5000, gain: 0.5, q: 4, type: 'highpass' }),
  spin: (a, o) => { for (let i = 0; i < 10; i++) noise(a, o, { at: i * 0.055, dur: 0.02, from: 5000, to: 4000, gain: 0.35, q: 4, type: 'highpass' }); },
};

const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** Play a built-in sound or an uploaded one. Respects the mute switch. */
export async function playSound(src: { builtin?: BuiltinSound | null; assetId?: string | null; volume?: number }, assets?: AssetResolver, opts: { force?: boolean } = {}) {
  if (useSound.getState().muted && !opts.force) return;
  // Before the person has clicked or typed anywhere, browsers keep audio locked: skip, don't queue.
  const activated = (navigator as any).userActivation?.hasBeenActive ?? true;
  if (!activated && !opts.force) return;
  const a = audio();
  if (!a) return;
  const out = a.createGain();
  out.gain.value = Math.max(0, Math.min(1, src.volume ?? 0.8));
  out.connect(a.destination);
  if (src.builtin) { SYNTH[src.builtin]?.(a, out); return; }
  if (!src.assetId || !assets) return;
  let p = buffers.get(src.assetId);
  if (!p) {
    p = assets.resolve(src.assetId).then(async (r) => {
      if ('missing' in r) return null;
      const res = await fetch(r.url, { credentials: 'same-origin' });
      return a.decodeAudioData(await res.arrayBuffer());
    }).catch(() => null);
    buffers.set(src.assetId, p);
  }
  const buf = await p;
  if (!buf) return;
  const node = a.createBufferSource();
  node.buffer = buf;
  node.connect(out);
  node.start();
}
