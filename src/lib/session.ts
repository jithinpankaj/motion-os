import { create } from 'zustand';
import type { PermissionKey } from '../../shared/permissions';

export type Workspace = { id: string; name: string; roles: string[]; permissions: string[]; brands: { id: string; name: string }[]; teams: { id: string; name: string }[] };
type State = {
  status: 'loading' | 'ready';
  user: { id: string; email: string; name: string } | null;
  workspaces: Workspace[];
  wsId: string | null;
  brandId: string | null;
  notice: string | null;
  load: () => Promise<void>;
  switchWorkspace: (id: string) => void;
  setBrand: (id: string) => void;
  logout: () => Promise<void>;
  expire: () => void;
  accessLost: () => void;
};

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

const fetchSession = () => fetch('/api/session', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ user: null }));

// Local development signs in as a demo account automatically (the server only allows it on loopback, outside
// production). Visiting /login directly, or signing out, shows the normal form for the rest of the tab session.
export const DEV_AUTO_LOGIN_OFF = 'mos.devAutoLoginOff';
function devAutoLogin() {
  if (!import.meta.env.DEV) return false;
  const p = location.pathname;
  if (p === '/login' || p === '/register' || p === '/reset' || p.startsWith('/invite/')) return false;
  try { return sessionStorage.getItem(DEV_AUTO_LOGIN_OFF) !== '1'; } catch { return true; }
}

export const useSession = create<State>((set, get) => ({
  status: 'loading',
  user: null,
  workspaces: [],
  wsId: null,
  brandId: null,
  notice: null,
  load: async () => {
    let res = await fetchSession();
    if (!res.user && devAutoLogin()) {
      const ok = await fetch('/api/auth/dev-login', { method: 'POST', credentials: 'same-origin' }).then((r) => r.ok).catch(() => false);
      if (ok) res = await fetchSession();
    }
    const workspaces: Workspace[] = res.workspaces ?? [];
    const saved = read('mos.ws');
    const ws = workspaces.find((w) => w.id === (get().wsId ?? saved)) ?? workspaces[0] ?? null;
    const brand = ws?.brands.find((b) => b.id === read(`mos.brand.${ws?.id}`)) ?? ws?.brands[0] ?? null;
    set({ status: 'ready', user: res.user, workspaces, wsId: ws?.id ?? null, brandId: brand?.id ?? null });
  },
  switchWorkspace: (id) => {
    const ws = get().workspaces.find((w) => w.id === id);
    if (!ws) return;
    write('mos.ws', id);
    set({ wsId: id, brandId: ws.brands[0]?.id ?? null });
  },
  setBrand: (id) => { write(`mos.brand.${get().wsId}`, id); set({ brandId: id }); },
  logout: async () => {
    try { sessionStorage.setItem(DEV_AUTO_LOGIN_OFF, '1'); } catch {}
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    set({ user: null, workspaces: [], wsId: null });
  },
  expire: () => set({ user: null, notice: 'Your session expired. Sign in again — unsaved scene changes are kept on this device.' }),
  accessLost: () => {
    set({ notice: 'You no longer have access to that workspace. Your unsaved changes are kept on this device.' });
    get().load();
  },
}));

export const useWorkspace = () => {
  const { workspaces, wsId } = useSession();
  return workspaces.find((w) => w.id === wsId) ?? null;
};

export function useCan() {
  const ws = useWorkspace();
  const perms = new Set(ws?.permissions ?? []);
  return (k: PermissionKey) => perms.has(k);
}
