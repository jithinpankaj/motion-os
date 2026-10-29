import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Icon, Logo } from '../ui/Icon';
import { Avatar, Menu, Popover, spring, StatusBadge, Tip, toast } from '../ui/controls';
import { useCan, useSession, useWorkspace } from '../lib/session';
import { useExports, download } from '../lib/exports';
import { usePrefs } from '../lib/prefs';
import { useTheme, type ThemePref } from '../lib/theme';
import { api, errorMessage } from '../lib/api';
import type { PermissionKey } from '../../shared/permissions';

const NAV: { to: string; label: string; icon: string; perm?: PermissionKey; kbd: string }[] = [
  { to: '/', label: 'Home', icon: 'home', kbd: 'G H' },
  { to: '/community', label: 'Community', icon: 'globe', kbd: 'G C' },
  { to: '/learn', label: 'Learn', icon: 'library', kbd: 'G L' },
];

export function AppShell({ children, bare }: { children: ReactNode; bare?: boolean }) {
  const can = useCan();
  const loc = useLocation();
  const nav = useNavigate();
  const [palette, setPalette] = useState(false);
  const items = NAV.filter((n) => !n.perm || can(n.perm));
  const active = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));

  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (typing) return;
      if (e.key === 'g') { g = performance.now(); return; }
      if (performance.now() - g < 800) {
        const hit = NAV.find((n) => n.kbd.endsWith(e.key.toUpperCase()) && (!n.perm || can(n.perm)));
        if (hit) { nav(hit.to); g = 0; }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [can, nav]);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <NavLink to="/" className="rail-logo" aria-label="Motion OS home"><Logo size={26} /></NavLink>
        <LayoutGroup id="rail">
          {items.map((n) => (
            <Tip key={n.to} label={n.label} kbd={n.kbd} side="right">
              <NavLink to={n.to} className="rail-item" aria-current={active(n.to) ? 'page' : undefined}>
                {active(n.to) && <motion.span layoutId="rail-ind" className="rail-ind" transition={spring} />}
                <Icon name={n.icon} />
              </NavLink>
            </Tip>
          ))}
        </LayoutGroup>
        <div className="rail-spacer" />
        <Tip label="Settings" side="right">
          <NavLink to="/settings" className="rail-item" aria-current={active('/settings') ? 'page' : undefined}>
            {active('/settings') && <motion.span layoutId="rail-ind" className="rail-ind" transition={spring} />}
            <Icon name="settings" />
          </NavLink>
        </Tip>
      </nav>
      <div className="main" style={bare ? { gridTemplateRows: '1fr' } : undefined}>
        {!bare && <Header onSearch={() => setPalette(true)} />}
        <motion.main key={loc.pathname.split('/')[1] || 'home'} className="page" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }} style={{ position: 'relative' }}>
          {children}
        </motion.main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <ExportTray />
      <SessionNotice />
    </div>
  );
}

function Header({ onSearch }: { onSearch: () => void }) {
  const { workspaces, user, switchWorkspace, logout } = useSession();
  const ws = useWorkspace();
  const [wsOpen, setWsOpen] = useState(false), [userOpen, setUserOpen] = useState(false);
  const wsRef = useRef<HTMLButtonElement>(null), userRef = useRef<HTMLButtonElement>(null);
  const nav = useNavigate();
  const { motion: motionPref, set: setMotion } = usePrefs();
  return (
    <header className="header">
      <button ref={wsRef} className="ws-switch" onClick={() => setWsOpen(true)} aria-label={`Workspace: ${ws?.name}. Switch workspace`}>
        <span className="ws-mark">{ws?.name?.[0]}</span>
        <span style={{ fontWeight: 500 }}>{ws?.name}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      <span className="faint mono" style={{ fontSize: 10.5 }}>{ws?.roles.join(' · ')}</span>
      <div className="grow" />
      <button className="search-trigger" onClick={onSearch} aria-label="Search files (Command K)">
        <Icon name="search" size={14} /><span className="st-label grow" style={{ textAlign: 'left' }}>Search your files…</span><span className="kbd">⌘K</span>
      </button>
      <ThemeSwitch />
      <ExportTrayButton />
      <button ref={userRef} className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setUserOpen(true)} aria-label="Account menu"><Avatar name={user?.name} /></button>
      <Popover anchor={wsRef} open={wsOpen} onClose={() => setWsOpen(false)}>
        <div className="menu" style={{ minWidth: 260 }}>
          <div className="eyebrow" style={{ padding: '8px 9px 6px' }}>Workspaces</div>
          {workspaces.map((w) => (
            <button key={w.id} className="menu-item" onClick={() => { switchWorkspace(w.id); setWsOpen(false); nav('/'); }}>
              <span className="ws-mark" style={{ width: 18, height: 18, fontSize: 10 }}>{w.name[0]}</span>{w.name}
              {w.id === ws?.id && <span className="faint" style={{ marginLeft: 'auto' }}><Icon name="check" size={13} /></span>}
            </button>
          ))}
        </div>
      </Popover>
      <Popover anchor={userRef} open={userOpen} onClose={() => setUserOpen(false)} placement="bottom-end">
        <div className="menu" style={{ minWidth: 240 }}>
          <div style={{ padding: '8px 9px' }}><div style={{ fontWeight: 500 }}>{user?.name}</div><div className="faint">{user?.email}</div></div>
          <div className="menu-sep" />
          <div className="eyebrow" style={{ padding: '8px 9px 6px' }}>Motion preference</div>
          {(['system', 'reduce', 'full'] as const).map((m) => (
            <button key={m} className="menu-item" onClick={() => setMotion(m)}>{m === 'system' ? 'Follow system' : m === 'reduce' ? 'Reduce motion' : 'Full motion'}{motionPref === m && <span className="faint" style={{ marginLeft: 'auto' }}><Icon name="check" size={13} /></span>}</button>
          ))}
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { setUserOpen(false); nav('/settings'); }}><Icon name="settings" />Settings</button>
          <button className="menu-item" onClick={() => logout()}><Icon name="logout" />Sign out</button>
        </div>
      </Popover>
    </header>
  );
}

const THEMES: { value: ThemePref; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'Match system', icon: 'monitor' },
];

/** Light / Dark / System. Changes the interface only — never the artwork. */
export function ThemeSwitch() {
  const { pref, set } = useTheme();
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Interface theme">
      {THEMES.map((t) => (
        <Tip key={t.value} label={t.label}>
          <button role="radio" aria-checked={pref === t.value} aria-label={`${t.label} theme`} onClick={() => set(t.value)}><Icon name={t.icon} /></button>
        </Tip>
      ))}
    </div>
  );
}

function ExportTrayButton() {
  const { jobs, setTray, trayOpen } = useExports();
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'processing');
  const p = active.length ? active.reduce((a, j) => a + j.progress, 0) / active.length : 0;
  return (
    <Tip label="Export queue">
      <button className="icon-btn" style={{ width: 32, height: 32, position: 'relative' }} onClick={() => setTray(!trayOpen)} aria-label={`Export queue, ${active.length} active`}>
        <Icon name="download" />
        {active.length > 0 && (
          <svg width="32" height="32" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} aria-hidden>
            <circle cx="16" cy="16" r="14" fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
            <circle cx="16" cy="16" r="14" fill="none" stroke="var(--text)" strokeWidth="1.5" strokeDasharray={`${p * 88} 88`} style={{ transition: 'stroke-dasharray .3s' }} />
          </svg>
        )}
      </button>
    </Tip>
  );
}

export function ExportTray() {
  const { jobs, trayOpen, setTray, cancel, retry } = useExports();
  return (
    <AnimatePresence>
      {trayOpen && (
        <motion.aside aria-label="Export queue" className="panel" style={{ position: 'fixed', right: 16, top: 64, width: 380, maxHeight: '70vh', zIndex: 50, display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-xl)' }} initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={spring}>
          <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
            <div><div className="h3">Exports</div><div className="faint" style={{ fontSize: 11.5 }}>Rendered frame-by-frame in the background. Keep working.</div></div>
            <button className="icon-btn" onClick={() => setTray(false)} aria-label="Close export queue"><Icon name="x" /></button>
          </div>
          <div className="scroll" style={{ padding: 6 }}>
            {!jobs.length && <div className="empty" style={{ padding: 28 }}><Icon name="film" /> No exports yet.</div>}
            {jobs.map((j) => (
              <div key={j.id} style={{ padding: '10px 10px', borderRadius: 8 }} className="col">
                <div className="row">
                  <span className="badge solid mono">{j.format}</span>
                  <span className="grow ellipsis" style={{ fontWeight: 500 }}>{j.source?.name ?? 'Motion'}</span>
                  <StatusBadge status={j.status} />
                </div>
                <div className="row faint mono" style={{ fontSize: 10.5 }}>
                  {j.settings?.width && <span>{j.settings.width}×{j.settings.height}</span>}
                  {j.settings?.fps && <span>{j.settings.fps}fps · {j.settings.duration}s{j.settings.loops > 1 ? ` ×${j.settings.loops}` : ''}</span>}
                  {j.settings?.time !== undefined && <span>frame @ {j.settings.time}s</span>}
                  {j.source?.channel && <span>{j.source.channel}</span>}
                </div>
                {(j.status === 'processing' || j.status === 'queued') && <div className="progress"><div style={{ width: `${Math.round(j.progress * 100)}%` }} /></div>}
                {j.status === 'failed' && <div className="field-error">{j.error?.message}</div>}
                <div className="row" style={{ gap: 6 }}>
                  {j.status === 'completed' && <button className="btn sm" onClick={() => download(j)}><Icon name="download" size={13} />Download · {((j.result?.bytes ?? 0) / 1e6).toFixed(2)} MB</button>}
                  {(j.status === 'processing' || j.status === 'queued') && <button className="btn sm ghost" onClick={() => cancel(j.id)}>Cancel</button>}
                  {(j.status === 'failed' || j.status === 'cancelled') && <button className="btn sm" onClick={() => retry(j.id)}><Icon name="refresh" size={13} />Retry</button>}
                  {(j.status === 'processing' || j.status === 'queued') && <span className="faint mono" style={{ marginLeft: 'auto' }}>{Math.round(j.progress * 100)}%</span>}
                </div>
              </div>
            ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function SessionNotice() {
  const notice = useSession((s) => s.notice);
  useEffect(() => { if (notice) { toast('warn', notice); useSession.setState({ notice: null }); } }, [notice]);
  return null;
}

/** ⌘K: jump to a place or open one of your files. */
function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const nav = useNavigate();
  const can = useCan();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setTimeout(() => input.current?.focus(), 20); setQ(''); } }, [open]);
  useEffect(() => {
    if (!open || !can('scene.view')) return;
    api('/projects').then((r) => setFiles(r.projects.map((p: any) => ({ id: p.id, name: p.name })))).catch((e) => toast('danger', 'Couldn’t load files', errorMessage(e)));
  }, [open, can]);
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const routes = NAV.filter((n) => match(n.label));
  const found = files.filter((f) => match(f.name)).slice(0, 8);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" style={{ placeItems: 'start center', paddingTop: '12vh' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div role="dialog" aria-label="Command palette" className="modal" style={{ width: 'min(560px, 100%)' }} initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
            <div className="row" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
              <Icon name="search" />
              <input ref={input} className="grow" style={{ border: 0, background: 'none', outline: 'none', fontSize: 15 }} placeholder="Go to… or find a file" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) { onClose(); nav(`/edit/${found[0].id}`); } }} />
            </div>
            <div className="scroll" style={{ maxHeight: 420, padding: 6 }}>
              {routes.map((r) => <button key={r.to} className="menu-item" onClick={() => { onClose(); nav(r.to); }}><Icon name={r.icon as any} />{r.label}<span className="faint mono">{r.kbd}</span></button>)}
              {found.length > 0 && <div className="eyebrow" style={{ padding: '10px 9px 4px' }}>Files</div>}
              {found.map((f) => <button key={f.id} className="menu-item" onClick={() => { onClose(); nav(`/edit/${f.id}`); }}><Icon name="layers" />{f.name}</button>)}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
