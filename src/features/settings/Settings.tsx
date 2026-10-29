import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { useCan, useSession } from '../../lib/session';
import { Avatar, EmptyState, Field, Modal, Tabs, timeAgo, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { Link } from 'react-router-dom';
import { FigmaConnect } from '../create/Create';

type Tab = 'profile' | 'members' | 'roles' | 'connections' | 'audit';

export default function Settings() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('profile');
  const tabs = [{ value: 'profile' as Tab, label: 'Profile & sessions' }, ...(can('workspace.view') ? [{ value: 'members' as Tab, label: 'Members & teams' }] : []), ...(can('roles.manage') ? [{ value: 'roles' as Tab, label: 'Roles & permissions' }] : []), ...(can('asset.view') ? [{ value: 'connections' as Tab, label: 'Connections' }] : []), ...(can('audit.view') ? [{ value: 'audit' as Tab, label: 'Audit log' }] : [])];
  return (
    <div className="page-inner">
      <h1 className="h1">Settings</h1>
      <div style={{ marginTop: 18 }}><Tabs label="Settings sections" value={tab} onChange={setTab} tabs={tabs} /></div>
      <div style={{ marginTop: 24 }}>
        {tab === 'profile' && <Profile />}
        {tab === 'members' && <Members />}
        {tab === 'roles' && <Roles />}
        {tab === 'connections' && <Connections />}
        {tab === 'audit' && <Audit />}
      </div>
    </div>
  );
}

function Profile() {
  const user = useSession((s) => s.user);
  const [sessions, setSessions] = useState<any[]>([]);
  const [pw, setPw] = useState({ current: '', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const load = () => api('/auth/sessions', { noWorkspace: true }).then((r) => setSessions(r.sessions)).catch(() => {});
  useEffect(() => { load(); }, []);
  const change = async () => { setErr(null); try { await api('/auth/password', { body: pw, noWorkspace: true }); toast('ok', 'Password changed', 'Other sessions were signed out.'); setPw({ current: '', password: '' }); load(); } catch (e) { setErr(errorMessage(e)); } };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
      <section className="col" style={{ gap: 12 }}>
        <div className="row"><Avatar name={user?.name} /><div><div className="h3">{user?.name}</div><div className="faint">{user?.email}</div></div></div>
        <div className="h3" style={{ marginTop: 12 }}>Change password</div>
        <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New password" hint="At least 10 characters" error={err}><input className="input" type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={change}>Update password</button>
      </section>
      <section className="col" style={{ gap: 8 }}>
        <div className="h3">Active sessions</div>
        {sessions.map((s) => (
          <div key={s.id} className="surface row" style={{ padding: '9px 12px', gap: 10 }}>
            <Icon name="monitor" /><div className="grow"><div className="ellipsis" style={{ fontSize: 12.5 }}>{s.user_agent?.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/)?.[0] ?? 'Browser'} · {s.ip}</div><div className="faint" style={{ fontSize: 11.5 }}>Last active {timeAgo(s.last_seen_at)}</div></div>
            {s.current ? <span className="badge ok">this device</span> : <button className="btn sm" onClick={async () => { await api(`/auth/sessions/${s.id}`, { method: 'DELETE', noWorkspace: true }); load(); }}>Revoke</button>}
          </div>
        ))}
      </section>
    </div>
  );
}

function Members() {
  const [d, setD] = useState<any>(null);
  const [invite, setInvite] = useState(false);
  const can = useCan();
  const me = useSession((s) => s.user);
  const load = () => api('/workspace').then(setD).catch((e) => toast('danger', 'Members unavailable', errorMessage(e)));
  useEffect(() => { load(); }, []);
  if (!d) return <div className="skel" style={{ height: 200 }} />;
  const manage = can('members.manage');
  const setRoles = async (uid: string, roles: string[]) => { if (!roles.length) return; try { await api(`/workspace/members/${uid}/roles`, { method: 'PUT', body: { roles } }); toast('ok', 'Roles updated', 'Takes effect immediately, including in open editors.'); load(); } catch (e) { toast('danger', 'Not updated', errorMessage(e)); } };
  const setTeams = async (uid: string, teams: string[]) => { await api(`/workspace/members/${uid}/teams`, { method: 'PUT', body: { teams } }).catch((e) => toast('danger', 'Not updated', errorMessage(e))); load(); };
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="row between"><div className="h2">{d.members.length} members</div>{manage && <button className="btn primary" onClick={() => setInvite(true)}><Icon name="plus" size={13} />Invite</button>}</div>
      <div className="panel" style={{ padding: 4 }}>
        {d.members.map((m: any) => (
          <div key={m.id} className="row wrap" style={{ padding: '10px 12px', gap: 12, borderBottom: '1px solid var(--line)' }}>
            <Avatar name={m.name} />
            <div style={{ width: 200 }}><div style={{ fontWeight: 540 }}>{m.name}{m.id === me?.id && <span className="faint"> (you)</span>}</div><div className="faint" style={{ fontSize: 11.5 }}>{m.email}</div></div>
            <div className="row wrap grow" style={{ gap: 4 }} aria-label={`Roles for ${m.name}`}>
              {d.roles.map((r: any) => <button key={r.id} className="chip" style={{ height: 22, fontSize: 11 }} aria-pressed={m.roles.includes(r.key)} disabled={!manage} onClick={() => setRoles(m.id, m.roles.includes(r.key) ? m.roles.filter((x: string) => x !== r.key) : [...m.roles, r.key])}>{r.name}</button>)}
            </div>
            <div className="row wrap" style={{ gap: 4 }} aria-label={`Teams for ${m.name}`}>
              {d.teams.map((t: any) => <button key={t.id} className="chip" style={{ height: 22, fontSize: 11 }} aria-pressed={m.teams.includes(t.id)} disabled={!manage} onClick={() => setTeams(m.id, m.teams.includes(t.id) ? m.teams.filter((x: string) => x !== t.id) : [...m.teams, t.id])}>{t.name}</button>)}
            </div>
            {manage && m.id !== me?.id && <button className="icon-btn sm" aria-label={`Remove ${m.name}`} onClick={async () => { if (!confirm(`Remove ${m.name} from the workspace?`)) return; try { await api(`/workspace/members/${m.id}`, { method: 'DELETE' }); load(); } catch (e) { toast('danger', 'Not removed', errorMessage(e)); } }}><Icon name="trash" /></button>}
          </div>
        ))}
      </div>
      {d.invitations.length > 0 && <div className="col" style={{ gap: 6 }}><span className="eyebrow">Pending invitations</span>{d.invitations.map((i: any) => <div key={i.id} className="surface row" style={{ padding: '8px 12px' }}><span className="grow">{i.email}</span><span className="faint">{i.role_keys.join(', ')}</span><button className="btn sm ghost" onClick={async () => { await api(`/workspace/invitations/${i.id}`, { method: 'DELETE' }); load(); }}>Revoke</button></div>)}</div>}
      <InviteDialog open={invite} roles={d.roles} teams={d.teams} onClose={() => setInvite(false)} onDone={load} />
    </div>
  );
}

function InviteDialog({ open, roles, teams, onClose, onDone }: { open: boolean; roles: any[]; teams: any[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ email: '', roles: ['marketing'], teams: [] as string[] });
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => { setErr(null); try { const r = await api('/workspace/invitations', { body: f }); setLink(`${location.origin}${r.link}`); onDone(); } catch (e) { setErr(errorMessage(e)); } };
  return (
    <Modal open={open} onClose={() => { setLink(null); onClose(); }} title="Invite to workspace" footer={link ? <button className="btn primary" onClick={() => { setLink(null); onClose(); }}>Done</button> : <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={go} disabled={!f.email || !f.roles.length}>Create invitation</button></>}>
      {link ? (
        <div className="col" style={{ gap: 10 }}><div className="muted">Email delivery isn't configured in this environment. Share this link (valid 7 days):</div><div className="row"><input className="input mono" readOnly value={link} aria-label="Invitation link" /><button className="btn" onClick={() => { navigator.clipboard.writeText(link); toast('ok', 'Link copied'); }}><Icon name="copy" size={13} /></button></div></div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          <Field label="Email" error={err}><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Roles"><div className="row wrap" style={{ gap: 5 }}>{roles.map((r) => <button key={r.key} className="chip" aria-pressed={f.roles.includes(r.key)} onClick={() => setF({ ...f, roles: f.roles.includes(r.key) ? f.roles.filter((x) => x !== r.key) : [...f.roles, r.key] })}>{r.name}</button>)}</div></Field>
          <Field label="Teams"><div className="row wrap" style={{ gap: 5 }}>{teams.map((t) => <button key={t.id} className="chip" aria-pressed={f.teams.includes(t.id)} onClick={() => setF({ ...f, teams: f.teams.includes(t.id) ? f.teams.filter((x) => x !== t.id) : [...f.teams, t.id] })}>{t.name}</button>)}</div></Field>
        </div>
      )}
    </Modal>
  );
}

function Roles() {
  const [d, setD] = useState<any>(null);
  const load = () => api('/workspace').then(setD).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!d) return <div className="skel" style={{ height: 300 }} />;
  const perms = Object.entries(d.permissionCatalog as Record<string, string>);
  const toggle = async (role: any, p: string) => {
    const next = role.permissions.includes(p) ? role.permissions.filter((x: string) => x !== p) : [...role.permissions, p];
    try { await api(`/workspace/roles/${role.id}/permissions`, { method: 'PUT', body: { permissions: next } }); load(); } catch (e) { toast('danger', 'Not changed', errorMessage(e)); }
  };
  return (
    <div className="scroll panel" style={{ padding: 0 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead><tr><th style={{ textAlign: 'left', padding: '10px 12px', position: 'sticky', left: 0, background: 'var(--bg-1)' }}>Permission</th>{d.roles.map((r: any) => <th key={r.id} style={{ padding: '10px 8px', fontWeight: 560 }} title={r.description}>{r.name}</th>)}</tr></thead>
        <tbody>
          {perms.map(([k, desc]) => (
            <tr key={k} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '6px 12px' }}><div className="mono" style={{ fontSize: 11 }}>{k}</div><div className="faint" style={{ fontSize: 11 }}>{desc}</div></td>
              {d.roles.map((r: any) => <td key={r.id} style={{ textAlign: 'center' }}><input type="checkbox" aria-label={`${r.name}: ${k}`} checked={r.permissions.includes(k)} disabled={r.key === 'owner'} onChange={() => toggle(r, k)} style={{ accentColor: 'var(--accent)' }} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Audit() {
  const [events, setEvents] = useState<any[] | null>(null);
  useEffect(() => { api('/audit').then((r) => setEvents(r.events)).catch(() => setEvents([])); }, []);
  if (!events) return <div className="skel" style={{ height: 300 }} />;
  if (!events.length) return <EmptyState icon="shield" title="No audit events yet" />;
  return (
    <div className="panel" style={{ padding: 4 }}>
      {events.map((e) => (
        <div key={e.id} className="row" style={{ padding: '8px 12px', gap: 12, borderBottom: '1px solid var(--line)', fontSize: 12.5 }}>
          <span className="mono faint" style={{ width: 130 }}>{new Date(e.created_at).toLocaleString()}</span>
          <span className="badge mono">{e.action}</span>
          <span style={{ width: 120 }}>{e.actor ?? 'system'}</span>
          <span className="grow faint ellipsis mono" style={{ fontSize: 11 }}>{e.subject_type}:{e.subject_id} {JSON.stringify(e.data)}</span>
        </div>
      ))}
    </div>
  );
}

function Connections() {
  const can = useCan();
  const [figma, setFigma] = useState<any>(undefined);
  const [editing, setEditing] = useState(false);
  const load = () => api('/connections/figma').then((r) => setFigma(r.connection)).catch(() => setFigma(null));
  useEffect(() => { load(); }, []);
  return (
    <div className="col" style={{ gap: 14, maxWidth: 720 }}>
      <div className="panel" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: '#1e1e1e', display: 'grid', placeItems: 'center', fontWeight: 700 }}>F</div>
          <div className="grow">
            <div style={{ fontWeight: 580 }}>Figma</div>
            <div className="faint" style={{ fontSize: 12 }}>{figma === undefined ? 'Checking…' : figma ? (figma.status === 'connected' ? `Connected as ${figma.account} · token ${figma.tokenHint}` : `Needs attention: ${figma.error ?? figma.status}`) : 'Not connected — used to import frames in Create'}</div>
          </div>
          {can('integration.manage') && figma && <button className="btn sm ghost" onClick={async () => { await api('/connections/figma', { method: 'DELETE' }); toast('ok', 'Figma disconnected'); load(); }}>Disconnect</button>}
          {can('integration.manage') && <button className="btn sm" onClick={() => setEditing((v) => !v)}>{figma ? 'Replace token' : 'Connect'}</button>}
        </div>
        {editing && <FigmaConnect onConnected={() => { setEditing(false); load(); }} />}
      </div>
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ fontWeight: 580 }}>Analytics accounts</div>
        <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Google Analytics 4, Meta and LinkedIn are connected from the Analytics page.</div>
        <Link to="/analytics" className="btn sm" style={{ marginTop: 10 }}>Open Analytics</Link>
      </div>
    </div>
  );
}
