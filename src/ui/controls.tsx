import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { create } from 'zustand';
import { Icon } from './Icon';

export const spring = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.8 };
export const softSpring = { type: 'spring' as const, stiffness: 220, damping: 28 };

/* ─── Tooltip ─────────────────────────────────────────────────────────────── */
let warmUntil = 0;
export function Tip({ label, kbd, children, side = 'bottom' }: { label: ReactNode; kbd?: string; children: ReactElement<any>; side?: 'top' | 'bottom' | 'right' | 'left' }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<number>(0);
  const show = (el: HTMLElement) => {
    clearTimeout(timer.current);
    const delay = performance.now() < warmUntil ? 0 : 450;
    timer.current = window.setTimeout(() => setRect(el.getBoundingClientRect()), delay);
  };
  const hide = () => { clearTimeout(timer.current); if (rect) warmUntil = performance.now() + 300; setRect(null); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const p = children.props as any;
  const child = cloneElement(children, {
    onPointerEnter: (e: any) => { p.onPointerEnter?.(e); show(e.currentTarget); },
    onPointerLeave: (e: any) => { p.onPointerLeave?.(e); hide(); },
    onFocus: (e: any) => { p.onFocus?.(e); if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget); },
    onBlur: (e: any) => { p.onBlur?.(e); hide(); },
    onPointerDown: (e: any) => { p.onPointerDown?.(e); hide(); },
    'aria-label': p['aria-label'] ?? (typeof label === 'string' ? label : undefined),
  });
  let style: React.CSSProperties = {};
  if (rect) {
    if (side === 'bottom') style = { left: rect.left + rect.width / 2, top: rect.bottom + 8, translate: '-50% 0' };
    if (side === 'top') style = { left: rect.left + rect.width / 2, top: rect.top - 8, translate: '-50% -100%' };
    if (side === 'right') style = { left: rect.right + 10, top: rect.top + rect.height / 2, translate: '0 -50%' };
    if (side === 'left') style = { left: rect.left - 10, top: rect.top + rect.height / 2, translate: '-100% -50%' };
  }
  return (
    <>
      {child}
      {createPortal(
        <AnimatePresence>
          {rect && (
            <motion.div className="tooltip" role="tooltip" style={style} initial={{ opacity: 0, scale: 0.96, y: side === 'bottom' ? -3 : side === 'top' ? 3 : 0 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}>
              {label}
              {kbd && <span className="kbd">{kbd}</span>}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/* ─── Popover ─────────────────────────────────────────────────────────────── */
export function Popover({ anchor, open, onClose, children, placement = 'bottom-start', className = '' }: { anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; children: ReactNode; placement?: 'bottom-start' | 'bottom-end' | 'left' | 'top-start'; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const a = anchor.current!.getBoundingClientRect();
      const el = ref.current;
      const w = el?.offsetWidth ?? 220, h = el?.offsetHeight ?? 200;
      let left = placement === 'bottom-end' ? a.right - w : placement === 'left' ? a.left - w - 8 : a.left;
      let top = placement === 'left' ? a.top : placement === 'top-start' ? a.top - h - 6 : a.bottom + 6;
      if (top + h > innerHeight - 8) top = Math.max(8, a.top - h - 6);
      left = Math.min(Math.max(8, left), innerWidth - w - 8);
      top = Math.min(Math.max(8, top), innerHeight - h - 8);
      setPos({ left, top });
    };
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, anchor, placement]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchor.current?.focus(); } };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [open, onClose, anchor]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div ref={ref} className={`popover ${className}`} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }} initial={{ opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }} transition={spring}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Menu({ items, onClose }: { items: ({ label: string; icon?: string; hint?: string; danger?: boolean; disabled?: boolean; onSelect: () => void } | '-')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, []);
  const onKey = (e: React.KeyboardEvent) => {
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  };
  return (
    <div className="menu" role="menu" ref={ref} onKeyDown={onKey}>
      {items.map((it, i) => it === '-' ? <div key={i} className="menu-sep" /> : (
        <button key={i} role="menuitem" className="menu-item" disabled={it.disabled} style={it.danger ? { color: 'var(--danger)' } : undefined} onClick={() => { it.onSelect(); onClose(); }}>
          {it.icon && <Icon name={it.icon} />}{it.label}{it.hint && <span className="faint mono">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/* ─── Modal ───────────────────────────────────────────────────────────────── */
export function Modal({ open, onClose, title, subtitle, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => { const r = ref.current; (r?.querySelector<HTMLElement>('.modal-b input:not([type=checkbox]):not([type=radio]):not([type=file]), .modal-b textarea, .modal-b select') ?? r?.querySelector<HTMLElement>('.modal-f button.primary') ?? r?.querySelector<HTMLElement>('button'))?.focus(); }, 30);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1)!.focus(); }
        else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => { clearTimeout(t); window.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`modal ${wide ? 'wide' : ''}`} initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.985, transition: { duration: 0.12 } }} transition={softSpring}>
            <div className="modal-h">
              <div className="grow">
                <h2 className="h2" id={titleId}>{title}</h2>
                {subtitle && <div className="muted" style={{ marginTop: 4 }}>{subtitle}</div>}
              </div>
              <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-b">{children}</div>
            {footer && <div className="modal-f">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ─── Toasts ─────────────────────────────────────────────────────────────── */
type Toast = { id: number; tone: 'ok' | 'warn' | 'danger' | 'info'; title: string; message?: string; action?: { label: string; run: () => void }; ttl?: number };
export const useToasts = create<{ list: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>((set, get) => ({
  list: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set({ list: [...get().list.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.ttl ?? (t.tone === 'danger' ? 9000 : 4800));
  },
  dismiss: (id) => set({ list: get().list.filter((x) => x.id !== id) }),
}));
export const toast = (tone: Toast['tone'], title: string, message?: string, action?: Toast['action']) => useToasts.getState().push({ tone, title, message, action });

export function Toaster() {
  const { list, dismiss } = useToasts();
  return (
    <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
      <AnimatePresence initial={false}>
        {list.map((t) => (
          <motion.div layout key={t.id} className={`toast ${t.tone}`} initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.16 } }} transition={spring}>
            <span className="t-ic"><Icon name={t.tone === 'ok' ? 'check' : t.tone === 'info' ? 'info' : 'alert'} /></span>
            <div className="grow">
              <div style={{ fontWeight: 500 }}>{t.title}</div>
              {t.message && <div className="muted" style={{ marginTop: 2 }}>{t.message}</div>}
              {t.action && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
            </div>
            <button className="icon-btn sm" onClick={() => dismiss(t.id)} aria-label="Dismiss"><Icon name="x" /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ─── Basic controls ─────────────────────────────────────────────────────── */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <motion.span className="knob" animate={{ x: checked ? 12 : 0 }} transition={spring} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  const id = useId();
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={`seg-${id}`} className="seg-ind" transition={spring} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  const id = useId();
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.value === value);
    if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].value);
    if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length].value);
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" className="tab" aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1} onClick={() => onChange(t.value)}>
          {t.label}
          {t.value === value && <motion.span layoutId={`tab-${id}`} className="tab-ind" transition={spring} />}
        </button>
      ))}
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const roundTo = (v: number, step: number) => { const d = Math.max(0, -Math.floor(Math.log10(step))); return +(Math.round(v / step) * step).toFixed(d); };

/** Slider with pointer drag, keyboard steps (shift = ×10) and an accessible value. */
export function Slider({ value, min, max, step = 0.01, onChange, onCommit, label, disabled }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: () => void; label: string; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const pct = ((clamp(value, min, max) - min) / (max - min || 1)) * 100;
  const fromX = (x: number) => { const r = ref.current!.getBoundingClientRect(); return roundTo(clamp(min + ((x - r.left) / r.width) * (max - min), min, max), step); };
  return (
    <div
      ref={ref} className="slider" role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-disabled={disabled} data-drag={drag}
      onPointerDown={(e) => { if (disabled) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag(true); onChange(fromX(e.clientX)); }}
      onPointerMove={(e) => { if (drag) onChange(fromX(e.clientX)); }}
      onPointerUp={() => { if (drag) { setDrag(false); onCommit?.(); } }}
      onKeyDown={(e) => {
        if (disabled) return;
        const s = e.shiftKey ? step * 10 : step;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(roundTo(clamp(value + s, min, max), step)); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(roundTo(clamp(value - s, min, max), step)); }
        if (e.key === 'Home') onChange(min);
        if (e.key === 'End') onChange(max);
      }}
      onKeyUp={() => onCommit?.()}
    >
      <div className="track" />
      <div className="fill" style={{ width: `${pct}%` }} />
      <div className="thumb" style={{ left: `${pct}%` }} />
    </div>
  );
}

/** Numeric field with a scrubbable label (drag horizontally), typed entry and arrow keys. */
export function NumberField({ value, onChange, onCommit, step = 0.01, min = -Infinity, max = Infinity, label, prefix, suffix, disabled, precision }: { value: number; onChange: (v: number) => void; onCommit?: () => void; step?: number; min?: number; max?: number; label: string; prefix?: string; suffix?: string; disabled?: boolean; precision?: number }) {
  const [text, setText] = useState<string | null>(null);
  const start = useRef<{ x: number; v: number } | null>(null);
  const fmt = (v: number) => (precision !== undefined ? v.toFixed(precision) : String(roundTo(v, step)));
  const commit = (t: string) => {
    const n = Number(t.replace(',', '.'));
    if (Number.isFinite(n)) onChange(roundTo(clamp(n, min, max), step));
    setText(null);
    onCommit?.();
  };
  return (
    <div className="numfield" aria-disabled={disabled}>
      {prefix !== undefined && (
        <span className="scrub" aria-hidden
          onPointerDown={(e) => { if (disabled) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); start.current = { x: e.clientX, v: value }; }}
          onPointerMove={(e) => { if (!start.current) return; const dx = e.clientX - start.current.x; onChange(roundTo(clamp(start.current.v + dx * step * (e.shiftKey ? 10 : 1), min, max), step)); }}
          onPointerUp={() => { if (start.current) { start.current = null; onCommit?.(); } }}
        >{prefix}</span>
      )}
      <input aria-label={label} disabled={disabled} inputMode="decimal" value={text ?? fmt(value)} onFocus={(e) => { setText(fmt(value)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const s = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1); const n = roundTo(clamp(value + s, min, max), step); onChange(n); setText(fmt(n)); }
        }} />
      {suffix && <span className="faint mono" style={{ paddingRight: 6 }}>{suffix}</span>}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <div className="field-error" role="alert">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export function PropertyGroup({ title, children, defaultOpen = true, actions, id }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode; id?: string }) {
  const key = id ? `pg:${id}` : null;
  const [open, setOpen] = useState(() => { try { return key ? localStorage.getItem(key) !== '0' : defaultOpen; } catch { return defaultOpen; } });
  const toggle = useCallback(() => setOpen((o) => { try { if (key) localStorage.setItem(key, o ? '0' : '1'); } catch {} return !o; }), [key]);
  return (
    <section className="pgroup">
      <div className="row" style={{ paddingRight: 10 }}>
        <button className="pgroup-h" aria-expanded={open} onClick={toggle}>
          <Icon name="chevronRight" size={12} className="" />
          <span>{title}</span>
        </button>
        {actions}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }} style={{ overflow: 'hidden' }}>
            <div className="pgroup-b">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <style>{`.pgroup-h[aria-expanded='true'] svg { transform: rotate(90deg); }`}</style>
    </section>
  );
}

const STATUS_TONE: Record<string, string> = {
  draft: '', review: 'warn', approved: 'info', published: 'ok', deprecated: 'warn', archived: '', rejected: 'danger',
  queued: '', processing: 'info', completed: 'ok', failed: 'danger', cancelled: '',
  pending: 'warn', confirmed: 'ok', connected: 'ok', expired: 'warn', error: 'danger', unpublished: '', outdated: 'warn',
  supported: 'ok', partial: 'warn', unsupported: 'danger', unavailable: '',
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${STATUS_TONE[status] ?? ''}`}><span className="dot" />{label ?? status}</span>;
}

export function ApprovalIndicator({ steps }: { steps: { label: string; state: 'done' | 'current' | 'todo' | 'blocked' }[] }) {
  return (
    <ol className="row" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 4 }} aria-label="Approval progress">
      {steps.map((s, i) => (
        <li key={i} className="row" style={{ gap: 4 }}>
          <span className="badge" style={{ color: s.state === 'done' ? 'var(--ok)' : s.state === 'current' ? 'var(--text)' : s.state === 'blocked' ? 'var(--danger)' : 'var(--text-3)', borderColor: s.state === 'current' ? 'var(--line-3)' : undefined }}>
            {s.state === 'done' ? <Icon name="check" size={11} /> : <span className="dot" />} {s.label}
          </span>
          {i < steps.length - 1 && <span className="faint">—</span>}
        </li>
      ))}
    </ol>
  );
}

export function EmptyState({ icon = 'sparkles', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art"><Icon name={icon} size={24} /></div>
      <div className="h3" style={{ color: 'var(--text)' }}>{title}</div>
      {children && <div style={{ maxWidth: 380 }}>{children}</div>}
      {action}
    </div>
  );
}

export function Avatar({ name }: { name?: string | null }) {
  const initials = (name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return <span className="avatar" aria-hidden>{initials}</span>;
}

export const timeAgo = (d: string | number | Date) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
