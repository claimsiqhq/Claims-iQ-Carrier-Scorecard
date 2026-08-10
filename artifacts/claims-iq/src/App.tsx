import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BrandMark } from "@/components/complete-iq/brand-mark";
import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
const LoginPage = lazy(() => import("@/features/auth/login-page"));
const ForgotPasswordPage = lazy(() => import("@/features/auth/forgot-password-page"));
const ResetPasswordPage = lazy(() => import("@/features/auth/reset-password-page"));
const AcceptInvitationPage = lazy(() => import("@/features/auth/accept-invitation-page"));
const DashboardPage = lazy(() => import("@/features/dashboard/dashboard-page"));
const ClaimsPage = lazy(() => import("@/features/claims/claims-page"));
const ClaimWorkbench = lazy(() => import("@/features/claims/claim-workbench"));
const InsightsPage = lazy(() => import("@/features/insights/insights-page"));
const SettingsPage = lazy(() => import("@/features/settings/settings-page"));
const CarriersPage = lazy(() => import("@/features/carriers/carriers-page"));
const CarrierEditorPage = lazy(() => import("@/features/carriers/carrier-editor-page"));
const NotFoundPage = lazy(() => import("@/features/system/not-found-page"));

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

function AppLoading() {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-[var(--ciq-canvas)]">
      <div className="text-center" role="status" aria-live="polite">
        <BrandMark className="mb-5" />
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-[var(--ciq-border-strong)] border-t-[var(--ciq-verified)]" />
        <p className="text-sm text-[var(--ciq-ink-muted)]">Opening protected workspace…</p>
      </div>
    </div>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) return <AppLoading />;

  if (!user) {
    return <LoginPage />;
  }

  return <AppLayout />;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/accept-invitation" component={AcceptInvitationPage} />
      <Route>
        <AuthGate />
      </Route>
    </Switch>
  );
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

function GlobalAdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const allowed = user?.role === "admin";
  useEffect(() => {
    if (!allowed) setLocation("/");
  }, [allowed, setLocation]);
  if (!allowed) return null;
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
          <Route path="/carriers">{() => <GlobalAdminRoute component={CarriersPage} />}</Route>
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
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const allowed = user?.role === "admin";
  useEffect(() => {
    if (!allowed) setLocation("/");
  }, [allowed, setLocation]);
  if (!allowed) return null;
  return <CarrierEditorPage carrierKey={carrierKey} />;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Suspense fallback={<AppLoading />}>
                <AppRoutes />
              </Suspense>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
