import { BRAND, FONTS } from "@/lib/brand"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useListClaims } from "@workspace/api-client-react"
import { useLocation } from "wouter"
import { PageEdit } from "iconoir-react"

const statusColors: Record<string, { bg: string; color: string }> = {
  analyzed: { bg: "#e8f5e9", color: "#2e7d32" },
  approved: { bg: "#e3f2fd", color: "#1565c0" },
  pending: { bg: "#fef9ec", color: BRAND.gold },
  denied: { bg: "#fef2f2", color: "#dc2626" },
  review: { bg: BRAND.lightPurpleGrey, color: BRAND.purple },
}

export default function ClaimsListPage() {
  const { data: claims, isLoading } = useListClaims()
  const [, setLocation] = useLocation()

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-16 flex items-center px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <h1 className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
          All Claims
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-4xl mx-auto space-y-3">
          {isLoading && (
            <div className="text-center py-12">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
              <p className="text-sm" style={{ color: BRAND.purpleSecondary }}>Loading claims...</p>
            </div>
          )}

          {claims?.map((claim) => {
            const sc = statusColors[claim.status] || statusColors.pending
            return (
              <Card
                key={claim.id}
                className="shadow-sm cursor-pointer transition-all hover:shadow-md"
                style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}
                onClick={() => setLocation(`/claims/${claim.id}`)}
              >
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
                      <PageEdit width={20} height={20} style={{ color: BRAND.purple }} />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-sm font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{claim.claimNumber}</span>
                        <Badge className="shadow-none text-xs border-transparent" style={{ backgroundColor: sc.bg, color: sc.color }}>
                          {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
                        </Badge>
                      </div>
                      <p className="text-sm" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>{claim.insuredName}</p>
                    </div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-xs" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
                      {claim.carrier}
                    </p>
                    <p className="text-xs" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>
                      {claim.dateOfLoss}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {claims && claims.length === 0 && (
            <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
              <CardContent className="p-12 text-center">
                <PageEdit width={48} height={48} className="mx-auto mb-4" style={{ color: BRAND.purpleSecondary }} />
                <h3 className="text-lg font-semibold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>No Claims Yet</h3>
                <p className="text-sm" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>Upload your first claim to get started.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  )
}
