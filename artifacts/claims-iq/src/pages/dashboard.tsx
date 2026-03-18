import { useState, useEffect } from "react"
import { useLocation } from "wouter"
import { BRAND, FONTS } from "@/lib/brand"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Shield,
  WarningTriangle,
  CheckCircle,
  Upload as UploadIcon,
  NavArrowRight,
  ClipboardCheck,
  Sparks,
  PageEdit,
} from "iconoir-react"

interface DashboardData {
  stats: {
    totalClaims: number
    analyzedCount: number
    pendingCount: number
    avgScore: number | null
  }
  riskDistribution: Record<string, number>
  approvalDistribution: Record<string, number>
  carriers: Array<{ name: string; count: number; avgScore: number | null }>
  findingSeverity: Record<string, number>
  recentClaims: Array<{
    id: string
    claimNumber: string
    insuredName: string
    carrier: string | null
    status: string
    dateOfLoss: string | null
    lossType: string | null
    createdAt: string | null
    overallScore: number | null
    riskLevel: string | null
    approvalStatus: string | null
  }>
}

function ScoreRing({ score, size = 72, strokeWidth = 5 }: { score: number; size?: number; strokeWidth?: number }) {
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  const color = score >= 80 ? "#16a34a" : score >= 60 ? BRAND.gold : "#dc2626"

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={BRAND.greyLavender} strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <span className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{score}</span>
    </div>
  )
}

function RiskBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-16 shrink-0 text-right font-medium" style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>{label}</span>
      <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs w-6 font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{count}</span>
    </div>
  )
}

function getApprovalLabel(status: string) {
  switch (status) {
    case "APPROVE": return "Approve"
    case "APPROVE WITH MINOR CHANGES": return "Minor Changes"
    case "REQUIRES REVIEW": return "Needs Review"
    case "REJECT": return "Deny"
    default: return status
  }
}

function getApprovalColor(status: string) {
  switch (status) {
    case "APPROVE": return { bg: "#e8f5e9", text: "#2e7d32" }
    case "APPROVE WITH MINOR CHANGES": return { bg: "#e8f5e9", text: "#558b2f" }
    case "REQUIRES REVIEW": return { bg: "#fef9ec", text: BRAND.gold }
    case "REJECT": return { bg: "#fef2f2", text: "#dc2626" }
    default: return { bg: BRAND.lightPurpleGrey, text: BRAND.purple }
  }
}

function getRiskColor(level: string) {
  switch (level) {
    case "LOW": return "#16a34a"
    case "MEDIUM": return BRAND.gold
    case "HIGH": return "#dc2626"
    default: return BRAND.purpleSecondary
  }
}

function getRiskBadgeStyle(level: string | null) {
  switch (level) {
    case "LOW": return { bg: "#e8f5e9", text: "#16a34a", border: "#a3d9a5" }
    case "MEDIUM": return { bg: "#fef9ec", text: BRAND.gold, border: BRAND.goldLight }
    case "HIGH": return { bg: "#fef2f2", text: "#dc2626", border: "#fca5a5" }
    default: return { bg: BRAND.lightPurpleGrey, text: BRAND.purpleSecondary, border: BRAND.greyLavender }
  }
}

export default function DashboardPage() {
  const [, setLocation] = useLocation()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL || "/api"
    fetch(`${baseUrl}/dashboard`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
          <p className="text-sm" style={{ color: BRAND.purpleSecondary }}>Loading dashboard...</p>
        </div>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="flex-1 flex items-center justify-center" style={{ backgroundColor: BRAND.offWhite }}>
        <p className="text-sm" style={{ color: BRAND.purpleSecondary }}>Failed to load dashboard.</p>
      </main>
    )
  }

  const { stats, riskDistribution, approvalDistribution, carriers, findingSeverity, recentClaims } = data
  const totalAnalyzed = Object.values(riskDistribution).reduce((a, b) => a + b, 0)
  const criticalFindings = (findingSeverity["critical"] || 0) + (findingSeverity["high"] || 0)
  const warningFindings = (findingSeverity["warning"] || 0) + (findingSeverity["medium"] || 0)

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-14 md:h-16 flex items-center justify-between px-4 md:px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <h1 className="text-base md:text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Dashboard</h1>
        <Button
          size="sm"
          className="gap-2 text-white text-xs md:text-sm"
          style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
          onClick={() => setLocation("/upload")}
        >
          <UploadIcon width={16} height={16} />
          <span className="hidden sm:inline">New Claim</span>
          <span className="sm:hidden">Upload</span>
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-5xl mx-auto space-y-4 md:space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <StatCard label="Total Claims" value={stats.totalClaims} icon={<PageEdit width={18} height={18} />} color={BRAND.purple} onClick={() => setLocation("/claims")} />
            <StatCard label="Audited" value={stats.analyzedCount} icon={<ClipboardCheck width={18} height={18} />} color="#16a34a" />
            <StatCard label="Pending" value={stats.pendingCount} icon={<Sparks width={18} height={18} />} color={BRAND.gold} accent />
            <StatCard label="Avg Score" value={stats.avgScore !== null ? stats.avgScore : "—"} icon={<Shield width={18} height={18} />} color={BRAND.deepPurple} isScore />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
              <CardContent className="p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Risk Distribution</h3>
                {totalAnalyzed > 0 ? (
                  <div className="space-y-3">
                    <RiskBar label="High" count={riskDistribution["HIGH"] || 0} total={totalAnalyzed} color="#dc2626" />
                    <RiskBar label="Medium" count={riskDistribution["MEDIUM"] || 0} total={totalAnalyzed} color={BRAND.gold} />
                    <RiskBar label="Low" count={riskDistribution["LOW"] || 0} total={totalAnalyzed} color="#16a34a" />
                  </div>
                ) : (
                  <p className="text-sm py-4 text-center" style={{ color: BRAND.purpleSecondary }}>No audited claims yet</p>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
              <CardContent className="p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Approval Status</h3>
                {Object.keys(approvalDistribution).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(approvalDistribution).map(([status, count]) => {
                      const c = getApprovalColor(status)
                      return (
                        <div key={status} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: c.bg }}>
                          <span className="text-lg font-bold" style={{ color: c.text, fontFamily: FONTS.mono }}>{count}</span>
                          <span className="text-xs font-medium" style={{ color: c.text }}>{getApprovalLabel(status)}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm py-4 text-center" style={{ color: BRAND.purpleSecondary }}>No audited claims yet</p>
                )}

                {(criticalFindings > 0 || warningFindings > 0) && (
                  <div className="mt-4 pt-4 flex gap-4" style={{ borderTop: `1px solid ${BRAND.greyLavender}` }}>
                    {criticalFindings > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#dc2626" }} />
                        <span className="text-xs" style={{ color: BRAND.deepPurple }}><strong style={{ fontFamily: FONTS.mono }}>{criticalFindings}</strong> critical findings</span>
                      </div>
                    )}
                    {warningFindings > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND.gold }} />
                        <span className="text-xs" style={{ color: BRAND.deepPurple }}><strong style={{ fontFamily: FONTS.mono }}>{warningFindings}</strong> warnings</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {carriers.length > 0 && (
            <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
              <CardContent className="p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Carrier Breakdown</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {carriers.map((c) => (
                    <div key={c.name} className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: BRAND.offWhite }}>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>{c.name}</p>
                        <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>{c.count} claim{c.count !== 1 ? "s" : ""}</p>
                      </div>
                      {c.avgScore !== null && (
                        <ScoreRing score={c.avgScore} size={48} strokeWidth={4} />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Recent Claims</h3>
                <button
                  className="text-xs font-semibold flex items-center gap-1 hover:opacity-80 transition-opacity"
                  style={{ color: BRAND.purple }}
                  onClick={() => setLocation("/claims")}
                >
                  View All <NavArrowRight width={14} height={14} />
                </button>
              </div>

              {recentClaims.length > 0 ? (
                <div className="space-y-2">
                  {recentClaims.map((c) => {
                    const riskStyle = getRiskBadgeStyle(c.riskLevel)
                    return (
                      <button
                        key={c.id}
                        className="w-full text-left flex items-center gap-3 p-3 rounded-lg transition-colors hover:shadow-sm active:scale-[0.995]"
                        style={{ backgroundColor: BRAND.offWhite }}
                        onClick={() => setLocation(`/claims/${c.id}`)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-semibold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{c.insuredName}</span>
                            {c.status === "pending" && (
                              <Badge className="shadow-none text-[10px] px-1.5 py-0 border-transparent" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple }}>Pending</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>{c.claimNumber}</span>
                            {c.carrier && <span className="text-xs" style={{ color: BRAND.purpleSecondary }}>· {c.carrier}</span>}
                            {c.lossType && <span className="text-xs" style={{ color: BRAND.purpleSecondary }}>· {c.lossType}</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {c.riskLevel && (
                            <Badge className="shadow-none text-[10px] px-1.5 py-0" style={{ backgroundColor: riskStyle.bg, color: riskStyle.text, border: `1px solid ${riskStyle.border}` }}>
                              {c.riskLevel === "LOW" ? "Low" : c.riskLevel === "MEDIUM" ? "Med" : "High"}
                            </Badge>
                          )}
                          {c.overallScore !== null && (
                            <span className="text-sm font-bold w-8 text-right" style={{ color: c.overallScore >= 80 ? "#16a34a" : c.overallScore >= 60 ? BRAND.gold : "#dc2626", fontFamily: FONTS.mono }}>
                              {c.overallScore}
                            </span>
                          )}
                          <NavArrowRight width={14} height={14} style={{ color: BRAND.purpleSecondary }} />
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <UploadIcon width={32} height={32} className="mx-auto mb-3" style={{ color: BRAND.purpleSecondary }} />
                  <p className="text-sm font-semibold mb-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>No Claims Yet</p>
                  <p className="text-xs mb-4" style={{ color: BRAND.purpleSecondary }}>Upload a claim PDF to get started with AI-powered auditing.</p>
                  <Button
                    size="sm"
                    className="gap-2 text-white"
                    style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                    onClick={() => setLocation("/upload")}
                  >
                    <UploadIcon width={16} height={16} />
                    Upload First Claim
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}

function StatCard({ label, value, icon, color, isScore, accent, onClick }: {
  label: string
  value: number | string
  icon: React.ReactNode
  color: string
  isScore?: boolean
  accent?: boolean
  onClick?: () => void
}) {
  const Tag = onClick ? "button" : "div" as any
  return (
    <Tag
      className={`p-4 md:p-5 rounded-lg border text-left ${onClick ? "cursor-pointer hover:shadow-md transition-all active:scale-[0.98]" : ""}`}
      style={{ backgroundColor: BRAND.white, borderColor: accent ? BRAND.goldLight : BRAND.greyLavender }}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] md:text-xs uppercase tracking-wider font-bold" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>{label}</p>
        <div className="p-1 rounded" style={{ backgroundColor: `${color}15`, color }}>{icon}</div>
      </div>
      <p className="text-2xl md:text-3xl font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>
        {value}
      </p>
      {onClick && (
        <p className="text-[10px] mt-1 flex items-center gap-0.5" style={{ color: BRAND.purple }}>View all <NavArrowRight width={10} height={10} /></p>
      )}
    </Tag>
  )
}
