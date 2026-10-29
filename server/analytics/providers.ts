import { createSign } from 'node:crypto';
import { HttpError } from '../http';
import { safeFetch } from '../services/safeFetch';

/**
 * Analytics connectors. Each provider validates credentials with a real API call before a
 * connection is marked connected, and fetches metrics for one linked item (a GA4 utm_content,
 * an Instagram/Facebook post, a LinkedIn post). Nothing here fabricates numbers: a failed call
 * is reported as an error on the link.
 */
export type Metrics = Partial<Record<'impressions' | 'reach' | 'views' | 'clicks' | 'engagements' | 'likes' | 'comments' | 'shares' | 'saves' | 'sessions' | 'users' | 'engagedSessions' | 'conversions', number>>;
export type MetricResult = { metrics: Metrics; series: { date: string; value: number }[]; seriesLabel?: string };

export const META_GRAPH = 'https://graph.facebook.com/v23.0';
export const LINKEDIN_API = 'https://api.linkedin.com/rest';
const GA_DATA = 'https://analyticsdata.googleapis.com/v1beta';

async function json(url: string, init: { headers?: Record<string, string>; method?: string; body?: string } = {}) {
  const r = await safeFetch(url, { ...init, accept: 'application/json', maxBytes: 5e6, timeoutMs: 20_000 });
  let body: any = {};
  try { body = JSON.parse(r.body.toString('utf8') || '{}'); } catch { /* non-JSON error page */ }
  return { status: r.status, ok: r.ok, body };
}
const apiError = (provider: string, r: { status: number; body: any }) => {
  const msg = r.body?.error?.message ?? r.body?.error_description ?? r.body?.message ?? `HTTP ${r.status}`;
  // Provider 4xx (bad token, missing permission, unknown post) is fixable by the user; 5xx/timeouts are upstream.
  const status = r.status === 429 ? 429 : r.status >= 400 && r.status < 500 ? 400 : 502;
  return new HttpError(status, `${provider}_error`, `${provider}: ${msg}`);
};

// ---------------- Google Analytics 4 (service account) ----------------

export type Ga4Secret = { client_email: string; private_key: string; token_uri?: string };

export function parseServiceAccount(raw: string): Ga4Secret {
  let j: any;
  try { j = JSON.parse(raw); } catch { throw new HttpError(400, 'bad_credentials', 'Paste the whole service-account JSON key file'); }
  if (j.type !== 'service_account' || !j.client_email || !j.private_key) throw new HttpError(400, 'bad_credentials', 'That JSON is not a Google service-account key (needs type, client_email and private_key)');
  return { client_email: j.client_email, private_key: j.private_key, token_uri: j.token_uri };
}

async function googleToken(sa: Ga4Secret) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const aud = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud, iat: now, exp: now + 3600 })}`;
  let sig: string;
  try { sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url'); } catch { throw new HttpError(400, 'bad_credentials', 'The service-account private key could not be read'); }
  const r = await json(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}` });
  if (!r.ok || !r.body.access_token) throw apiError('Google', r);
  return r.body.access_token as string;
}

async function ga4Report(sa: Ga4Secret, propertyId: string, body: unknown) {
  const token = await googleToken(sa);
  const r = await json(`${GA_DATA}/properties/${encodeURIComponent(propertyId)}:runReport`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw apiError('GA4', r);
  return r.body;
}

export async function ga4Verify(sa: Ga4Secret, propertyId: string) {
  if (!/^\d{5,15}$/.test(propertyId)) throw new HttpError(400, 'bad_property', 'GA4 property IDs are numbers, e.g. 312345678 (Admin → Property details)');
  await ga4Report(sa, propertyId, { dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], metrics: [{ name: 'sessions' }], limit: 1 });
  return { label: `GA4 property ${propertyId}` };
}

/** Sessions etc. for visits tagged utm_content=<ref> over the last `days` days. */
export async function ga4Metrics(sa: Ga4Secret, propertyId: string, ref: string, days = 28): Promise<MetricResult> {
  const body = await ga4Report(sa, propertyId, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
    dimensionFilter: { filter: { fieldName: 'sessionManualAdContent', stringFilter: { matchType: 'EXACT', value: ref } } },
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    limit: 400,
  });
  const totals = [0, 0, 0, 0];
  const series: { date: string; value: number }[] = [];
  for (const row of body.rows ?? []) {
    const vals = row.metricValues.map((m: any) => Number(m.value) || 0);
    vals.forEach((v: number, i: number) => (totals[i] += v));
    const d = row.dimensionValues[0].value as string;
    series.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, value: vals[0] });
  }
  return { metrics: { sessions: totals[0], users: totals[1], engagedSessions: totals[2], conversions: totals[3] }, series, seriesLabel: 'Sessions per day' };
}

// ---------------- Meta (Instagram + Facebook) ----------------

export async function metaVerify(token: string) {
  const r = await json(`${META_GRAPH}/me?fields=id,name`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw apiError('Meta', r);
  return { label: r.body.name ? `Meta · ${r.body.name}` : 'Meta account' };
}

export async function metaMetrics(token: string, kind: 'instagram' | 'facebook', ref: string): Promise<MetricResult> {
  const auth = { authorization: `Bearer ${token}` };
  if (kind === 'instagram') {
    const r = await json(`${META_GRAPH}/${encodeURIComponent(ref)}/insights?metric=reach,views,likes,comments,shares,saved,total_interactions`, { headers: auth });
    if (!r.ok) throw apiError('Instagram', r);
    const v = (name: string) => r.body.data?.find((d: any) => d.name === name)?.values?.[0]?.value;
    return { metrics: { reach: v('reach'), views: v('views'), likes: v('likes'), comments: v('comments'), shares: v('shares'), saves: v('saved'), engagements: v('total_interactions') }, series: [] };
  }
  const r = await json(`${META_GRAPH}/${encodeURIComponent(ref)}?fields=shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)`, { headers: auth });
  if (!r.ok) throw apiError('Facebook', r);
  const likes = r.body.reactions?.summary?.total_count, comments = r.body.comments?.summary?.total_count, shares = r.body.shares?.count ?? 0;
  const out: Metrics = { likes, comments, shares, engagements: (likes ?? 0) + (comments ?? 0) + shares };
  const ins = await json(`${META_GRAPH}/${encodeURIComponent(ref)}/insights?metric=post_impressions_unique,post_clicks`, { headers: auth });
  if (ins.ok) {
    const v = (name: string) => ins.body.data?.find((d: any) => d.name === name)?.values?.[0]?.value;
    out.reach = v('post_impressions_unique'); out.clicks = v('post_clicks');
  }
  return { metrics: out, series: [] };
}

// ---------------- LinkedIn (organisation posts) ----------------

const liHeaders = (token: string, version: string) => ({ authorization: `Bearer ${token}`, 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0' });

export function parseLinkedInPost(input: string): string {
  const m = decodeURIComponent(input).match(/urn:li:(share|ugcPost|activity):(\d+)/);
  if (!m) throw new HttpError(400, 'bad_ref', 'Paste the LinkedIn post link (it contains urn:li:share:… or urn:li:ugcPost:…) — use “Copy link to post”, then open it and copy the address');
  if (m[1] === 'activity') throw new HttpError(400, 'bad_ref', 'That link uses an activity ID. Open the post’s “…” menu → “Embed this post” and paste the URL from the embed code, which has the share or ugcPost ID');
  return `urn:li:${m[1]}:${m[2]}`;
}

export async function linkedinVerify(token: string, orgId: string, version: string) {
  if (!/^\d+$/.test(orgId)) throw new HttpError(400, 'bad_org', 'The organisation ID is the number in your company admin URL, e.g. linkedin.com/company/12345678/admin');
  const r = await json(`${LINKEDIN_API}/organizations/${orgId}`, { headers: liHeaders(token, version) });
  if (!r.ok) throw apiError('LinkedIn', r);
  return { label: `LinkedIn · ${r.body.localizedName ?? `organisation ${orgId}`}` };
}

export async function linkedinMetrics(token: string, orgId: string, version: string, urn: string): Promise<MetricResult> {
  const param = urn.includes(':ugcPost:') ? 'ugcPosts' : 'shares';
  const url = `${LINKEDIN_API}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(`urn:li:organization:${orgId}`)}&${param}=List(${encodeURIComponent(urn)})`;
  const r = await json(url, { headers: liHeaders(token, version) });
  if (!r.ok) throw apiError('LinkedIn', r);
  const s = r.body.elements?.[0]?.totalShareStatistics;
  if (!s) throw new HttpError(404, 'linkedin_no_stats', 'LinkedIn returned no statistics for that post. It must be a post by the connected organisation.');
  return { metrics: { impressions: s.impressionCount, reach: s.uniqueImpressionsCount, clicks: s.clickCount, likes: s.likeCount, comments: s.commentCount, shares: s.shareCount, engagements: (s.clickCount ?? 0) + (s.likeCount ?? 0) + (s.commentCount ?? 0) + (s.shareCount ?? 0) }, series: [] };
}

/** LinkedIn versions are YYYYMM and retire after about a year; default to two months ago. */
export function defaultLinkedInVersion(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
