import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Field, toast } from '../../ui/controls';
import { Logo } from '../../ui/Icon';
import { DEV_AUTO_LOGIN_OFF, useSession } from '../../lib/session';
import { MotionCanvas } from '../../components/MotionCanvas';
import { Clock } from '../../engine/clock';
import { nullResolver } from '../../engine/assets';
import { auroraFlow } from '../../../shared/scene/presets';
import { useReducedMotion } from '../../lib/prefs';

async function post(path: string, body: unknown) {
  const r = await fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data?.error?.message ?? 'Request failed'), { details: data?.error?.details });
  return data;
}

function Art() {
  const clock = useMemo(() => new Clock(), []);
  const reduced = useReducedMotion();
  const doc = useMemo(() => {
    const d = auroraFlow('scn_login');
    return { ...d, canvas: { ...d.canvas, width: 1200, height: 1200 }, layers: d.layers.filter((l) => l.type === 'gradient') };
  }, []);
  return (
    <div className="auth-art">
      <MotionCanvas doc={doc} clock={clock} assets={nullResolver} label="Aurora Flow motion preview" motion={reduced ? 'static' : 'full'} interactive={false} style={{ position: 'absolute', inset: 0 }} />
      <div className="auth-copy">
        <div className="eyebrow" style={{ color: 'rgba(255,255,255,.7)' }}>Motion OS</div>
        <h1 className="display" style={{ marginTop: 12, maxWidth: 560 }}>Create once.<br />Adapt everywhere.<br /><span style={{ opacity: 0.55 }}>Stay on brand.</span></h1>
      </div>
    </div>
  );
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [form, setForm] = useState({ email: '', password: '', name: '', workspaceName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useSession((s) => s.load);
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(mode === 'login' ? '/auth/login' : '/auth/register', mode === 'login' ? { email: form.email, password: form.password } : { ...form, inviteToken: sp.get('invite') ?? undefined });
      await load();
      nav(sp.get('next') || '/', { replace: true });
    } catch (err: any) {
      setError(err.details?.[0]?.message ? `${err.details[0].path}: ${err.details[0].message}` : err.message);
    } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <Art />
      <div className="auth-form">
        <form onSubmit={submit} noValidate aria-describedby={error ? 'auth-error' : undefined}>
          <Logo size={30} />
          <div>
            <h1 className="h1">{mode === 'login' ? 'Sign in' : 'Create your studio'}</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>{mode === 'login' ? 'Welcome back to your motion system.' : 'A workspace, brand and launch templates are set up for you.'}</p>
          </div>
          {mode === 'register' && <Field label="Name" htmlFor="name"><input id="name" className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>}
          <Field label="Email" htmlFor="email"><input id="email" className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required aria-invalid={!!error} /></Field>
          <Field label="Password" htmlFor="password" hint={mode === 'register' ? 'At least 10 characters' : undefined}>
            <input id="password" className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required aria-invalid={!!error} />
          </Field>
          {mode === 'register' && !sp.get('invite') && <Field label="Workspace name" htmlFor="wsn" hint="Optional"><input id="wsn" className="input" value={form.workspaceName} onChange={(e) => setForm({ ...form, workspaceName: e.target.value })} /></Field>}
          {error && <div id="auth-error" className="field-error" role="alert">{error}</div>}
          <button className="btn primary lg" disabled={busy}>{busy ? <span className="spinner" /> : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          <div className="row between muted" style={{ fontSize: 12.5 }}>
            {mode === 'login' ? <Link to="/register">Create an account</Link> : <Link to="/login">I have an account</Link>}
            <Link to="/reset">Forgot password?</Link>
          </div>
          {mode === 'login' && import.meta.env.DEV && <DevAccounts next={sp.get('next') || '/'} />}
        </form>
      </div>
    </div>
  );
}

// Development only: one-click sign-in as any seeded demo account (hidden when the server disables it).
function DevAccounts({ next }: { next: string }) {
  const [accounts, setAccounts] = useState<{ email: string; name: string; roles: string[] }[]>([]);
  const load = useSession((s) => s.load);
  const nav = useNavigate();
  useEffect(() => { fetch('/api/dev/accounts').then((r) => (r.ok ? r.json() : null)).then((r) => r && setAccounts(r.accounts)).catch(() => {}); }, []);
  if (!accounts.length) return null;
  const go = async (email: string) => {
    try { await post('/auth/dev-login', { email }); } catch (err: any) { toast('danger', 'Could not sign in', err.message); return; }
    try { sessionStorage.removeItem(DEV_AUTO_LOGIN_OFF); } catch {}
    await load();
    nav(next, { replace: true });
  };
  return (
    <div className="col" style={{ gap: 8, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <div className="eyebrow">Local development · continue as</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {accounts.map((a) => <button key={a.email} type="button" className="chip" onClick={() => go(a.email)}>{a.name.split(' ')[0]} <span className="faint" style={{ fontSize: 11 }}>{a.roles.join(', ')}</span></button>)}
      </div>
    </div>
  );
}

export function ResetPage() {
  const [sp] = useSearchParams();
  const token = sp.get('token');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await post('/auth/reset/request', { email });
      setMsg(r.message);
      const mb = await fetch(`/api/dev/mailbox?email=${encodeURIComponent(email)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (mb?.messages?.[0]) setDevLink(mb.messages[0].body);
    } catch (err: any) { setError(err.message); }
  };
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try { await post('/auth/reset/confirm', { token, password: pw }); toast('ok', 'Password updated', 'All other sessions were signed out.'); nav('/login'); }
    catch (err: any) { setError(err.details?.[0]?.message ?? err.message); }
  };
  return (
    <div className="auth">
      <Art />
      <div className="auth-form">
        {token ? (
          <form onSubmit={confirm}>
            <h1 className="h1">Choose a new password</h1>
            <Field label="New password" htmlFor="npw" hint="At least 10 characters" error={error}><input id="npw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!error} /></Field>
            <button className="btn primary lg">Update password</button>
          </form>
        ) : (
          <form onSubmit={request}>
            <h1 className="h1">Reset password</h1>
            <Field label="Email" htmlFor="remail" error={error}><input id="remail" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <button className="btn primary lg">Send reset link</button>
            {msg && <div className="muted" role="status">{msg}</div>}
            {devLink && <div className="surface" style={{ padding: 12 }}><div className="eyebrow">Development mailbox</div><div className="muted" style={{ margin: '6px 0' }}>Email delivery is not configured here; the message was captured locally.</div><Link className="btn sm" to={devLink}>Open reset link</Link></div>}
            <Link to="/login" className="muted">Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  );
}

export function InvitePage() {
  const { token } = useParams();
  const [info, setInfo] = useState<{ email: string; workspace: string; roles: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const user = useSession((s) => s.user);
  const load = useSession((s) => s.load);
  const nav = useNavigate();
  useEffect(() => { fetch(`/api/invitations/${token}`).then(async (r) => { const d = await r.json(); r.ok ? setInfo(d) : setError(d.error?.message); }); }, [token]);
  const accept = async () => {
    try { await post(`/invitations/${token}/accept`, {}); await load(); toast('ok', `Joined ${info?.workspace}`); nav('/'); } catch (e: any) { setError(e.message); }
  };
  return (
    <div className="auth-form" style={{ height: '100%' }}>
      <div className="panel col" style={{ padding: 28, width: 'min(420px, 100%)', gap: 14 }}>
        <Logo size={28} />
        {error && <div className="field-error" role="alert">{error}</div>}
        {info && (
          <>
            <h1 className="h2">Join {info.workspace}</h1>
            <div className="muted">Invited as <b>{info.email}</b> with role{info.roles.length > 1 ? 's' : ''} {info.roles.join(', ')}.</div>
            {user ? <button className="btn primary" onClick={accept}>Accept invitation</button> : (
              <div className="row"><Link className="btn primary" to={`/register?invite=${token}`}>Create account</Link><Link className="btn" to={`/login?next=/invite/${token}`}>Sign in</Link></div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
