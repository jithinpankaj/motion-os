import { createHmac } from 'node:crypto';

export type Capabilities = { directPublish: boolean; scheduling: boolean; formats: string[]; maxDurationSec?: number; aspectRatios?: string[]; requiresOAuth: boolean };
export type Connection = { id: string; provider: string; config: any; secret: string | null; expires_at: Date | null; status: string };
export type PublishFile = { filename: string; mime: string; bytes: number; url: string };
export type PublishResult = { status: 'confirmed' | 'rejected' | 'failed'; ref?: string; error?: string };

/**
 * Connector contract. Every destination declares capabilities; the UI and server use these to
 * decide between direct publication and a downloadable export package. A publication is only
 * marked confirmed when the destination itself acknowledges it.
 */
export interface Connector {
  id: string;
  name: string;
  category: 'social' | 'web' | 'cms' | 'package';
  description: string;
  capabilities: Capabilities;
  scopes: string[];
  availability(env: NodeJS.ProcessEnv): { available: boolean; reason?: string };
  validateConfig?(config: unknown, isProd: boolean): { config: any; secret?: string };
  refresh?(conn: Connection): Promise<Connection>;
  publish?(conn: Connection, file: PublishFile, meta: Record<string, unknown>): Promise<PublishResult>;
}

const oauthUnavailable = (vars: string[], who: string) => (env: NodeJS.ProcessEnv) =>
  vars.every((v) => env[v])
    ? { available: false, reason: `${who} OAuth flow is architected but app review is pending; use the export package.` }
    : { available: false, reason: `Requires a registered ${who} app (${vars.join(', ')}) and platform review. Not configured — use the export package instead.` };

export const CONNECTORS: Connector[] = [
  {
    id: 'instagram', name: 'Instagram', category: 'social', description: 'Feed and Story publishing via the Instagram Graph API (business accounts only).',
    capabilities: { directPublish: true, scheduling: true, formats: ['mp4', 'png'], maxDurationSec: 90, aspectRatios: ['4:5', '1:1', '9:16'], requiresOAuth: true },
    scopes: ['instagram_basic', 'instagram_content_publish'], availability: oauthUnavailable(['META_APP_ID', 'META_APP_SECRET'], 'Meta'),
  },
  {
    id: 'facebook', name: 'Facebook Pages', category: 'social', description: 'Page posts and reels via the Graph API.',
    capabilities: { directPublish: true, scheduling: true, formats: ['mp4', 'png'], maxDurationSec: 240, requiresOAuth: true },
    scopes: ['pages_manage_posts'], availability: oauthUnavailable(['META_APP_ID', 'META_APP_SECRET'], 'Meta'),
  },
  {
    id: 'linkedin', name: 'LinkedIn', category: 'social', description: 'Organisation posts via the Community Management API.',
    capabilities: { directPublish: true, scheduling: false, formats: ['mp4', 'png'], maxDurationSec: 600, aspectRatios: ['1:1', '1.91:1', '4:5'], requiresOAuth: true },
    scopes: ['w_organization_social'], availability: oauthUnavailable(['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'], 'LinkedIn'),
  },
  {
    id: 'website-embed', name: 'Website embed', category: 'web', description: 'Interactive WebGL embed driven by a version-pinned configuration (Developer delivery).',
    capabilities: { directPublish: false, scheduling: false, formats: ['embed', 'scene-json'], requiresOAuth: false },
    scopes: [], availability: () => ({ available: true, reason: 'Copy the configuration from Developer delivery; hosted CDN delivery is a later phase.' }),
  },
  {
    id: 'webhook', name: 'CMS / App webhook', category: 'cms', description: 'POST signed publication events to your CMS or product backend. Success requires a 2xx acknowledgement.',
    capabilities: { directPublish: true, scheduling: false, formats: ['mp4', 'png', 'webp', 'scene-json', 'embed'], requiresOAuth: false },
    scopes: ['publish'],
    availability: () => ({ available: true }),
    validateConfig(config: any, isProd) {
      const url = new URL(String(config?.url ?? ''));
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('URL must be http(s)');
      if (isProd && (url.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(url.hostname))) throw new Error('Production webhooks must be public https URLs');
      const name = String(config?.name ?? url.hostname).slice(0, 60);
      const ttl = Number(config?.tokenTtlSeconds ?? 0);
      return { config: { url: url.toString(), name, tokenTtlSeconds: ttl > 0 ? ttl : null }, secret: String(config?.secret ?? '') || undefined };
    },
    async publish(conn, file, meta) {
      const payload = JSON.stringify({ event: 'motion.published', file, meta, sentAt: new Date().toISOString() });
      const sig = conn.secret ? createHmac('sha256', conn.secret).update(payload).digest('hex') : '';
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        const res = await fetch(conn.config.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-motion-signature': sig }, body: payload, signal: ctrl.signal });
        clearTimeout(timer);
        const text = (await res.text()).slice(0, 500);
        if (res.ok) {
          let ref: string | undefined;
          try { ref = JSON.parse(text)?.id; } catch {}
          return { status: 'confirmed', ref: ref ?? `HTTP ${res.status}` };
        }
        return { status: 'rejected', error: `Destination rejected the asset (HTTP ${res.status}): ${text || res.statusText}` };
      } catch (e: any) {
        return { status: 'failed', error: e.name === 'AbortError' ? 'Destination did not respond within 10 s' : `Could not reach destination: ${e.message}` };
      }
    },
  },
  {
    id: 'package', name: 'Export package', category: 'package', description: 'Download a zip of rendered files with a manifest. Works for every destination.',
    capabilities: { directPublish: false, scheduling: false, formats: ['mp4', 'png', 'webp', 'scene-json', 'embed'], requiresOAuth: false },
    scopes: [], availability: () => ({ available: true }),
  },
];
