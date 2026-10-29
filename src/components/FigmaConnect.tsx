import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useCan } from '../lib/session';
import { toast } from '../ui/controls';

/** One-time Figma personal access token, used to import frames as layered designs. */
export function FigmaConnect({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const can = useCan();
  if (!can('integration.manage')) return <div className="note warn" style={{ marginTop: 12 }}>Figma isn’t connected for this workspace. Ask an admin to add a Figma access token in Settings → Connections.</div>;
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await api('/connections/figma', { method: 'PUT', body: { token } }); toast('ok', 'Figma connected', `Signed in as ${r.account}`); onConnected(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="col" style={{ gap: 10, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <div style={{ fontWeight: 500 }}>Connect Figma once for your workspace</div>
      <ol className="howto">
        <li>In Figma, open <b>Settings → Security → Personal access tokens</b>.</li>
        <li>Generate a token with <code>File content: Read-only</code>.</li>
        <li>Paste it here. It’s stored encrypted and only used to read frames you import.</li>
      </ol>
      <div className="row"><input className="input grow" type="password" placeholder="figd_…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Figma access token" /><button className="btn primary" disabled={busy || token.trim().length < 20} onClick={go}>{busy ? <span className="spinner" /> : 'Connect'}</button></div>
      {err && <div className="field-error" role="alert">{err}</div>}
    </div>
  );
}
