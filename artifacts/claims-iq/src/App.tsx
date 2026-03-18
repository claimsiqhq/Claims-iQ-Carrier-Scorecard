import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Sidebar } from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import ClaimsListPage from "@/pages/claims-list";
import ClaimDetailPage from "@/pages/claim-detail";
import AuditResultsPage from "@/pages/audit-results";
import SettingsPage from "@/pages/settings";
import { useListClaims } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { BRAND, FONTS } from "@/lib/brand";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function ClaimDetailWrapper({ params }: { params: { id: string } }) {
  return <ClaimDetailPage claimId={params.id} />;
}

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-[100dvh] flex items-center justify-center" style={{ backgroundColor: BRAND.deepPurple }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm" style={{ color: BRAND.purpleSecondary }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <AppLayout />;
}

function AppLayout() {
  const { data: claims } = useListClaims();
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();

  return (
    <div
      className="h-[100dvh] flex flex-col md:flex-row overflow-hidden"
      style={{ backgroundColor: BRAND.offWhite, fontFamily: FONTS.body, color: BRAND.deepPurple }}
    >
      <Sidebar
        claims={claims}
        onSelectClaim={(id) => setLocation(`/claims/${id}`)}
      />
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${isMobile ? "pt-14" : ""}`}>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/claims" component={ClaimsListPage} />
          <Route path="/claims/:id">{(params) => <ClaimDetailWrapper params={params} />}</Route>
          <Route path="/upload">{() => { setLocation("/claims"); return null; }}</Route>
          <Route path="/audit-results" component={AuditResultsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route>
            <main className="flex-1 flex items-center justify-center" style={{ backgroundColor: BRAND.offWhite }}>
              <p style={{ color: BRAND.purpleSecondary }}>Page not found</p>
            </main>
          </Route>
        </Switch>
      </div>
    </div>
  );
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
