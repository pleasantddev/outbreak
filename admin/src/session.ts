import { useEffect, useState } from 'preact/hooks';
import { api, token, onAuthLost } from './api';
import { can, type AdminUser, type Perm } from '@srv/types';

interface S { user: AdminUser | null; perms: Perm[]; ready: boolean }
let state: S = { user: null, perms: [], ready: false }; const subs = new Set<() => void>();
const set = (s: Partial<S>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };
export const session = { get: () => state, can: (p: Perm) => !!state.user && can(state.user.role, p) };
export function useSession() { const [, n] = useState(0); useEffect(() => { const f = () => n((x) => x + 1); subs.add(f); return () => void subs.delete(f); }, []); return state; }
export const useCan = () => { useSession(); return (p: Perm) => session.can(p); };
export async function restore() {
  if (token.get()) { try { const r = await api.get('/auth/me'); set({ user: r.user, perms: r.perms, ready: true }); return; } catch { token.clear(); } }
  set({ user: null, perms: [], ready: true });
}
export function adopt(r: { token: string; user: AdminUser; perms: Perm[] }) { token.set(r.token); set({ user: r.user, perms: r.perms, ready: true }); }
export async function logout() { try { await api.post('/auth/logout'); } catch { /* already gone */ } token.clear(); set({ user: null, perms: [] }); }
onAuthLost(() => set({ user: null, perms: [] }));

// hash router: #/players/acc_1  ->  ['players', 'acc_1']
export function useRoute() {
  const [h, set2] = useState(location.hash);
  useEffect(() => { const f = () => set2(location.hash); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const [path, query] = h.replace(/^#\/?/, '').split('?'); return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(query ?? '') };
}
export const go = (p: string) => { location.hash = '#/' + p.replace(/^\//, ''); };
