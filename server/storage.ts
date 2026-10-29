import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Object storage adapter. Local disk in development; the interface mirrors S3/GCS
 * (put/get/delete + signed GET URLs) so a cloud adapter can be dropped in.
 */
export interface Storage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signedUrl(key: string, ttlSeconds?: number, filename?: string): string;
  verify(key: string, exp: string, sig: string): boolean;
}

export function localStorage(root: string, secret: string): Storage {
  const safe = (key: string) => {
    if (!/^[A-Za-z0-9_\-/.]+$/.test(key) || key.includes('..')) throw new Error('invalid storage key');
    return path.join(root, key);
  };
  const sign = (key: string, exp: number) => createHmac('sha256', secret).update(`${key}:${exp}`).digest('base64url');
  return {
    async put(key, data) {
      const p = safe(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, data);
    },
    get: (key) => readFile(safe(key)),
    async remove(key) { await unlink(safe(key)).catch(() => {}); },
    async exists(key) { return stat(safe(key)).then(() => true, () => false); },
    signedUrl(key, ttl = 3600, filename) {
      // Round expiry to the TTL window so URLs are cache-stable within a window.
      const exp = Math.ceil(Date.now() / 1000 / ttl) * ttl + ttl;
      const q = new URLSearchParams({ exp: String(exp), sig: sign(key, exp) });
      if (filename) q.set('dl', filename);
      return `/files/${key}?${q}`;
    },
    verify(key, exp, sig) {
      const e = Number(exp);
      if (!Number.isFinite(e) || e * 1000 < Date.now()) return false;
      const a = Buffer.from(sign(key, e)), b = Buffer.from(String(sig));
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
