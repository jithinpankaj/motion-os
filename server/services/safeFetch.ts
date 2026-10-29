import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpError } from '../http';

/**
 * Outbound fetch for user-supplied URLs (website brand import, remote logos). Blocks private,
 * loopback and link-local destinations on every redirect hop, caps size and time, and only
 * speaks http(s). Tests inject their own implementation through `setFetchImpl`.
 */
export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
let impl: FetchImpl = (url, init) => fetch(url, init);
let checkHosts = true;
export function setFetchImpl(f: FetchImpl, opts: { skipHostCheck?: boolean } = {}) { impl = f; checkHosts = !opts.skipHostCheck; }

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublic(u: URL) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'bad_url', 'Only http and https links can be imported');
  if (!checkHosts) return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new HttpError(400, 'bad_url', 'That address is on a private network');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new HttpError(400, 'bad_url', `Could not find ${host}`); });
  if (addrs.some((a) => privateAddress(a.address))) throw new HttpError(400, 'bad_url', 'That address is on a private network');
}

export async function safeFetch(raw: string, opts: { maxBytes?: number; timeoutMs?: number; accept?: string; headers?: Record<string, string>; method?: string; body?: string } = {}) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpError(400, 'bad_url', 'That doesn’t look like a web address'); }
  const maxBytes = opts.maxBytes ?? 3e6;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    for (let hop = 0; hop < 5; hop++) {
      await assertPublic(url);
      const res = await impl(url.toString(), {
        method: opts.method ?? 'GET', body: opts.body, redirect: 'manual', signal: ctrl.signal,
        headers: { 'user-agent': 'Twylo-BrandImport/1.0', accept: opts.accept ?? '*/*', ...opts.headers },
      }).catch((e) => { throw new HttpError(502, 'fetch_failed', e?.name === 'AbortError' ? 'The site took too long to respond' : `Could not reach ${url.hostname}`); });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location')!, url); continue; }
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > maxBytes) throw new HttpError(413, 'too_large', 'The file is too large to import');
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) { ctrl.abort(); throw new HttpError(413, 'too_large', 'The file is too large to import'); }
        chunks.push(value);
      }
      return { status: res.status, ok: res.ok, url: url.toString(), contentType: res.headers.get('content-type') ?? '', body: Buffer.concat(chunks) };
    }
    throw new HttpError(400, 'bad_url', 'Too many redirects');
  } finally { clearTimeout(timer); }
}
