import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { EmptyState, Field, Modal, toast, timeAgo } from '../../ui/controls';
import { Icon } from '../../ui/Icon';

type Conn = { id: string; provider: 'ga4' | 'meta' | 'linkedin'; status: string; label: string; hint?: string; checkedAt?: string; error?: string | null };
type LinkRow = { id: string; kind: 'ga4' | 'instagram' | 'facebook' | 'linkedin'; ref: string; label: string; project_id: string; motion: string; fetched_at: string | null; ok: boolean | null; metrics: Record<string, number | undefined> | null; series: { date: string; value: number }[] | null; series_label: string | null; error: string | null; last_success: string | null; connection_status: string };

const PROVIDERS: { id: Conn['provider']; name: string; color: string; short: string; covers: string }[] = [
  { id: 'ga4', name: 'Google Analytics 4', short: 'GA', color: '#e37400', covers: 'Website visits, engagement and conversions from links that carry your motion’s tag.' },
  { id: 'meta', name: 'Meta (Instagram & Facebook)', short: 'M', color: '#0866ff', covers: 'Reach, views, likes, comments, shares and saves for posts.' },
  { id: 'linkedin', name: 'LinkedIn Page', short: 'in', color: '#0a66c2', covers: 'Impressions, clicks and engagement for your company page posts.' },
];
const KIND: Record<LinkRow['kind'], { label: string; provider: Conn['provider'] }> = {
  ga4: { label: 'Website (GA4)', provider: 'ga4' }, instagram: { label: 'Instagram', provider: 'meta' }, facebook: { label: 'Facebook', provider: 'meta' }, linkedin: { label: 'LinkedIn', provider: 'linkedin' },
};
const fmt = (n: number | undefined | null) => (n === undefined || n === null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : n.toLocaleString());

export default function Analytics() {
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<{ links: LinkRow[]; connections: Conn[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<Conn['provider'] | null>(null);
  const [linking, setLinking] = useState<string | null>(sp.get('motion'));
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const load = () => api('/analytics/dashboard').then(setData).catch((e) => setError(errorMessage(e)));
  useEffect(() => { load(); }, []);

  const refresh = async (ids: string[]) => {
    setRefreshing(new Set(ids));
    const results = await Promise.all(ids.map((id) => api(`/analytics/links/${id}/refresh`, { method: 'POST' }).catch((e) => ({ ok: false, error: errorMessage(e) }))));
    const failed = results.filter((r: any) => !r.ok).length;
    if (failed) toast('warn', `${failed} of ${ids.length} could not be updated`, 'See the row for the reason. Earlier numbers stay visible.');
    else toast('ok', 'Numbers updated');
    setRefreshing(new Set());
    load();
  };

  const conns = data?.connections ?? [];
  const connOf = (p: Conn['provider']) => conns.find((c) => c.provider === p);
  const links = data?.links ?? [];
  const totals = useMemo(() => {
    const sum = (k: string) => { const v = links.filter((l) => l.metrics?.[k] !== undefined && l.metrics?.[k] !== null); return v.length ? { value: v.reduce((a, l) => a + (l.metrics![k] ?? 0), 0), n: v.length } : null; };
    const reach = (() => { const v = links.map((l) => l.metrics?.reach ?? l.metrics?.impressions ?? l.metrics?.views).filter((x): x is number => typeof x === 'number'); return v.length ? { value: v.reduce((a, b) => a + b, 0), n: v.length } : null; })();
    return { reach, engagements: sum('engagements'), clicks: sum('clicks'), sessions: sum('sessions') };
  }, [links]);

  return (
    <div className="page-inner">
      <div className="row between wrap" style={{ alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div className="eyebrow">Analytics</div>
          <h1 className="h1" style={{ marginTop: 8 }}>How your motion is doing</h1>
          <p className="lead">Connect your accounts, link each motion to where it’s published, and see the results in one place. Numbers come straight from each platform.</p>
        </div>
        <div className="row">
          {links.length > 0 && <button className="btn lg" disabled={refreshing.size > 0} onClick={() => refresh(links.map((l) => l.id))}>{refreshing.size ? <span className="spinner" /> : <Icon name="refresh" />}Refresh all</button>}
          {can('analytics.manage') && conns.length > 0 && <button className="btn primary lg" onClick={() => setLinking('')}><Icon name="link" />Link a motion</button>}
        </div>
      </div>

      {error && <EmptyState icon="alert" title="Analytics unavailable">{error}</EmptyState>}

      <div className="section" style={{ marginTop: 28 }}>
        <div className="section-h"><h2 className="h2">Connected accounts</h2></div>
        <div className="conn-grid">
          {PROVIDERS.map((p) => {
            const c = connOf(p.id);
            return (
              <div key={p.id} className="panel conn">
                <div className="top">
                  <span className="logo" style={{ background: p.color }}>{p.short}</span>
                  <div className="grow"><div style={{ fontWeight: 580 }}>{p.name}</div>
                    <div className="faint row" style={{ fontSize: 12, gap: 6 }}><span className={`dot ${c ? (c.error ? 'err' : 'ok') : ''}`} />{c ? (c.error ? 'Needs attention' : c.label) : 'Not connected'}</div>
                  </div>
                </div>
                <div className="note">{c?.error ?? p.covers}</div>
                {can('analytics.manage') && <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
                  <button className={`btn sm ${c ? '' : 'primary'}`} onClick={() => setConnecting(p.id)}>{c ? 'Reconnect' : 'Connect'}</button>
                  {c && <button className="btn sm ghost" onClick={async () => { await api(`/analytics/connections/${c.id}`, { method: 'DELETE' }); toast('ok', `${p.name} disconnected`); load(); }}>Disconnect</button>}
                </div>}
              </div>
            );
          })}
        </div>
      </div>

      {data && (
        <div className="section">
          <div className="section-h"><h2 className="h2">Results</h2>{links.length > 0 && <span className="faint" style={{ fontSize: 12 }}>{links.length} linked post{links.length > 1 ? 's' : ''}</span>}</div>
          {!conns.length ? (
            <EmptyState icon="chart" title="Start by connecting an account">
              Connect Google Analytics, Meta or LinkedIn above. Then link each motion to its post (or to your website link) and its numbers appear here.
            </EmptyState>
          ) : !links.length ? (
            <EmptyState icon="link" title="No motions linked yet" action={can('analytics.manage') && <button className="btn primary" onClick={() => setLinking('')}>Link a motion</button>}>
              Pick a motion and paste the post it was published in — or get a tagged website link to track visits in GA4.
            </EmptyState>
          ) : (
            <>
              <div className="kpis">
                <Kpi label="Reach / impressions / views" t={totals.reach} />
                <Kpi label="Engagements" t={totals.engagements} />
                <Kpi label="Clicks" t={totals.clicks} />
                <Kpi label="Website sessions" t={totals.sessions} />
              </div>
              <div className="panel" style={{ marginTop: 16, overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr><th>Motion</th><th>Where</th><th className="num">Reach</th><th className="num">Engagements</th><th className="num">Clicks</th><th className="num">Sessions</th><th>Trend</th><th>Updated</th><th /></tr></thead>
                  <tbody>
                    {links.map((l) => {
                      const m = l.metrics ?? {};
                      return (
                        <tr key={l.id}>
                          <td><Link to={`/create/${l.project_id}`} style={{ fontWeight: 560 }}>{l.motion}</Link>{l.label && <div className="faint" style={{ fontSize: 11.5 }}>{l.label}</div>}</td>
                          <td><span className="badge">{KIND[l.kind].label}</span><div className="faint mono" style={{ fontSize: 10.5, marginTop: 3, maxWidth: 180 }} title={l.ref}>{l.ref.length > 28 ? l.ref.slice(0, 28) + '…' : l.ref}</div></td>
                          <td className="num">{fmt(m.reach ?? m.impressions ?? m.views)}</td>
                          <td className="num">{fmt(m.engagements)}</td>
                          <td className="num">{fmt(m.clicks)}</td>
                          <td className="num">{fmt(m.sessions)}</td>
                          <td>{l.series && l.series.length > 1 ? <Spark data={l.series} label={l.series_label ?? ''} /> : <span className="faint">—</span>}</td>
                          <td style={{ minWidth: 150 }}>
                            {!l.fetched_at ? <span className="faint">Not fetched yet</span>
                              : l.ok ? <span className="faint">{timeAgo(l.fetched_at)}</span>
                              : <div><span style={{ color: 'var(--danger)', fontSize: 12 }}>{l.error}</span>{l.last_success && <div className="faint" style={{ fontSize: 11 }}>Showing numbers from {timeAgo(l.last_success)}</div>}</div>}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button className="btn sm ghost icon" aria-label={`Refresh ${l.motion}`} disabled={refreshing.has(l.id)} onClick={() => refresh([l.id])}>{refreshing.has(l.id) ? <span className="spinner" /> : <Icon name="refresh" size={13} />}</button>
                            {can('analytics.manage') && <button className="btn sm ghost icon" aria-label={`Unlink ${l.motion}`} onClick={async () => { await api(`/analytics/links/${l.id}`, { method: 'DELETE' }); load(); }}><Icon name="trash" size={13} /></button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {connecting && <ConnectModal provider={connecting} onClose={() => setConnecting(null)} onDone={() => { setConnecting(null); load(); }} />}
      {linking !== null && <LinkModal initialMotion={linking} conns={conns} onClose={() => { setLinking(null); if (sp.get('motion')) setSp({}, { replace: true }); }} onDone={(id) => { setLinking(null); setSp({}, { replace: true }); load().then(() => refresh([id])); }} onConnect={(p) => { setLinking(null); setConnecting(p); }} />}
    </div>
  );
}

function Kpi({ label, t }: { label: string; t: { value: number; n: number } | null }) {
  return <div className="panel kpi"><span className="k">{label}</span><span className="v">{t ? fmt(t.value) : '—'}</span><span className="s">{t ? `from ${t.n} linked post${t.n > 1 ? 's' : ''}` : 'no data yet'}</span></div>;
}

function Spark({ data, label }: { data: { date: string; value: number }[]; label: string }) {
  const w = 110, h = 28, max = Math.max(1, ...data.map((d) => d.value));
  const pts = data.map((d, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - (d.value / max) * (h - 4)).toFixed(1)}`).join(' ');
  return <svg width={w} height={h} role="img" aria-label={`${label}: ${data.map((d) => d.value).join(', ')}`}><polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" /></svg>;
}

function ConnectModal({ provider, onClose, onDone }: { provider: Conn['provider']; onClose: () => void; onDone: () => void }) {
  const p = PROVIDERS.find((x) => x.id === provider)!;
  const [v, setV] = useState({ serviceAccountJson: '', propertyId: '', accessToken: '', organizationId: '', version: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const body = provider === 'ga4' ? { serviceAccountJson: v.serviceAccountJson, propertyId: v.propertyId } : provider === 'meta' ? { accessToken: v.accessToken } : { accessToken: v.accessToken, organizationId: v.organizationId, ...(v.version ? { version: v.version } : {}) };
      const r = await api(`/analytics/connections/${provider}`, { body });
      toast('ok', `${p.name} connected`, r.label);
      onDone();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Connect ${p.name}`} subtitle="We check the credentials with the platform before saving. They’re stored encrypted and never shown again." wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={go}>{busy ? <span className="spinner" /> : 'Check and connect'}</button></>}>
      <div className="col" style={{ gap: 14 }}>
        {provider === 'ga4' && <>
          <ol className="howto">
            <li>In Google Cloud, create a <b>service account</b> and download its JSON key. Enable the <b>Google Analytics Data API</b> for that project.</li>
            <li>In GA4 → Admin → Property access management, add the service account’s email as a <b>Viewer</b>.</li>
            <li>Copy your <b>Property ID</b> from Admin → Property details.</li>
          </ol>
          <Field label="Property ID"><input className="input" value={v.propertyId} onChange={(e) => setV({ ...v, propertyId: e.target.value })} placeholder="312345678" /></Field>
          <Field label="Service account JSON key"><textarea className="input" rows={6} style={{ height: 'auto', padding: 10, fontFamily: 'var(--mono)', fontSize: 11.5 }} value={v.serviceAccountJson} onChange={(e) => setV({ ...v, serviceAccountJson: e.target.value })} placeholder='{"type": "service_account", ...}' /></Field>
        </>}
        {provider === 'meta' && <>
          <ol className="howto">
            <li>In Meta for Developers, use an app with <code>instagram_manage_insights</code>, <code>pages_read_engagement</code> and <code>read_insights</code>.</li>
            <li>Generate a <b>long-lived</b> user or system-user access token for the Page and its Instagram professional account (Business Settings → System users is best).</li>
            <li>Paste the token. It needs access to the Page or Instagram account the posts belong to.</li>
          </ol>
          <Field label="Access token"><input className="input" type="password" value={v.accessToken} onChange={(e) => setV({ ...v, accessToken: e.target.value })} placeholder="EAAG…" /></Field>
        </>}
        {provider === 'linkedin' && <>
          <ol className="howto">
            <li>LinkedIn requires an app with the <b>Community Management API</b> product approved, and the <code>r_organization_social</code> permission.</li>
            <li>Create an access token for a Page admin (Developer portal → Auth → token generator).</li>
            <li>Your organisation ID is the number in your Page admin address: linkedin.com/company/<b>12345678</b>/admin.</li>
          </ol>
          <Field label="Organisation ID"><input className="input" value={v.organizationId} onChange={(e) => setV({ ...v, organizationId: e.target.value })} placeholder="12345678" /></Field>
          <Field label="Access token"><input className="input" type="password" value={v.accessToken} onChange={(e) => setV({ ...v, accessToken: e.target.value })} placeholder="AQV…" /></Field>
          <Field label="API version" hint="Optional, YYYYMM. Defaults to two months ago; LinkedIn retires versions after about a year."><input className="input" value={v.version} onChange={(e) => setV({ ...v, version: e.target.value })} placeholder="202608" /></Field>
        </>}
        {err && <div className="field-error" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

function LinkModal({ initialMotion, conns, onClose, onDone, onConnect }: { initialMotion: string; conns: Conn[]; onClose: () => void; onDone: (id: string) => void; onConnect: (p: Conn['provider']) => void }) {
  const [motions, setMotions] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState(initialMotion);
  const [kind, setKind] = useState<LinkRow['kind']>(() => (conns.find((c) => c.provider === 'meta') ? 'instagram' : conns.find((c) => c.provider === 'linkedin') ? 'linkedin' : 'ga4'));
  const [ref, setRef] = useState('');
  const [label, setLabel] = useState('');
  const [site, setSite] = useState('https://');
  const [utm, setUtm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api('/projects').then((r) => { setMotions(r.projects.map((p: any) => ({ id: p.id, name: p.name }))); if (!projectId && r.projects[0]) setProjectId(r.projects[0].id); }).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (projectId) api(`/analytics/utm/${projectId}`).then((r) => setUtm(r.utmContent)).catch(() => setUtm(null)); }, [projectId]);
  const connected = !!conns.find((c) => c.provider === KIND[kind].provider);
  const tagged = (() => {
    try { const u = new URL(site); u.searchParams.set('utm_source', 'motion-os'); u.searchParams.set('utm_medium', 'social'); u.searchParams.set('utm_content', utm ?? ''); return utm && u.hostname ? u.toString() : ''; } catch { return ''; }
  })();
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await api('/analytics/links', { body: { projectId, kind, ref: kind === 'ga4' ? undefined : ref, label } }); toast('ok', 'Linked', 'Fetching the first numbers…'); onDone(r.id); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Link a motion" subtitle="Tell us where this motion was published so its results can be fetched." wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !projectId || !connected || (kind !== 'ga4' && !ref.trim())} onClick={go}>{busy ? <span className="spinner" /> : 'Link'}</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Field label="Motion">
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>{motions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </Field>
        <Field label="Published on">
          <div className="row wrap" style={{ gap: 6 }}>{(Object.keys(KIND) as LinkRow['kind'][]).map((k) => <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND[k].label}</button>)}</div>
        </Field>
        {!connected ? (
          <div className="callout"><Icon name="alert" /><div className="grow">{PROVIDERS.find((p) => p.id === KIND[kind].provider)!.name} isn’t connected yet.</div><button className="btn" onClick={() => onConnect(KIND[kind].provider)}>Connect</button></div>
        ) : kind === 'ga4' ? (
          <div className="col" style={{ gap: 10 }}>
            <div className="note">Use this tagged link wherever the motion is posted (bio link, ad, email). GA4 counts visits that arrive through it.</div>
            <Field label="Your landing page"><input className="input" value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://yourbrand.com/spring" /></Field>
            <div className="copy-row"><input className="input" readOnly value={tagged} aria-label="Tagged link" /><button className="btn" disabled={!tagged} onClick={() => { navigator.clipboard.writeText(tagged); toast('ok', 'Link copied'); }}><Icon name="copy" />Copy</button></div>
            <div className="note">Tag: <span className="mono-s">utm_content={utm ?? '…'}</span>. Visits appear in GA4 within a day.</div>
          </div>
        ) : (
          <Field label={kind === 'instagram' ? 'Instagram media ID' : kind === 'facebook' ? 'Facebook post ID' : 'LinkedIn post link'}
            hint={kind === 'instagram' ? 'In Meta Business Suite open the post → “…” → copy ID. It’s a long number.' : kind === 'facebook' ? 'Looks like 123456789_987654321 (page ID _ post ID).' : 'Open the post’s “…” menu → Embed this post, and paste the address from the embed code (contains urn:li:share or urn:li:ugcPost).'}>
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={kind === 'linkedin' ? 'https://www.linkedin.com/embed/feed/update/urn:li:share:…' : '17895695668004550'} />
          </Field>
        )}
        <Field label="Note" hint="Optional — e.g. “Spring launch, paid boost”"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        {err && <div className="field-error" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}
