/// <reference lib="webworker" />
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { SceneDocument } from '../../../shared/scene/schema';
import { GPUContext } from '../gpu';
import { SceneRenderer } from '../renderer';
import { mapResolver, type ResolvedAsset } from '../assets';

export type WorkerRun = { type: 'run'; jobId: string; format: 'png' | 'webp' | 'mp4'; scene: SceneDocument; settings: any; assets: Record<string, ResolvedAsset> };
export type WorkerOut =
  | { type: 'progress'; jobId: string; progress: number; frame?: number; total?: number }
  | { type: 'done'; jobId: string; blob: Blob; mime: string; warnings: string[] }
  | { type: 'error'; jobId: string; message: string; code?: string }
  | { type: 'cancelled'; jobId: string };

const cancelled = new Set<string>();
const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'cancel') cancelled.add(m.jobId);
  if (m.type === 'run') run(m as WorkerRun);
};

const BPP = { draft: 0.05, standard: 0.09, high: 0.14, max: 0.24 } as const;

async function run(job: WorkerRun) {
  const { jobId, settings } = job;
  let gpu: GPUContext | null = null;
  let renderer: SceneRenderer | null = null;
  try {
    if (typeof OffscreenCanvas === 'undefined') throw Object.assign(new Error('This browser cannot render exports in the background (OffscreenCanvas unavailable).'), { code: 'unsupported' });
    const W = settings.width, H = settings.height;
    const canvas = new OffscreenCanvas(W, H);
    gpu = new GPUContext(canvas, { alpha: true, preserveDrawingBuffer: true, antialias: true });
    gpu.renderer.setSize(W, H, false);
    renderer = new SceneRenderer(gpu, mapResolver(job.assets), { interactive: false });
    const scene: SceneDocument = { ...job.scene, canvas: { ...job.scene.canvas, width: W, height: H } };
    renderer.setScene(scene);
    const vp = { x: 0, y: 0, w: W, h: H };

    if (job.format === 'png' || job.format === 'webp') {
      await renderer.ready(settings.time);
      renderer.render(settings.time, vp, { transparent: settings.background === 'transparent' });
      const blob = await canvas.convertToBlob({ type: `image/${job.format}`, quality: job.format === 'webp' ? settings.quality : undefined });
      post({ type: 'done', jobId, blob, mime: blob.type, warnings: renderer.getIssues().map((i) => i.message) });
      return;
    }

    if (typeof VideoEncoder === 'undefined') throw Object.assign(new Error('MP4 export needs WebCodecs (VideoEncoder), which this browser does not provide. Try a current Chrome, Edge or Safari.'), { code: 'unsupported' });
    const fps = settings.fps;
    const bitrate = Math.round(W * H * fps * BPP[settings.quality as keyof typeof BPP]);
    const candidates = ['avc1.640033', 'avc1.4d0033', 'avc1.42e033', 'avc1.640028'];
    let codec: string | null = null;
    for (const c of candidates) {
      const s = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate, framerate: fps });
      if (s.supported) { codec = c; break; }
    }
    if (!codec) throw Object.assign(new Error(`H.264 encoding at ${W}×${H} is not supported on this device. Try a smaller size.`), { code: 'unsupported' });

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
    let encodeError: Error | null = null;
    const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encodeError = e; } });
    encoder.configure({ codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } } as VideoEncoderConfig);

    await renderer.ready(settings.startTime);
    const perLoop = Math.round(settings.duration * fps);
    const total = perLoop * settings.loops;
    const frameDur = 1e6 / fps;
    for (let i = 0; i < total; i++) {
      if (cancelled.has(jobId)) { encoder.close(); post({ type: 'cancelled', jobId }); return; }
      if (encodeError) throw encodeError;
      // Fixed-time evaluation: frame i is exactly i / fps. Never a real-time capture.
      const t = settings.startTime + (i % perLoop) / fps;
      renderer.render(t, vp, { background: settings.background });
      // Snapshot exactly this frame's drawing buffer. Constructing a VideoFrame from the canvas
      // itself can read a stale presented buffer under GPU load (frames lag the timeline).
      const bitmap = canvas.transferToImageBitmap();
      const frame = new VideoFrame(bitmap, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
      bitmap.close();
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await sleep(2);
      if (i % 4 === 0) post({ type: 'progress', jobId, progress: (i / total) * 0.97, frame: i, total });
      if (i % 30 === 29) await sleep(0);
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    encoder.close();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    post({ type: 'done', jobId, blob, mime: 'video/mp4', warnings: renderer.getIssues().map((i) => i.message) });
  } catch (e: any) {
    post({ type: 'error', jobId, message: e?.message ?? String(e), code: e?.code });
  } finally {
    renderer?.dispose();
    gpu?.dispose();
    cancelled.delete(jobId);
  }
}
