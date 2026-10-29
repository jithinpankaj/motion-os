import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM for third-party credentials at rest. Keys never leave the server or reach the client. */
const key = (secret: string) => createHash('sha256').update(`credentials:${secret}`).digest();

export function seal(secret: string, value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(secret), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}

export function unseal<T = any>(secret: string, sealed: string): T {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1') throw new Error('Unknown credential format');
  const d = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8'));
}

/** "abcd…wxyz" — enough for a person to recognise which key is stored. */
export const mask = (s: string) => (s.length <= 10 ? '••••' : `${s.slice(0, 4)}…${s.slice(-4)}`);
