import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useLocation } from "wouter"
import { BRAND, FONTS } from "@/lib/brand"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  NavArrowRight,
  NavArrowLeft,
  Search,
  SortDown,
  SortUp,
  Plus,
  CloudUpload,
  CheckCircle,
  Page,
  RefreshDouble,
  ArrowRight,
  Mail,
  SendDiagonal,
  Xmark,
  WarningTriangle,
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

type ItemStatus = "queued" | "extracting" | "parsing" | "auditing" | "emailing" | "complete" | "error"

interface QueueItem {
  id: string
  file: File
  status: ItemStatus
  error?: string
  claimId?: string
  claimNumber?: string
  insuredName?: string
}

interface ParsedClaimData {
  claimNumber: string
  insuredName: string
  carrier: string
  dateOfLoss: string
  policyNumber: string
  lossType: string
  propertyAddress: string
  adjusterName: string
  adjusterCompany: string
  totalClaimAmount: string
  deductible: string
  summary: string
}

interface IngestResult {
  claim: { id: string; claimNumber: string; insuredName: string; carrier: string; dateOfLoss: string; status: string }
  document: { id: string; fileName: string; storagePath: string }
}

interface ProcessingStatus {
  status: "processing" | "ready" | "error"
  error?: string
  claimNumber?: string
  insuredName?: string
  carrier?: string
  dateOfLoss?: string
}

function formatDate(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export default function DashboardPage() {
  const [, setLocation] = useLocation()
  const baseUrl = import.meta.env.VITE_API_URL || "/api"
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [carrierFilter, setCarrierFilter] = useState<string>("all")
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [page, setPage] = useState(1)
  const perPage = 10

  const [queue, setQueue] = useState<QueueItem[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [emailTo, setEmailTo] = useState("")
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)
  const queueRef = useRef<QueueItem[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchDashboard = useCallback(() => {
    fetch(`${baseUrl}/dashboard`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [baseUrl])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])

  const updateItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item))
  }, [])

  const addFiles = useCallback((files: FileList | File[]) => {
    const newItems: QueueItem[] = []
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") continue
      newItems.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, status: "queued" })
    }
    if (newItems.length > 0) setQueue((prev) => [...prev, ...newItems])
  }, [])

  const pollProcessingStatus = useCallback(async (claimId: string): Promise<ProcessingStatus> => {
    const maxAttempts = 200
    const intervalMs = 3000
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, intervalMs))
      try {
        const res = await fetch(`${baseUrl}/claims/${claimId}/processing-status`, { credentials: "include" })
        if (!res.ok) continue
        const data: ProcessingStatus = await res.json()
        if (data.status !== "processing") return data
      } catch { /* retry */ }
    }
    return { status: "error", error: "Processing timed out" }
  }, [baseUrl])

  const processItem = useCallback(async (item: QueueItem, email: string) => {
    const baseApiUrl = baseUrl
    try {
      updateItem(item.id, { status: "extracting" })
      const formData = new FormData()
      formData.append("file", item.file)

      const ingestRes = await fetch(`${baseApiUrl}/ingest`, {
        method: "POST",
        body: formData,
        credentials: "include",
      })

      if (!ingestRes.ok) {
        const errBody = await ingestRes.json().catch(() => ({ error: "Processing failed" }))
        throw new Error(errBody.error || "Processing failed")
      }

      const result: IngestResult = await ingestRes.json()
      updateItem(item.id, { status: "extracting", claimId: result.claim.id })

      const processingResult = await pollProcessingStatus(result.claim.id)
      if (processingResult.status === "error") {
        throw new Error(processingResult.error || "Extraction failed")
      }

      updateItem(item.id, {
        status: "auditing",
        claimNumber: processingResult.claimNumber,
        insuredName: processingResult.insuredName,
      })

      const auditRes = await fetch(`${baseApiUrl}/claims/${result.claim.id}/audit`, {
        method: "POST",
        credentials: "include",
      })

      if (!auditRes.ok) {
        const errBody = await auditRes.json().catch(() => ({ error: "Audit failed" }))
        throw new Error(errBody.error || "Audit failed")
      }

      if (email) {
        updateItem(item.id, { status: "emailing" })
        const emailRes = await fetch(`${baseApiUrl}/claims/${result.claim.id}/email/send`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: email }),
        })
        if (!emailRes.ok) {
          const errBody = await emailRes.json().catch(() => ({ error: "Email failed" }))
          throw new Error(errBody.error || "Failed to send email")
        }
      }

      updateItem(item.id, { status: "complete" })
    } catch (err: any) {
      updateItem(item.id, { status: "error", error: err.message || "Processing failed" })
    }
  }, [baseUrl, updateItem, pollProcessingStatus])

  useEffect(() => { queueRef.current = queue }, [queue])

  const startProcessing = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true
    setProcessing(true)

    const email = emailTo.trim()
    const snapshot = [...queueRef.current]

    for (const item of snapshot) {
      if (item.status !== "queued") continue
      await processItem(item, email)
    }

    processingRef.current = false
    setProcessing(false)
    fetchDashboard()
  }, [emailTo, processItem, fetchDashboard])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }, [addFiles])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) addFiles(e.target.files)
    if (e.target) e.target.value = ""
  }, [addFiles])

  const handleClearQueue = useCallback(() => {
    setQueue([])
    setEmailTo("")
  }, [])

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const hasQueued = queue.some((i) => i.status === "queued")
  const hasActive = queue.some((i) => i.status !== "queued" && i.status !== "complete" && i.status !== "error")
  const allDone = queue.length > 0 && queue.every((i) => i.status === "complete" || i.status === "error")
  const completedCount = queue.filter((i) => i.status === "complete").length
  const errorCount = queue.filter((i) => i.status === "error").length

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
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={handleInputChange}
      />

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
              onClick={() => fileInputRef.current?.click()}
              disabled={processing}
            >
              <Plus width={16} height={16} strokeWidth={2.5} />
              Upload Claims
            </Button>
          </div>

          {queue.length > 0 && (
            <Card className="shadow-sm mb-6" style={{ borderColor: processing ? BRAND.purple : allDone ? "#bbf7d0" : BRAND.greyLavender, backgroundColor: BRAND.white }}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: allDone ? "#e8f5e9" : `${BRAND.purple}14` }}>
                      {processing ? (
                        <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
                      ) : allDone ? (
                        <CheckCircle width={20} height={20} style={{ color: "#16a34a" }} />
                      ) : (
                        <CloudUpload width={20} height={20} style={{ color: BRAND.purple }} />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                        {processing
                          ? `Processing ${queue.length} file${queue.length > 1 ? "s" : ""}...`
                          : allDone
                            ? `${completedCount} of ${queue.length} complete${errorCount > 0 ? ` (${errorCount} failed)` : ""}`
                            : `${queue.length} file${queue.length > 1 ? "s" : ""} ready`}
                      </p>
                      {processing && (
                        <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                          {completedCount} done, {queue.filter((i) => i.status !== "queued" && i.status !== "complete" && i.status !== "error").length} in progress, {queue.filter((i) => i.status === "queued").length} waiting
                        </p>
                      )}
                    </div>
                  </div>
                  {!processing && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs"
                      style={{ color: BRAND.purpleSecondary }}
                      onClick={handleClearQueue}
                    >
                      Clear All
                    </Button>
                  )}
                </div>

                <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
                  {queue.map((item) => (
                    <QueueItemRow
                      key={item.id}
                      item={item}
                      onRemove={removeFromQueue}
                      onView={(id) => setLocation(`/claims/${id}`)}
                      canRemove={!processing && item.status === "queued"}
                    />
                  ))}
                </div>

                {hasQueued && !processing && (
                  <>
                    <div className="mb-4">
                      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
                        Email audit reports to (optional — applies to all)
                      </label>
                      <div className="relative">
                        <Mail width={16} height={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: BRAND.purpleSecondary }} />
                        <input
                          type="email"
                          placeholder="recipient@example.com"
                          value={emailTo}
                          onChange={(e) => setEmailTo(e.target.value)}
                          className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border outline-none focus:ring-2 transition-all"
                          style={{
                            borderColor: BRAND.greyLavender,
                            backgroundColor: BRAND.offWhite,
                            color: BRAND.deepPurple,
                            fontFamily: FONTS.body,
                          }}
                          onFocus={(e) => { e.target.style.borderColor = BRAND.purple; e.target.style.boxShadow = `0 0 0 2px ${BRAND.purple}22` }}
                          onBlur={(e) => { e.target.style.borderColor = BRAND.greyLavender; e.target.style.boxShadow = "none" }}
                        />
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        className="flex-1 gap-2 text-white py-2.5"
                        style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                        onClick={startProcessing}
                      >
                        <SendDiagonal width={16} height={16} />
                        {emailTo.trim()
                          ? `Upload, Audit & Email (${queue.filter((i) => i.status === "queued").length})`
                          : `Upload & Audit (${queue.filter((i) => i.status === "queued").length})`}
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2 shrink-0"
                        style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.heading, fontWeight: 600 }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Plus width={14} height={14} />
                        Add More
                      </Button>
                    </div>
                  </>
                )}

                {allDone && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 gap-2"
                      style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.heading, fontWeight: 600 }}
                      onClick={handleClearQueue}
                    >
                      <RefreshDouble width={14} height={14} />
                      Upload More
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

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

          <div
            className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {dragOver && (
              <div className="px-5 py-4 flex items-center justify-center gap-2" style={{ backgroundColor: BRAND.lightPurpleGrey, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
                <CloudUpload width={18} height={18} style={{ color: BRAND.purple }} />
                <p className="text-sm font-semibold" style={{ color: BRAND.purple }}>Drop PDF here to create a new claim</p>
              </div>
            )}

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
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <CloudUpload width={16} height={16} />
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

const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  queued: "Queued",
  extracting: "Extracting text...",
  parsing: "Analyzing claim...",
  auditing: "Running audit...",
  emailing: "Sending email...",
  complete: "Complete",
  error: "Failed",
}

function QueueItemRow({ item, onRemove, onView, canRemove }: {
  item: QueueItem
  onRemove: (id: string) => void
  onView: (claimId: string) => void
  canRemove: boolean
}) {
  const isActive = item.status !== "queued" && item.status !== "complete" && item.status !== "error"
  const steps: ItemStatus[] = ["extracting", "parsing", "auditing"]
  const currentIdx = steps.indexOf(item.status as ItemStatus)
  const progress = item.status === "complete" ? 100
    : item.status === "emailing" ? 90
    : item.status === "error" ? 0
    : item.status === "queued" ? 0
    : Math.max(10, ((currentIdx + 1) / steps.length) * 80)

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
      style={{
        borderColor: item.status === "error" ? "#fca5a5" : item.status === "complete" ? "#bbf7d0" : isActive ? BRAND.purple + "40" : BRAND.greyLavender,
        backgroundColor: item.status === "error" ? "#fef2f2" : item.status === "complete" ? "#f0fdf4" : isActive ? BRAND.purple + "06" : BRAND.offWhite,
      }}
    >
      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{
        backgroundColor: item.status === "error" ? "#fef2f2" : item.status === "complete" ? "#e8f5e9" : isActive ? `${BRAND.purple}14` : BRAND.lightPurpleGrey,
      }}>
        {item.status === "complete" ? (
          <CheckCircle width={16} height={16} style={{ color: "#16a34a" }} />
        ) : item.status === "error" ? (
          <WarningTriangle width={16} height={16} style={{ color: "#dc2626" }} />
        ) : isActive ? (
          <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
        ) : (
          <Page width={16} height={16} style={{ color: BRAND.purpleSecondary }} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
            {item.claimNumber || item.file.name}
          </p>
          {item.insuredName && (
            <span className="text-[10px] truncate" style={{ color: BRAND.purpleSecondary }}>
              {item.insuredName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px]" style={{ color: item.status === "error" ? "#dc2626" : isActive ? BRAND.purple : BRAND.purpleSecondary, fontFamily: FONTS.body, fontWeight: isActive ? 600 : 400 }}>
            {item.status === "error" ? item.error || "Failed" : ITEM_STATUS_LABELS[item.status]}
          </span>
          {isActive && (
            <div className="flex-1 h-1 rounded-full max-w-[100px]" style={{ backgroundColor: BRAND.greyLavender }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, backgroundColor: BRAND.purple }} />
            </div>
          )}
        </div>
      </div>

      {item.status === "complete" && item.claimId && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-xs gap-1 px-2 py-1"
          style={{ color: BRAND.purple, fontFamily: FONTS.heading }}
          onClick={() => onView(item.claimId!)}
        >
          View
          <ArrowRight width={12} height={12} />
        </Button>
      )}

      {canRemove && (
        <button
          className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors"
          onClick={() => onRemove(item.id)}
        >
          <Xmark width={14} height={14} style={{ color: BRAND.purpleSecondary }} />
        </button>
      )}
    </div>
  )
}

function DataField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>{label}</p>
      <p className="text-sm" style={{ color: BRAND.deepPurple, fontFamily: mono ? FONTS.mono : FONTS.body }}>{value}</p>
    </div>
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
