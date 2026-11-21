import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch } from 'wouter';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LiveProvider } from '@/lib/live';
import { Layout } from '@/components/Layout';
import { Loading } from '@/components/common';
import { AuthPage } from '@/pages/AuthPage';
import { OverviewPage } from '@/pages/OverviewPage';
import NotFound from '@/pages/not-found';

// Secondary screens are split into their own chunks.
const DispatchPage = lazy(() => import('@/pages/DispatchPage'));
const CorridorPage = lazy(() => import('@/pages/CorridorPage'));
const TrafficPage = lazy(() => import('@/pages/TrafficPage'));
const HospitalsPage = lazy(() => import('@/pages/HospitalsPage'));
const FleetPage = lazy(() => import('@/pages/FleetPage'));
const AiEnginePage = lazy(() => import('@/pages/AiEnginePage'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const AuditPage = lazy(() => import('@/pages/AuditPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function AuthedApp() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Checking session…" />;
  if (!user) return <AuthPage />;
  return (
    <LiveProvider>
      <Layout>
        <Suspense fallback={<Loading label="Loading…" />}>
          <Switch>
            <Route path="/" component={OverviewPage} />
            <Route path="/dispatch" component={DispatchPage} />
            <Route path="/dispatch/:id" component={DispatchPage} />
            <Route path="/corridor" component={CorridorPage} />
            <Route path="/traffic" component={TrafficPage} />
            <Route path="/hospitals" component={HospitalsPage} />
            <Route path="/fleet" component={FleetPage} />
            <Route path="/ai" component={AiEnginePage} />
            <Route path="/analytics" component={AnalyticsPage} />
            <Route path="/audit" component={AuditPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </Layout>
    </LiveProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthedApp />
      </AuthProvider>
      <Toaster theme="dark" position="bottom-right" richColors closeButton visibleToasts={3} />
    </QueryClientProvider>
  );
}
