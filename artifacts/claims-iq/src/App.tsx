import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Sidebar } from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import LoginPage from "@/pages/login";
import ClaimsListPage from "@/pages/claims-list";
import ClaimDetailPage from "@/pages/claim-detail";
import UploadPage from "@/pages/upload";
import AuditResultsPage from "@/pages/audit-results";
import SettingsPage from "@/pages/settings";
import { useListClaims } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { BRAND, FONTS } from "@/lib/brand";
import { DashboardDots } from "iconoir-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function DashboardHome() {
  const [, setLocation] = useLocation();
  const { data: claims } = useListClaims();
  const analyzedCount = claims?.filter((c) => c.status === "analyzed").length ?? 0;
  const pendingCount = claims?.filter((c) => c.status === "pending").length ?? 0;

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-14 md:h-16 flex items-center px-4 md:px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <h1 className="text-base md:text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Dashboard</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
            <StatCard label="Total Claims" value={String(claims?.length ?? 0)} />
            <StatCard label="Analyzed" value={String(analyzedCount)} />
            <StatCard label="Pending" value={String(pendingCount)} />
          </div>
          <button
            className="w-full text-left p-4 md:p-5 rounded-lg border cursor-pointer transition-all hover:shadow-md active:scale-[0.99]"
            style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}
            onClick={() => setLocation("/claims")}
          >
            <div className="flex items-center gap-3">
              <DashboardDots width={24} height={24} style={{ color: BRAND.purple }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>View All Claims</p>
                <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>Browse and manage all insurance claims</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 md:p-5 rounded-lg border" style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}>
      <p className="text-[10px] md:text-xs uppercase tracking-wider mb-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>{label}</p>
      <p className="text-xl md:text-2xl font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{value}</p>
    </div>
  );
}

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
          <Route path="/" component={DashboardHome} />
          <Route path="/claims" component={ClaimsListPage} />
          <Route path="/claims/:id">{(params) => <ClaimDetailWrapper params={params} />}</Route>
          <Route path="/upload" component={UploadPage} />
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
