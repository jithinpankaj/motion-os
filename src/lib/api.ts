import { useSession } from './session';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}

type Opts = { method?: string; body?: unknown; raw?: Blob | ArrayBuffer; query?: Record<string, string | number | boolean | undefined | null>; signal?: AbortSignal; headers?: Record<string, string>; noWorkspace?: boolean };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const { wsId } = useSession.getState();
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (wsId && !opts.noWorkspace) headers['x-workspace-id'] = wsId;
  let body: BodyInit | undefined;
  if (opts.raw) { body = opts.raw as BodyInit; headers['content-type'] = 'application/octet-stream'; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['content-type'] = 'application/json'; }
  const q = opts.query ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])) : '';
  let res: Response;
  try {
    res = await fetch(`/api${path}${q}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin', signal: opts.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'offline', 'You appear to be offline. Changes are kept on this device and will sync when you reconnect.');
  }
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : res.ok ? await res.blob() : null;
  if (!res.ok) {
    const err = data?.error ?? {};
    const e = new ApiError(res.status, err.code ?? 'http_' + res.status, err.message ?? res.statusText, err.details);
    if (res.status === 401 && err.code === 'unauthenticated') useSession.getState().expire();
    if (res.status === 403 && err.code === 'workspace_access_lost') useSession.getState().accessLost();
    throw e;
  }
  return data as T;
}

export const errorMessage = (e: unknown) => {
  if (e instanceof ApiError) {
    if (Array.isArray(e.details) && e.details.length && typeof e.details[0] === 'string') return `${e.message}: ${e.details.join(' ')}`;
    if (Array.isArray(e.details) && e.details[0]?.message) return `${e.message} — ${e.details.slice(0, 3).map((d: any) => (d.path ? `${d.path}: ` : '') + d.message).join('; ')}`;
    return e.message;
  }
  return (e as Error)?.message ?? 'Something went wrong';
};
