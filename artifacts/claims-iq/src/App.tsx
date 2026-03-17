import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import ClaimsListPage from "@/pages/claims-list";
import ClaimDetailPage from "@/pages/claim-detail";
import SettingsPage from "@/pages/settings";
import { useListClaims } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { BRAND, FONTS } from "@/lib/brand";
import { DashboardDots } from "iconoir-react";

const queryClient = new QueryClient();

function DashboardHome() {
  const [, setLocation] = useLocation();
  const { data: claims } = useListClaims();
  const analyzedCount = claims?.filter((c) => c.status === "analyzed").length ?? 0;
  const pendingCount = claims?.filter((c) => c.status === "pending").length ?? 0;

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-16 flex items-center px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <h1 className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Dashboard</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <StatCard label="Total Claims" value={String(claims?.length ?? 0)} />
            <StatCard label="Analyzed" value={String(analyzedCount)} />
            <StatCard label="Pending" value={String(pendingCount)} />
          </div>
          <button
            className="w-full text-left p-5 rounded-lg border cursor-pointer transition-all hover:shadow-md"
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
    <div className="p-5 rounded-lg border" style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}>
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{value}</p>
    </div>
  );
}

function ClaimDetailWrapper({ params }: { params: { id: string } }) {
  return <ClaimDetailPage claimId={params.id} />;
}

function AppLayout() {
  const { data: claims } = useListClaims();
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: BRAND.offWhite, fontFamily: FONTS.body, color: BRAND.deepPurple }}>
      <Sidebar
        claims={claims}
        onSelectClaim={(id) => setLocation(`/claims/${id}`)}
      />
      <Switch>
        <Route path="/" component={DashboardHome} />
        <Route path="/claims" component={ClaimsListPage} />
        <Route path="/claims/:id">{(params) => <ClaimDetailWrapper params={params} />}</Route>
        <Route path="/settings" component={SettingsPage} />
        <Route>
          <main className="flex-1 flex items-center justify-center" style={{ backgroundColor: BRAND.offWhite }}>
            <p style={{ color: BRAND.purpleSecondary }}>Page not found</p>
          </main>
        </Route>
      </Switch>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppLayout />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
