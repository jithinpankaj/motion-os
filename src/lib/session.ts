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

export const useSession = create<State>((set, get) => ({
  status: 'loading',
  user: null,
  workspaces: [],
  wsId: null,
  brandId: null,
  notice: null,
  load: async () => {
    const res = await fetch('/api/session', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ user: null }));
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
