import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BrandMark } from "@/components/complete-iq/brand-mark";
import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import LoginPage from "@/features/auth/login-page";
import DashboardPage from "@/features/dashboard/dashboard-page";
import ClaimsPage from "@/features/claims/claims-page";
import ClaimWorkbench from "@/features/claims/claim-workbench";
import InsightsPage from "@/features/insights/insights-page";
import SettingsPage from "@/features/settings/settings-page";
import CarriersPage from "@/features/carriers/carriers-page";
import CarrierEditorPage from "@/features/carriers/carrier-editor-page";
import NotFoundPage from "@/features/system/not-found-page";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
        failureCount < 2,
      refetchOnWindowFocus: false,
    },
  },
});

function ClaimDetailWrapper({ params }: { params: { id: string } }) {
  return <ClaimWorkbench claimId={params.id} />;
}

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[var(--ciq-canvas)]">
        <div className="text-center" role="status" aria-live="polite">
          <BrandMark className="mb-5" />
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-[var(--ciq-border-strong)] border-t-[var(--ciq-verified)]" />
          <p className="text-sm text-[var(--ciq-ink-muted)]">Verifying protected session…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <AppLayout />;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAdmin } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (!isAdmin) setLocation("/");
  }, [isAdmin, setLocation]);
  if (!isAdmin) return null;
  return <Component />;
}

function AppLayout() {
  return (
    <AppShell>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/claims" component={ClaimsPage} />
          <Route path="/claims/:id">{(params) => <ClaimDetailWrapper params={params} />}</Route>
          <Route path="/insights" component={InsightsPage} />
          <Route path="/upload">{() => <LegacyRedirect to="/claims?upload=1" />}</Route>
          <Route path="/audit-results">{() => <LegacyRedirect to="/claims" />}</Route>
          <Route path="/settings">{() => <AdminRoute component={SettingsPage} />}</Route>
          <Route path="/carriers">{() => <AdminRoute component={CarriersPage} />}</Route>
          <Route path="/carriers/:key">{(params) => <AdminCarrierEditor carrierKey={params.key} />}</Route>
          <Route component={NotFoundPage} />
        </Switch>
    </AppShell>
  );
}

function LegacyRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => setLocation(to, { replace: true }), [setLocation, to]);
  return null;
}

function AdminCarrierEditor({ carrierKey }: { carrierKey: string }) {
  const { isAdmin } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (!isAdmin) setLocation("/");
  }, [isAdmin, setLocation]);
  if (!isAdmin) return null;
  return <CarrierEditorPage carrierKey={carrierKey} />;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AuthGate />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
