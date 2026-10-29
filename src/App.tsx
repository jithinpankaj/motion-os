import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './lib/session';
import { useExports } from './lib/exports';
import { AppShell } from './components/AppShell';
import { Toaster } from './ui/controls';
import { AuthPage, InvitePage, ResetPage } from './features/auth/Auth';

const Home = lazy(() => import('./features/home/Home'));
const Explore = lazy(() => import('./features/explore/Explore'));
const Projects = lazy(() => import('./features/studio/Projects'));
const Studio = lazy(() => import('./features/studio/Studio'));
const Playground = lazy(() => import('./features/playground/Playground'));
const Campaigns = lazy(() => import('./features/campaigns/Campaigns'));
const Campaign = lazy(() => import('./features/campaigns/Campaign'));
const Brand = lazy(() => import('./features/brand/Brand'));
const BrandKit = lazy(() => import('./features/brand/BrandKit'));
const Create = lazy(() => import('./features/create/Create'));
const Library = lazy(() => import('./features/library/Library'));
const Analytics = lazy(() => import('./features/analytics/Analytics'));
const Assets = lazy(() => import('./features/assets/Assets'));
const Integrations = lazy(() => import('./features/integrations/Integrations'));
const Settings = lazy(() => import('./features/settings/Settings'));
const EmbedExample = lazy(() => import('./features/embed/EmbedExample'));

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

  const editor = loc.pathname.startsWith('/studio/') || loc.pathname.startsWith('/play/');
  return (
    <>
      <AppShell bare={editor}>
        <Suspense fallback={<Loading />}>
          <Routes key={wsId}>
            <Route path="/" element={<Home />} />
            <Route path="/create" element={<Create />} />
            <Route path="/create/:id" element={<Create />} />
            <Route path="/library" element={<Library />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/studio" element={<Projects />} />
            <Route path="/studio/:id" element={<Studio />} />
            <Route path="/play/:templateId" element={<Playground />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/campaigns/:id" element={<Campaign />} />
            <Route path="/brand" element={<BrandKit />} />
            <Route path="/brand/advanced" element={<Brand />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/embed-example" element={<EmbedExample />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/login" element={<Navigate to={new URLSearchParams(loc.search).get('next') || '/'} replace />} />
            <Route path="*" element={<div className="empty" style={{ height: '100%' }}><div className="h2">Not found</div></div>} />
          </Routes>
        </Suspense>
      </AppShell>
      <Toaster />
    </>
  );
}
