import { useState, useEffect, useMemo } from "react"
import { useLocation } from "wouter"
import { BRAND, FONTS } from "@/lib/brand"
import { Button } from "@/components/ui/button"
import {
  NavArrowRight,
  NavArrowLeft,
  Search,
  SortDown,
  SortUp,
  Plus,
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

type SortKey = "claimNumber" | "insuredName" | "carrier" | "status" | "dateOfLoss" | "createdAt"
type SortDir = "asc" | "desc"

function formatDate(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export default function DashboardPage() {
  const [, setLocation] = useLocation()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [carrierFilter, setCarrierFilter] = useState<string>("all")
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [page, setPage] = useState(1)
  const perPage = 10

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL || "/api"
    fetch(`${baseUrl}/dashboard`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filteredClaims = useMemo(() => {
    if (!data) return []
    let list = [...data.recentClaims]

    if (statusFilter !== "all") {
      list = list.filter((c) => c.status === statusFilter)
    }
    if (carrierFilter !== "all") {
      list = list.filter((c) => (c.carrier || "Unknown") === carrierFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (c) =>
          c.claimNumber.toLowerCase().includes(q) ||
          c.insuredName.toLowerCase().includes(q) ||
          (c.carrier || "").toLowerCase().includes(q)
      )
    }

    list.sort((a, b) => {
      let av: string | number = ""
      let bv: string | number = ""
      switch (sortKey) {
        case "claimNumber": av = a.claimNumber; bv = b.claimNumber; break
        case "insuredName": av = a.insuredName; bv = b.insuredName; break
        case "carrier": av = a.carrier || ""; bv = b.carrier || ""; break
        case "status": av = a.status; bv = b.status; break
        case "dateOfLoss": av = a.dateOfLoss || ""; bv = b.dateOfLoss || ""; break
        case "createdAt": av = a.createdAt || ""; bv = b.createdAt || ""; break
      }
      const cmp = String(av).localeCompare(String(bv))
      return sortDir === "asc" ? cmp : -cmp
    })

    return list
  }, [data, statusFilter, carrierFilter, searchQuery, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filteredClaims.length / perPage))
  const paginatedClaims = filteredClaims.slice((page - 1) * perPage, page * perPage)

  const uniqueCarriers = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    data.recentClaims.forEach((c) => set.add(c.carrier || "Unknown"))
    return Array.from(set).sort()
  }, [data])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

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

  const { stats } = data

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="px-6 md:px-8 py-6 md:py-8 max-w-[1200px]">

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold mb-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                Claims Audit Dashboard
              </h1>
              <p className="text-sm" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
                View and manage all active claims, review processed documents, track progress, and complete the audit workflow.
              </p>
            </div>
            <Button
              className="gap-2 text-white shrink-0 px-5 py-2.5 text-sm"
              style={{ backgroundColor: "#16a34a", fontFamily: FONTS.heading, fontWeight: 600, borderRadius: 8 }}
              onClick={() => setLocation("/claims")}
            >
              <Plus width={16} height={16} strokeWidth={2.5} />
              Create new claim
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <StatusCard
              label="Ready for Review"
              description="All items ready for review."
              count={stats.analyzedCount}
              borderColor={BRAND.purple}
              countColor={BRAND.purple}
            />
            <StatusCard
              label="In Progress"
              description="Claim processing underway."
              count={stats.pendingCount}
              borderColor={BRAND.gold}
              countColor={BRAND.gold}
            />
            <StatusCard
              label="Total Claims"
              description="All claims in system."
              count={stats.totalClaims}
              borderColor="#16a34a"
              countColor="#16a34a"
            />
          </div>

          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}>
            <div className="px-5 pt-5 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" style={{ borderBottom: `1px solid ${BRAND.greyLavender}` }}>
              <div>
                <h2 className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>My Claims</h2>
                <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>Today</p>
              </div>
              <span className="text-2xl font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{filteredClaims.length}</span>
            </div>

            <div className="px-5 py-3 flex flex-wrap items-center gap-2" style={{ borderBottom: `1px solid ${BRAND.greyLavender}`, backgroundColor: BRAND.offWhite }}>
              <FilterSelect
                label="Status"
                value={statusFilter}
                onChange={(v) => { setStatusFilter(v); setPage(1) }}
                options={[
                  { value: "all", label: "All" },
                  { value: "analyzed", label: "Ready For Review" },
                  { value: "pending", label: "Pending" },
                ]}
              />
              <FilterSelect
                label="Carrier"
                value={carrierFilter}
                onChange={(v) => { setCarrierFilter(v); setPage(1) }}
                options={[
                  { value: "all", label: "All" },
                  ...uniqueCarriers.map((c) => ({ value: c, label: c })),
                ]}
              />
              <div className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 ml-auto" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
                <Search width={14} height={14} style={{ color: BRAND.purpleSecondary }} />
                <input
                  type="text"
                  placeholder="Search"
                  className="text-sm outline-none bg-transparent w-28"
                  style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left" style={{ minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BRAND.greyLavender}` }}>
                    <SortableTh label="Claim Number" sortKey="claimNumber" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortableTh label="Insured Name" sortKey="insuredName" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortableTh label="Carrier" sortKey="carrier" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortableTh label="Status" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortableTh label="Date of Loss" sortKey="dateOfLoss" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortableTh label="Received Date" sortKey="createdAt" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedClaims.length > 0 ? paginatedClaims.map((c) => (
                    <tr
                      key={c.id}
                      className="cursor-pointer transition-colors hover:bg-black/[0.02]"
                      style={{ borderBottom: `1px solid ${BRAND.greyLavender}` }}
                      onClick={() => setLocation(`/claims/${c.id}`)}
                    >
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium" style={{ color: BRAND.purple, fontFamily: FONTS.mono }}>{c.claimNumber}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm" style={{ color: BRAND.deepPurple }}>{c.insuredName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm" style={{ color: BRAND.deepPurple }}>{c.carrier || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm" style={{ color: BRAND.deepPurple }}>{formatDate(c.dateOfLoss)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm" style={{ color: BRAND.deepPurple }}>{formatDate(c.createdAt)}</span>
                      </td>
                      <td className="px-4 py-3">
                        {c.overallScore !== null ? (
                          <span className="text-sm font-bold" style={{
                            color: c.overallScore >= 80 ? "#16a34a" : c.overallScore >= 60 ? BRAND.gold : "#dc2626",
                            fontFamily: FONTS.mono,
                          }}>
                            {c.overallScore}
                          </span>
                        ) : (
                          <span className="text-sm" style={{ color: BRAND.purpleSecondary }}>—</span>
                        )}
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center">
                        <p className="text-sm" style={{ color: BRAND.purpleSecondary }}>
                          {data.recentClaims.length === 0 ? "No claims yet. Upload a claim PDF to get started." : "No claims match your filters."}
                        </p>
                        {data.recentClaims.length === 0 && (
                          <Button
                            className="gap-2 text-white mt-3"
                            style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                            onClick={() => setLocation("/claims")}
                          >
                            <Plus width={16} height={16} />
                            Upload First Claim
                          </Button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {filteredClaims.length > 0 && (
              <div className="px-5 py-3 flex items-center justify-between text-sm" style={{ borderTop: `1px solid ${BRAND.greyLavender}`, backgroundColor: BRAND.offWhite }}>
                <span style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
                  {(page - 1) * perPage + 1}–{Math.min(page * perPage, filteredClaims.length)} of {filteredClaims.length}
                </span>
                <div className="flex items-center gap-1">
                  <PagButton onClick={() => setPage(1)} disabled={page === 1}>«</PagButton>
                  <PagButton onClick={() => setPage(page - 1)} disabled={page === 1}><NavArrowLeft width={14} height={14} /></PagButton>
                  <PagButton onClick={() => setPage(page + 1)} disabled={page === totalPages}><NavArrowRight width={14} height={14} /></PagButton>
                  <PagButton onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</PagButton>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

function StatusCard({ label, description, count, borderColor, countColor }: {
  label: string; description: string; count: number; borderColor: string; countColor: string
}) {
  return (
    <div
      className="rounded-xl border p-4 md:p-5 flex items-center justify-between"
      style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender, borderLeftWidth: 4, borderLeftColor: borderColor }}
    >
      <div>
        <p className="text-sm font-bold mb-0.5" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{label}</p>
        <p className="text-xs" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>{description}</p>
      </div>
      <span className="text-3xl md:text-4xl font-bold" style={{ color: countColor, fontFamily: FONTS.mono }}>{count}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string }> = {
    analyzed: { bg: "#e8f5e9", text: "#2e7d32" },
    pending: { bg: "#fef9ec", text: BRAND.gold },
    approved: { bg: "#e3f2fd", text: "#1565c0" },
    denied: { bg: "#fef2f2", text: "#dc2626" },
  }
  const s = styles[status] || { bg: BRAND.lightPurpleGrey, text: BRAND.purple }
  const labelMap: Record<string, string> = {
    analyzed: "Ready For Review",
    pending: "In Progress",
    approved: "Approved",
    denied: "Denied",
  }
  return (
    <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-md" style={{ backgroundColor: s.bg, color: s.text, fontFamily: FONTS.heading }}>
      {labelMap[status] || status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <div className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <span className="text-xs font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{label}</span>
      <select
        className="text-xs outline-none bg-transparent cursor-pointer"
        style={{ color: BRAND.purple, fontFamily: FONTS.body }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function SortableTh({ label, sortKey, currentKey, dir, onSort }: {
  label: string; sortKey: SortKey; currentKey: SortKey; dir: SortDir; onSort: (k: SortKey) => void
}) {
  const isActive = sortKey === currentKey
  return (
    <th
      className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none hover:bg-black/[0.02] transition-colors whitespace-nowrap"
      style={{ color: isActive ? BRAND.deepPurple : BRAND.purpleSecondary, fontFamily: FONTS.heading }}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          dir === "asc" ? <SortUp width={12} height={12} /> : <SortDown width={12} height={12} />
        ) : (
          <span className="w-3" />
        )}
      </span>
    </th>
  )
}

function PagButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <button
      className="w-8 h-8 flex items-center justify-center rounded-md border text-xs font-medium transition-colors disabled:opacity-40"
      style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.white }}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
