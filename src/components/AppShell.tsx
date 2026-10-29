import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Icon, Logo } from '../ui/Icon';
import { Avatar, Menu, Popover, spring, StatusBadge, Tip, toast } from '../ui/controls';
import { useCan, useSession, useWorkspace } from '../lib/session';
import { useExports, download } from '../lib/exports';
import { usePrefs } from '../lib/prefs';
import { api, errorMessage } from '../lib/api';
import type { PermissionKey } from '../../shared/permissions';
import type { AssistantAnswer } from '../../shared/assistant';

const NAV: { to: string; label: string; icon: string; perm?: PermissionKey; kbd: string }[] = [
  { to: '/', label: 'Home', icon: 'home', kbd: 'G H' },
  { to: '/create', label: 'Create', icon: 'wand', perm: 'scene.create', kbd: 'G C' },
  { to: '/brand', label: 'Brand kit', icon: 'brand', perm: 'brand.view', kbd: 'G B' },
  { to: '/library', label: 'Library', icon: 'library', perm: 'library.view', kbd: 'G L' },
  { to: '/analytics', label: 'Analytics', icon: 'chart', perm: 'analytics.view', kbd: 'G A' },
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
        <AdvancedMenu active={['/studio', '/campaigns', '/assets', '/integrations', '/explore', '/brand/advanced'].some((p) => loc.pathname.startsWith(p))} />
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
  const { workspaces, user, switchWorkspace, setBrand, brandId, logout } = useSession();
  const ws = useWorkspace();
  const [wsOpen, setWsOpen] = useState(false), [userOpen, setUserOpen] = useState(false);
  const wsRef = useRef<HTMLButtonElement>(null), userRef = useRef<HTMLButtonElement>(null);
  const brand = ws?.brands.find((b) => b.id === brandId);
  const nav = useNavigate();
  const { motion: motionPref, set: setMotion } = usePrefs();
  return (
    <header className="header">
      <button ref={wsRef} className="ws-switch" onClick={() => setWsOpen(true)} aria-label={`Workspace: ${ws?.name}. Switch workspace or brand`}>
        <span className="ws-mark">{ws?.name?.[0]}</span>
        <span style={{ fontWeight: 560 }}>{ws?.name}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      <span className="brand-pill" title="Active brand — tokens and governance apply from this brand">
        <span className="bdots"><span style={{ background: '#6b8cff' }} /><span style={{ background: '#ff6ad5' }} /><span style={{ background: '#16a3a0' }} /></span>
        {brand?.name ?? 'No brand'}
      </span>
      <span className="faint mono" style={{ fontSize: 10.5 }}>{ws?.roles.join(' · ')}</span>
      <div className="grow" />
      <button className="search-trigger" onClick={onSearch} aria-label="Search and ask (Command K)">
        <Icon name="search" size={14} /><span className="st-label grow" style={{ textAlign: 'left' }}>Search motion, ask the assistant…</span><span className="kbd">⌘K</span>
      </button>
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
          <div className="menu-sep" />
          <div className="eyebrow" style={{ padding: '8px 9px 6px' }}>Brand</div>
          {ws?.brands.map((b) => (
            <button key={b.id} className="menu-item" onClick={() => { setBrand(b.id); setWsOpen(false); }}>{b.name}{b.id === brandId && <span className="faint" style={{ marginLeft: 'auto' }}><Icon name="check" size={13} /></span>}</button>
          ))}
        </div>
      </Popover>
      <Popover anchor={userRef} open={userOpen} onClose={() => setUserOpen(false)} placement="bottom-end">
        <div className="menu" style={{ minWidth: 240 }}>
          <div style={{ padding: '8px 9px' }}><div style={{ fontWeight: 560 }}>{user?.name}</div><div className="faint">{user?.email}</div></div>
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
        <motion.aside aria-label="Export queue" className="panel" style={{ position: 'fixed', right: 16, top: 60, width: 380, maxHeight: '70vh', zIndex: 50, display: 'flex', flexDirection: 'column', boxShadow: '0 30px 80px rgba(0,0,0,.55)' }} initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={spring}>
          <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
            <div><div className="h3">Exports</div><div className="faint" style={{ fontSize: 11.5 }}>Rendered frame-by-frame in the background — keep working.</div></div>
            <button className="icon-btn" onClick={() => setTray(false)} aria-label="Close export queue"><Icon name="x" /></button>
          </div>
          <div className="scroll" style={{ padding: 6 }}>
            {!jobs.length && <div className="empty" style={{ padding: 28 }}><Icon name="film" /> No exports yet.</div>}
            {jobs.map((j) => (
              <div key={j.id} style={{ padding: '10px 10px', borderRadius: 8 }} className="col">
                <div className="row">
                  <span className="badge solid mono">{j.format}</span>
                  <span className="grow ellipsis" style={{ fontWeight: 520 }}>{j.source?.name ?? 'Motion'}</span>
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

/** ⌘K: navigation + assistant (natural-language template search, suggestions, explanations). */
function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [ans, setAns] = useState<AssistantAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const nav = useNavigate();
  const can = useCan();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setTimeout(() => input.current?.focus(), 20); setAns(null); setQ(''); } }, [open]);
  useEffect(() => {
    if (!open || !can('library.view')) return;
    api('/library').then((r) => setTemplates(Object.fromEntries(r.templates.map((t: any) => [t.id, t.name])))).catch(() => {});
  }, [open, can]);
  const routes = NAV.filter((n) => !n.perm || can(n.perm)).filter((n) => !q || n.label.toLowerCase().includes(q.toLowerCase()));
  const ask = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try { setAns(await api('/assistant', { body: { query: q } })); } catch (e) { setAns({ intent: 'help', text: errorMessage(e) }); } finally { setBusy(false); }
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" style={{ placeItems: 'start center', paddingTop: '12vh' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
          <motion.div role="dialog" aria-label="Command palette" className="modal" style={{ width: 'min(620px, 100%)' }} initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={spring}>
            <div className="row" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
              <Icon name="search" />
              <input ref={input} className="grow" style={{ border: 0, background: 'none', outline: 'none', fontSize: 15 }} placeholder="Go to… or ask: “calm template for a story”" value={q} onChange={(e) => { setQ(e.target.value); setAns(null); }} onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} aria-label="Search or ask" />
              {busy ? <div className="spinner" /> : <span className="kbd">↵ ask</span>}
            </div>
            <div className="scroll" style={{ maxHeight: 420, padding: 6 }}>
              {ans && (
                <div style={{ padding: '8px 10px 12px' }} className="col">
                  <div className="row"><Icon name="wand" size={14} /><span style={{ fontWeight: 540 }}>{ans.text}</span></div>
                  {ans.templates?.map((t) => (
                    <button key={t.id} className="menu-item" onClick={() => { onClose(); nav(`/play/${t.id}`); }}>
                      <Icon name="sparkles" />{templates[t.id] ?? t.id}<span className="faint">{t.why}</span>
                    </button>
                  ))}
                  {ans.notes?.map((n, i) => <div key={i} className="muted" style={{ paddingLeft: 22 }}>• {n}</div>)}
                  <div className="faint" style={{ fontSize: 11, paddingLeft: 22 }}>Local assistant · results limited to templates your team can use.</div>
                </div>
              )}
              {!ans && routes.map((r) => (
                <button key={r.to} className="menu-item" onClick={() => { onClose(); nav(r.to); }}><Icon name={r.icon} />{r.label}<span className="faint mono">{r.kbd}</span></button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Power tools kept out of the main navigation: the full editor, campaigns, asset library and publishing. */
function AdvancedMenu({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const can = useCan();
  const nav = useNavigate();
  const items = [
    can('scene.view') && { label: 'Motion Studio (full editor)', icon: 'studio', onSelect: () => nav('/studio') },
    can('campaign.view') && { label: 'Template campaigns', icon: 'campaigns', onSelect: () => nav('/campaigns') },
    can('asset.view') && { label: 'All assets', icon: 'assets', onSelect: () => nav('/assets') },
    can('integration.view') && { label: 'Publishing & integrations', icon: 'integrations', onSelect: () => nav('/integrations') },
    can('brand.view') && { label: 'Brand tokens', icon: 'brand', onSelect: () => nav('/brand/advanced') },
  ].filter(Boolean) as { label: string; icon: string; onSelect: () => void }[];
  if (!items.length) return null;
  return (
    <>
      <Tip label="Advanced" side="right">
        <button ref={ref} className="rail-item" aria-label="Advanced tools" aria-haspopup="menu" aria-expanded={open} aria-current={active ? 'page' : undefined} onClick={() => setOpen((v) => !v)}>
          {active && <motion.span layoutId="rail-ind" className="rail-ind" transition={spring} />}
          <Icon name="layers" />
        </button>
      </Tip>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement="top-start">
        <div style={{ padding: '8px 10px 4px' }} className="eyebrow">Advanced</div>
        <Menu items={items} onClose={() => setOpen(false)} />
      </Popover>
    </>
  );
}
