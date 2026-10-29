import { create } from 'zustand';
import { api, errorMessage } from './api';
import { toast } from '../ui/controls';
import type { WorkerOut } from '../engine/export/worker';
import type { ResolvedAsset } from '../engine/assets';

export type ExportJob = {
  id: string; format: string; settings: any; status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'; progress: number;
  error: { message: string; code?: string } | null; source: any; createdAt: string; result: { url: string; filename: string; bytes: number; mime: string } | null;
};
export type ExportRequest = { source: any; format: string; settings: Record<string, unknown>; channel?: string; name?: string };

type State = {
  jobs: ExportJob[];
  trayOpen: boolean;
  running: string | null;
  setTray: (o: boolean) => void;
  refresh: () => Promise<void>;
  create: (r: ExportRequest) => Promise<ExportJob>;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
};

let worker: Worker | null = null;
const getWorker = () => (worker ??= new Worker(new URL('../engine/export/worker.ts', import.meta.url), { type: 'module' }));

export const useExports = create<State>((set, get) => ({
  jobs: [],
  trayOpen: false,
  running: null,
  setTray: (o) => set({ trayOpen: o }),
  refresh: async () => {
    try {
      const { jobs } = await api<{ jobs: ExportJob[] }>('/exports');
      set({ jobs: jobs.map((j) => (j.id === get().running ? { ...j, ...get().jobs.find((x) => x.id === j.id) } : j)) });
      pump();
    } catch {}
  },
  create: async (r) => {
    const { job } = await api<{ job: ExportJob }>('/exports', { body: r });
    set({ jobs: [job, ...get().jobs], trayOpen: true });
    pump();
    return job;
  },
  cancel: async (id) => {
    if (get().running === id) getWorker().postMessage({ type: 'cancel', jobId: id });
    await api(`/exports/${id}/cancel`, { method: 'POST' }).catch(() => {});
    patch(id, { status: 'cancelled' });
  },
  retry: async (id) => {
    await api(`/exports/${id}/retry`, { method: 'POST' });
    await get().refresh();
  },
}));

const patch = (id: string, p: Partial<ExportJob>) => useExports.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));

/** Background queue: one job at a time in a dedicated worker; one tab at a time via Web Locks. */
function pump() {
  const s = useExports.getState();
  if (s.running) return;
  const next = [...s.jobs].reverse().find((j) => j.status === 'queued' || j.status === 'processing');
  if (!next) return;
  useExports.setState({ running: next.id });
  const runIt = () => runJob(next).finally(() => { useExports.setState({ running: null }); setTimeout(pump, 50); });
  const locks = (navigator as any).locks;
  if (locks?.request) locks.request('motion-os-export', runIt).catch(() => {});
  else runIt();
}

async function runJob(job: ExportJob) {
  try {
    const fresh = (await api<{ jobs: ExportJob[] }>('/exports')).jobs.find((j) => j.id === job.id);
    if (!fresh || !['queued', 'processing'].includes(fresh.status)) { if (fresh) patch(job.id, fresh); return; }
    await api(`/exports/${job.id}`, { method: 'PATCH', body: { status: 'processing', progress: 0 } });
    patch(job.id, { status: 'processing', progress: 0 });
    const { scene, settings, format } = await api<{ scene: any; settings: any; format: any }>(`/exports/${job.id}/scene`);
    const ids = new Set<string>();
    for (const l of scene.layers) {
      if (l.type === 'image' && l.props.assetId) ids.add(l.props.assetId);
      if (l.type === 'mesh' && l.props.material.textureAssetId) ids.add(l.props.material.textureAssetId);
      if (l.type === 'text' && l.props.fontAssetId) ids.add(l.props.fontAssetId);
    }
    const { assets } = await api<{ assets: Record<string, ResolvedAsset> }>('/assets/resolve', { body: { ids: [...ids], context: { type: 'export', id: job.id } } });
    for (const a of Object.values(assets)) if ('url' in a) a.url = new URL(a.url, location.origin).toString();
    const result = await new Promise<{ blob: Blob } | null>((resolve, reject) => {
      const w = getWorker();
      let lastSent = 0;
      const onMsg = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (m.jobId !== job.id) return;
        if (m.type === 'progress') {
          patch(job.id, { progress: m.progress });
          if (Date.now() - lastSent > 1000) { lastSent = Date.now(); api(`/exports/${job.id}`, { method: 'PATCH', body: { progress: m.progress } }).catch(() => {}); }
        }
        if (m.type === 'done') { w.removeEventListener('message', onMsg); if (m.warnings?.length) toast('warn', 'Export rendered with warnings', m.warnings.join(' · ')); resolve({ blob: m.blob }); }
        if (m.type === 'cancelled') { w.removeEventListener('message', onMsg); resolve(null); }
        if (m.type === 'error') { w.removeEventListener('message', onMsg); reject(Object.assign(new Error(m.message), { code: m.code })); }
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ type: 'run', jobId: job.id, format, scene, settings, assets });
    });
    if (!result) return;
    patch(job.id, { progress: 0.99 });
    const { job: done } = await api<{ job: ExportJob }>(`/exports/${job.id}/result`, { method: 'PUT', raw: result.blob });
    patch(job.id, done);
    toast('ok', 'Export ready', `${done.result?.filename} · ${(done.result!.bytes / 1e6).toFixed(2)} MB`, { label: 'Download', run: () => download(done) });
  } catch (e: any) {
    const message = errorMessage(e);
    patch(job.id, { status: 'failed', error: { message, code: e.code } });
    await api(`/exports/${job.id}`, { method: 'PATCH', body: { status: 'failed', error: { message: message.slice(0, 900), code: e.code } } }).catch(() => {});
    toast('danger', 'Export failed', message, { label: 'Retry', run: () => useExports.getState().retry(job.id) });
  }
}

export function download(job: ExportJob) {
  if (!job.result) return;
  const a = document.createElement('a');
  a.href = job.result.url;
  a.download = job.result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
