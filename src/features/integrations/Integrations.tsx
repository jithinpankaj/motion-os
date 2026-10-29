import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { useExports } from '../../lib/exports';
import { EmptyState, Field, Modal, StatusBadge, timeAgo, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';

const ICON: Record<string, string> = { social: 'campaigns', web: 'monitor', cms: 'link', package: 'folder' };

export default function Integrations() {
  const [d, setD] = useState<any>(null);
  const [connect, setConnect] = useState<any>(null);
  const [publish, setPublish] = useState<any>(null);
  const can = useCan();
  const load = () => api('/integrations').then(setD).catch((e) => toast('danger', 'Integrations unavailable', errorMessage(e)));
  useEffect(() => { load(); }, []);
  if (!d) return <div className="page-inner"><div className="skel" style={{ height: 300 }} /></div>;
  return (
    <div className="page-inner">
      <div className="eyebrow">Deliver</div>
      <h1 className="h1" style={{ marginTop: 8 }}>Integrations</h1>
      <p className="muted" style={{ margin: '6px 0 0', maxWidth: 620 }}>Every destination declares what it supports. When direct publishing isn't available, download an export package instead. A publication is only shown as successful when the destination confirms it.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginTop: 28 }}>
        {d.connectors.map((c: any) => {
          const conns = d.connections.filter((x: any) => x.provider === c.id);
          return (
            <div key={c.id} className="panel col" style={{ padding: 16, gap: 10 }}>
              <div className="row"><span className="empty-art" style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', border: '1px solid var(--line-2)' }}><Icon name={ICON[c.category]} /></span><div className="grow"><div className="h3">{c.name}</div><div className="faint" style={{ fontSize: 11.5 }}>{c.category}</div></div>{c.available ? <StatusBadge status="supported" label="available" /> : <StatusBadge status="unavailable" label="unavailable" />}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{c.description}</div>
              <div className="row wrap" style={{ gap: 4 }}>
                <span className={`badge ${c.capabilities.directPublish && c.available ? 'ok' : ''}`}>{c.capabilities.directPublish ? 'direct publish' : 'no direct publish'}</span>
                {c.capabilities.scheduling && <span className="badge">scheduling</span>}
                {c.capabilities.formats.map((f: string) => <span key={f} className="badge mono">{f}</span>)}
                {c.capabilities.maxDurationSec && <span className="badge">≤ {c.capabilities.maxDurationSec}s</span>}
              </div>
              {c.reason && <div className="field-hint">{c.reason}</div>}
              {conns.map((x: any) => (
                <div key={x.id} className="surface row" style={{ padding: '8px 10px', gap: 8 }}>
                  <StatusBadge status={x.status} /><span className="grow ellipsis" style={{ fontSize: 12 }}>{x.config.name ?? x.config.url}</span>
                  {x.status === 'connected' && can('integration.manage') && <button className="btn sm" onClick={() => setPublish(x)}>Publish…</button>}
                  {x.status === 'expired' && <span className="field-hint">Reconnect required</span>}
                  {can('integration.manage') && <button className="icon-btn sm" aria-label="Disconnect" onClick={async () => { await api(`/integrations/connections/${x.id}`, { method: 'DELETE' }); toast('ok', 'Disconnected'); load(); }}><Icon name="x" /></button>}
                </div>
              ))}
              {c.configurable && c.available && can('integration.manage') && <button className="btn" onClick={() => setConnect(c)}><Icon name="plus" size={13} />Connect</button>}
              {c.id === 'package' && <div className="field-hint">Use “Download package” from the export queue or a campaign’s export dialog.</div>}
              {c.id === 'website-embed' && <div className="field-hint">Open any template in the playground → Developer tab.</div>}
            </div>
          );
        })}
      </div>
      <div className="section">
        <div className="section-h"><h2 className="h2">Publication log</h2></div>
        {!d.publications.length ? <EmptyState icon="send" title="Nothing published yet">Connect a destination and publish a completed export.</EmptyState> : (
          <div className="panel" style={{ padding: 4 }}>
            {d.publications.map((p: any) => (
              <div key={p.id} className="row" style={{ padding: '9px 12px', gap: 10, borderBottom: '1px solid var(--line)', fontSize: 12.5 }}>
                <StatusBadge status={p.status} /><span className="grow">{p.name} <span className="faint mono">{p.format}</span> → {p.destination ?? p.provider}</span>
                {p.destination_ref && <span className="mono faint">{p.destination_ref}</span>}{p.error && <span className="field-error ellipsis" style={{ maxWidth: 360 }}>{p.error}</span>}<span className="faint">{timeAgo(p.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <ConnectDialog connector={connect} onClose={() => setConnect(null)} onDone={() => { setConnect(null); load(); }} />
      <PublishDialog conn={publish} onClose={() => setPublish(null)} onDone={() => { setPublish(null); load(); }} />
    </div>
  );
}

function ConnectDialog({ connector, onClose, onDone }: { connector: any; onClose: () => void; onDone: () => void }) {
  const [cfg, setCfg] = useState({ name: '', url: `${location.origin}/api/dev/receiver/accept`, secret: '' });
  const [err, setErr] = useState<string | null>(null);
  const go = async () => { try { await api(`/integrations/${connector.id}/connect`, { body: { config: cfg } }); toast('ok', `${connector.name} connected`); onDone(); } catch (e) { setErr(errorMessage(e)); } };
  return (
    <Modal open={!!connector} onClose={onClose} title={`Connect ${connector?.name}`} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={go}>Connect</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Display name"><input className="input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} placeholder="Marketing CMS" /></Field>
        <Field label="Endpoint URL" hint="Local test receivers: …/api/dev/receiver/accept or …/reject"><input className="input mono" value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} /></Field>
        <Field label="Signing secret" hint="Payloads carry an HMAC-SHA256 x-motion-signature header"><input className="input" type="password" value={cfg.secret} onChange={(e) => setCfg({ ...cfg, secret: e.target.value })} /></Field>
        {err && <div className="field-error">{err}</div>}
      </div>
    </Modal>
  );
}

function PublishDialog({ conn, onClose, onDone }: { conn: any; onClose: () => void; onDone: () => void }) {
  const jobs = useExports((s) => s.jobs.filter((j) => j.status === 'completed'));
  const [pick, setPick] = useState<string>('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setResult(null);
    try { const r = await api(`/integrations/connections/${conn.id}/publish`, { body: { exportJobId: pick } }); setResult(r); toast('ok', 'Destination confirmed the publication', r.ref); }
    catch (e: any) { setResult({ status: e.details?.status ?? 'failed', error: errorMessage(e) }); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={!!conn} onClose={() => { onClose(); if (result) onDone(); }} title={`Publish to ${conn?.config.name ?? conn?.provider}`} footer={<><button className="btn ghost" onClick={onClose}>Close</button><button className="btn primary" disabled={!pick || busy} onClick={go}>{busy ? <span className="spinner" /> : 'Publish'}</button></>}>
      <div className="col" style={{ gap: 10 }}>
        {!jobs.length && <div className="faint">No completed exports. Export something first.</div>}
        {jobs.map((j) => <label key={j.id} className="row surface" style={{ padding: '8px 10px', gap: 8 }}><input type="radio" name="job" checked={pick === j.id} onChange={() => setPick(j.id)} /><span className="grow">{j.result?.filename}</span><span className="faint mono">{j.format}</span></label>)}
        {result && (result.status === 'confirmed' ? <div className="badge ok">Confirmed by destination · {result.ref}</div> : <div className="field-error" role="alert">Not published — {result.error}</div>)}
      </div>
    </Modal>
  );
}
