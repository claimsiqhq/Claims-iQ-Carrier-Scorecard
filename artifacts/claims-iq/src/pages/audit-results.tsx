import { BRAND, FONTS } from "@/lib/brand"
import { useListClaims } from "@workspace/api-client-react"
import { useLocation } from "wouter"
import { ClipboardCheck, WarningTriangle, Check, Eye } from "iconoir-react"
import { Badge } from "@/components/ui/badge"

export default function AuditResultsPage() {
  const { data: claims, isLoading } = useListClaims()
  const [, setLocation] = useLocation()

  const analyzedClaims = claims?.filter((c) => c.status === "analyzed") ?? []
  const pendingClaims = claims?.filter((c) => c.status === "pending") ?? []

  if (isLoading) {
    return (
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 flex items-center px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
          <h1 className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Audit Results</h1>
        </header>
        <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: BRAND.offWhite }}>
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-16 flex items-center px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <h1 className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Audit Results</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="p-5 rounded-lg border" style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}>
              <p className="text-xs uppercase tracking-wider mb-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>Total Claims</p>
              <p className="text-2xl font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{claims?.length ?? 0}</p>
            </div>
            <div className="p-5 rounded-lg border" style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}>
              <p className="text-xs uppercase tracking-wider mb-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>Audited</p>
              <p className="text-2xl font-bold" style={{ color: "#16a34a", fontFamily: FONTS.mono }}>{analyzedClaims.length}</p>
            </div>
            <div className="p-5 rounded-lg border" style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}>
              <p className="text-xs uppercase tracking-wider mb-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>Pending Audit</p>
              <p className="text-2xl font-bold" style={{ color: BRAND.gold, fontFamily: FONTS.mono }}>{pendingClaims.length}</p>
            </div>
          </div>

          {analyzedClaims.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>
                Completed Audits
              </h2>
              <div className="space-y-3">
                {analyzedClaims.map((claim) => (
                  <button
                    key={claim.id}
                    className="w-full text-left p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md flex items-center gap-4"
                    style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}
                    onClick={() => setLocation(`/claims/${claim.id}`)}
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "#f0fdf4" }}>
                      <Check width={20} height={20} style={{ color: "#16a34a" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{claim.claimNumber}</p>
                      <p className="text-xs truncate" style={{ color: BRAND.purpleSecondary }}>{claim.insuredName} — {claim.carrier}</p>
                    </div>
                    <Badge className="shadow-none border-transparent text-xs shrink-0" style={{ backgroundColor: "#f0fdf4", color: "#16a34a" }}>
                      Audited
                    </Badge>
                    <Eye width={18} height={18} style={{ color: BRAND.purpleSecondary }} className="shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {pendingClaims.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>
                Pending Audit
              </h2>
              <div className="space-y-3">
                {pendingClaims.map((claim) => (
                  <button
                    key={claim.id}
                    className="w-full text-left p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md flex items-center gap-4"
                    style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}
                    onClick={() => setLocation(`/claims/${claim.id}`)}
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "#fefce8" }}>
                      <WarningTriangle width={20} height={20} style={{ color: BRAND.gold }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{claim.claimNumber}</p>
                      <p className="text-xs truncate" style={{ color: BRAND.purpleSecondary }}>{claim.insuredName} — {claim.carrier}</p>
                    </div>
                    <Badge className="shadow-none border-transparent text-xs shrink-0" style={{ backgroundColor: "#fefce8", color: BRAND.gold }}>
                      Pending
                    </Badge>
                    <Eye width={18} height={18} style={{ color: BRAND.purpleSecondary }} className="shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {(!claims || claims.length === 0) && (
            <div className="text-center py-16">
              <ClipboardCheck width={48} height={48} style={{ color: BRAND.purpleSecondary }} className="mx-auto mb-4" />
              <p className="text-sm" style={{ color: BRAND.purpleSecondary }}>No claims found. Upload documents to get started.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
