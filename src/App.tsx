import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './lib/session';
import { useExports } from './lib/exports';
import { AppShell } from './components/AppShell';
import { Toaster } from './ui/controls';
import { AuthPage, InvitePage, ResetPage } from './features/auth/Auth';

const Home = lazy(() => import('./features/home/Home'));
const Editor = lazy(() => import('./features/editor/Editor'));
const Community = lazy(() => import('./features/community/Community'));
const Post = lazy(() => import('./features/community/Post'));
const Settings = lazy(() => import('./features/settings/Settings'));

function Loading() {
  return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }} role="status" aria-label="Loading"><div className="spinner" /></div>;
}

export function App() {
  const { status, user, wsId, load } = useSession();
  const loc = useLocation();
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (user && wsId) useExports.getState().refresh(); }, [user, wsId]);

  if (status === 'loading') return <Loading />;
  const publicRoutes = (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/reset" element={<ResetPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="*" element={<Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />} />
    </Routes>
  );
  if (!user) return <>{publicRoutes}<Toaster /></>;
  if (!wsId) return <div className="empty" style={{ height: '100%' }}><div className="h2">No workspace access</div><div>You are not a member of any workspace. Ask an admin for an invitation.</div><button className="btn" onClick={() => useSession.getState().logout()}>Sign out</button></div>;

  const editor = loc.pathname.startsWith('/edit/');
  return (
    <>
      <AppShell bare={editor}>
        <Suspense fallback={<Loading />}>
          <Routes key={wsId}>
            <Route path="/" element={<Home />} />
            <Route path="/edit/:id" element={<Editor />} />
            <Route path="/community" element={<Community />} />
            <Route path="/community/:id" element={<Post />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/login" element={<Navigate to={new URLSearchParams(loc.search).get('next') || '/'} replace />} />
            <Route path="*" element={<div className="empty" style={{ height: '100%' }}><div className="h2">Not found</div><a className="btn" href="/">Go home</a></div>} />
          </Routes>
        </Suspense>
      </AppShell>
      <Toaster />
    </>
  );
}
