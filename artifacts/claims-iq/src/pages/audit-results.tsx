import { BRAND, FONTS } from "@/lib/brand"
import { useListClaims } from "@workspace/api-client-react"
import { useLocation } from "wouter"
import { ClipboardCheck, WarningTriangle, Check, Eye } from "iconoir-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import CarrierScorecardPanel, { type CarrierScorecardResult } from "@/components/inspection/CarrierScorecardPanel"
import { useState } from "react"

export default function AuditResultsPage() {
  const { data: claims, isLoading } = useListClaims()
  const [, setLocation] = useLocation()
  const [reportText, setReportText] = useState("")
  const [reportPdfFile, setReportPdfFile] = useState<File | null>(null)
  const [runningStandaloneAudit, setRunningStandaloneAudit] = useState(false)
  const [standaloneAuditError, setStandaloneAuditError] = useState<string | null>(null)
  const [standaloneAudit, setStandaloneAudit] = useState<CarrierScorecardResult | null>(null)
  const [emailTo, setEmailTo] = useState("")
  const [sendingStandaloneEmail, setSendingStandaloneEmail] = useState(false)
  const [standaloneEmailStatus, setStandaloneEmailStatus] = useState<string | null>(null)

  const analyzedClaims = claims?.filter((c) => c.status === "analyzed") ?? []
  const pendingClaims = claims?.filter((c) => c.status === "pending") ?? []

  const handleRunStandaloneAudit = async () => {
    if (!reportText.trim() && !reportPdfFile) {
      setStandaloneAuditError("Paste final report text or upload a PDF before running the standalone audit.")
      return
    }

    setRunningStandaloneAudit(true)
    setStandaloneAuditError(null)
    setStandaloneEmailStatus(null)
    setStandaloneAudit(null)

    try {
      const baseUrl = import.meta.env.VITE_API_URL || "/api"
      let response: Response

      if (reportPdfFile) {
        const formData = new FormData()
        formData.append("file", reportPdfFile)
        if (reportText.trim()) {
          formData.append("reportText", reportText.trim())
        }
        response = await fetch(`${baseUrl}/audit/standalone`, {
          method: "POST",
          credentials: "include",
          body: formData,
        })
      } else {
        response = await fetch(`${baseUrl}/audit/standalone`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportText }),
        })
      }

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || "Standalone audit failed")
      }

      setStandaloneAudit(body as CarrierScorecardResult)
    } catch (err: any) {
      setStandaloneAuditError(err.message || "Standalone audit failed")
    } finally {
      setRunningStandaloneAudit(false)
    }
  }

  const handleSendStandaloneEmail = async () => {
    if (!standaloneAudit) return
    if (!emailTo.trim()) {
      setStandaloneEmailStatus("Enter a recipient email first.")
      return
    }

    setSendingStandaloneEmail(true)
    setStandaloneEmailStatus(null)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "/api"
      const response = await fetch(`${baseUrl}/audit/standalone/email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailTo.trim(),
          audit: standaloneAudit,
          subject: "Carrier Scorecard Audit",
        }),
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || "Failed to send carrier scorecard email")
      }
      setStandaloneEmailStatus("Carrier scorecard email sent.")
    } catch (err: any) {
      setStandaloneEmailStatus(err.message || "Failed to send carrier scorecard email")
    } finally {
      setSendingStandaloneEmail(false)
    }
  }

  if (isLoading) {
    return (
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 md:h-16 flex items-center px-4 md:px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
          <h1 className="text-base md:text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Audit Results</h1>
        </header>
        <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: BRAND.offWhite }}>
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-14 md:h-16 flex items-center px-4 md:px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <h1 className="text-base md:text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Audit Results</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-4xl mx-auto">
          <div className="rounded-lg border p-4 md:p-5 mb-6 space-y-4" style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
              Standalone Carrier Scorecard Audit
            </h2>
            <p className="text-xs leading-relaxed" style={{ color: BRAND.purpleSecondary }}>
              Paste final report package text or upload one PDF to run a strict standalone carrier scorecard audit.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider block" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                Optional PDF Upload
              </label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null
                  setReportPdfFile(file)
                }}
                className="w-full rounded-lg border p-2 text-xs"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.body }}
              />
              {reportPdfFile && (
                <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                  Selected PDF: {reportPdfFile.name}
                </p>
              )}
            </div>

            <textarea
              value={reportText}
              onChange={(event) => setReportText(event.target.value)}
              placeholder="Paste final report text here (optional if a PDF is uploaded)..."
              className="w-full min-h-[160px] rounded-lg border p-3 text-sm outline-none"
              style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.body }}
            />

            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <Button
                className="text-white"
                style={{ backgroundColor: runningStandaloneAudit ? BRAND.purpleSecondary : BRAND.purple, fontFamily: FONTS.heading }}
                onClick={handleRunStandaloneAudit}
                disabled={runningStandaloneAudit}
              >
                {runningStandaloneAudit ? "Running..." : "Run Standalone Audit"}
              </Button>
              {standaloneAuditError && (
                <span className="text-xs" style={{ color: "#dc2626" }}>{standaloneAuditError}</span>
              )}
            </div>

            {standaloneAudit && (
              <div className="space-y-3">
                <CarrierScorecardPanel audit={standaloneAudit} />
                <div className="rounded-lg border p-3 flex flex-col md:flex-row gap-3 md:items-center" style={{ borderColor: BRAND.greyLavender }}>
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(event) => setEmailTo(event.target.value)}
                    placeholder="carrier-reviewer@example.com"
                    className="w-full md:flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.body }}
                  />
                  <Button
                    className="text-white"
                    style={{ backgroundColor: sendingStandaloneEmail ? BRAND.purpleSecondary : BRAND.gold, fontFamily: FONTS.heading }}
                    onClick={handleSendStandaloneEmail}
                    disabled={sendingStandaloneEmail}
                  >
                    {sendingStandaloneEmail ? "Sending..." : "Send Scorecard Email"}
                  </Button>
                </div>
                {standaloneEmailStatus && (
                  <p className="text-xs" style={{ color: standaloneEmailStatus.includes("sent") ? "#166534" : "#dc2626" }}>
                    {standaloneEmailStatus}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
            <div className="p-3 md:p-5 rounded-lg border" style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}>
              <p className="text-[10px] md:text-xs uppercase tracking-wider mb-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>Total Claims</p>
              <p className="text-xl md:text-2xl font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{claims?.length ?? 0}</p>
            </div>
            <div className="p-3 md:p-5 rounded-lg border" style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}>
              <p className="text-[10px] md:text-xs uppercase tracking-wider mb-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>Audited</p>
              <p className="text-xl md:text-2xl font-bold" style={{ color: "#16a34a", fontFamily: FONTS.mono }}>{analyzedClaims.length}</p>
            </div>
            <div className="p-3 md:p-5 rounded-lg border" style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}>
              <p className="text-[10px] md:text-xs uppercase tracking-wider mb-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>Pending Audit</p>
              <p className="text-xl md:text-2xl font-bold" style={{ color: BRAND.gold, fontFamily: FONTS.mono }}>{pendingClaims.length}</p>
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
