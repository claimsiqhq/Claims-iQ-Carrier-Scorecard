import React, { useState, useCallback } from "react"
import {
  Shield,
  CheckCircle,
  PageSearch,
  WarningTriangle,
  NavArrowRight,
  NavArrowDown,
  Sparks,
  Folder,
  Page,
  SendMail,
  Xmark,
  Notes,
  Camera,
  MediaImage,
} from "iconoir-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { BRAND, FONTS } from "@/lib/brand"
import { useGetClaimDetail, getListClaimsQueryKey, getGetClaimDetailQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { useLocation } from "wouter"
import type { ScorecardCategory, ScorecardQuestion, AuditIssue, ValidationCheck } from "@workspace/api-client-react/src/generated/api.schemas"

function getScoreColor(pct: number): { text: string; bg: string; bar: string } {
  if (pct >= 90) return { text: "#16a34a", bg: "#f0fdf4", bar: "#16a34a" }
  if (pct >= 75) return { text: "#65a30d", bg: "#f7fee7", bar: "#65a30d" }
  if (pct >= 60) return { text: BRAND.gold, bg: "#fef9ec", bar: BRAND.gold }
  if (pct >= 40) return { text: "#ea580c", bg: "#fff7ed", bar: "#ea580c" }
  return { text: "#dc2626", bg: "#fef2f2", bar: "#dc2626" }
}

function scoreLabel(pct: number): string {
  if (pct >= 90) return "Excellent"
  if (pct >= 75) return "Good"
  if (pct >= 60) return "Fair"
  if (pct >= 40) return "Poor"
  return "Critical"
}

function readinessColor(r: string): string {
  if (r === "READY") return "#16a34a"
  if (r === "REVIEW") return "#ca8a04"
  return "#dc2626"
}

function readinessBg(r: string): string {
  if (r === "READY") return "#f0fdf4"
  if (r === "REVIEW") return "#fef9ec"
  return "#fef2f2"
}

function answerBadge(answer: string) {
  if (answer === "PASS" || answer === "pass") return { label: "PASS", color: "#16a34a", bg: "#f0fdf4" }
  if (answer === "PARTIAL" || answer === "partial") return { label: "PARTIAL", color: "#ca8a04", bg: "#fef9ec" }
  if (answer === "NOT_APPLICABLE" || answer === "na") return { label: "N/A", color: "#6b7280", bg: "#f3f4f6" }
  return { label: "FAIL", color: "#dc2626", bg: "#fef2f2" }
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function ClaimDetailPage({ claimId }: { claimId: string }) {
  const [, setLocation] = useLocation()
  const [auditing, setAuditing] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailPreviewHtml, setEmailPreviewHtml] = useState<string | null>(null)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailTo, setEmailTo] = useState("")
  const [emailSending, setEmailSending] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false)
  const [mobileDocOpen, setMobileDocOpen] = useState(false)
  const [docPanelOpen, setDocPanelOpen] = useState(true)
  const [hideScores, setHideScores] = useState(true)

  const queryClient = useQueryClient()
  const { data, isLoading, error, refetch } = useGetClaimDetail(claimId)

  const handleRunAudit = useCallback(async () => {
    setAuditing(true)
    setAuditError(null)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "/api"
      const res = await fetch(`${baseUrl}/claims/${claimId}/audit`, { method: "POST", credentials: "include" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Audit failed")
      }
      await refetch()
      queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() })
    } catch (err: any) {
      setAuditError(err.message || "Failed to run audit")
    } finally {
      setAuditing(false)
    }
  }, [claimId, refetch, queryClient])

  const handleDeleteClaim = useCallback(async () => {
    setDeleting(true)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "/api"
      const res = await fetch(`${baseUrl}/claims/${claimId}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Delete failed")
      }
      queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() })
      setLocation("/claims")
    } catch (err: any) {
      console.error("Delete failed:", err)
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }, [claimId, setLocation, queryClient])

  const handleOpenEmailModal = useCallback(async () => {
    setShowEmailModal(true)
    setEmailError(null)
    setEmailSent(false)
    setEmailLoading(true)
    setEmailPreviewHtml(null)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "/api"
      const res = await fetch(`${baseUrl}/claims/${claimId}/email`, { credentials: "include" })
      if (!res.ok) throw new Error("Failed to generate email preview")
      const { html } = await res.json()
      setEmailPreviewHtml(html)
    } catch (err: any) {
      setEmailError(err.message || "Failed to generate email preview")
    } finally {
      setEmailLoading(false)
    }
  }, [claimId])

  const handleSendEmail = useCallback(async () => {
    if (!emailTo) return
    setEmailSending(true)
    setEmailError(null)
    setEmailSent(false)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "/api"
      const res = await fetch(`${baseUrl}/claims/${claimId}/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emailTo }),
        credentials: "include",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Failed to send email")
      }
      setEmailSent(true)
      setTimeout(() => {
        setShowEmailModal(false)
        setEmailSent(false)
        setEmailTo("")
        setEmailPreviewHtml(null)
      }, 2000)
    } catch (err: any) {
      setEmailError(err.message || "Failed to send email")
    } finally {
      setEmailSending(false)
    }
  }, [claimId, emailTo])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
          <p className="text-sm" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>Loading claim...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: BRAND.offWhite }}>
        <p className="text-sm" style={{ color: BRAND.purpleSecondary }}>Failed to load claim data.</p>
      </div>
    )
  }

  const { claim, documents: docs, audit } = data
  const claimDetails = claim as unknown as Record<string, string | undefined>

  const overallPercent = audit?.overallScore ?? 0
  const daScore = audit?.daScore ?? 0
  const faScore = audit?.faScore ?? 0
  const daAwarded = audit?.daPointsAwarded ?? 0
  const daPossible = audit?.daPointsPossible ?? 100
  const faAwarded = audit?.faPointsAwarded ?? 0
  const faPossible = audit?.faPointsPossible ?? 100
  const readiness = audit?.readiness ?? audit?.approvalStatus ?? ""
  const technicalRisk = audit?.technicalRisk ?? audit?.riskLevel ?? ""
  const failedCount = audit?.failedCount ?? 0
  const partialCount = audit?.partialCount ?? 0
  const passedCount = audit?.passedCount ?? 0
  const actionRequiredCount = audit?.actionRequiredCount ?? 0
  const daCategories: ScorecardCategory[] = (audit?.daCategories ?? []) as ScorecardCategory[]
  const faCategories: ScorecardCategory[] = (audit?.faCategories ?? []) as ScorecardCategory[]
  const rootIssueGroups: any[] = (audit?.rootIssueGroups ?? []) as any[]
  const auditIssues: AuditIssue[] = (audit?.issues ?? []) as AuditIssue[]
  const validationChecks: ValidationCheck[] = (audit?.validationChecks ?? []) as ValidationCheck[]
  const visionAnalysis = (audit as any)?.visionAnalysis as VisionAnalysisData | null | undefined

  const claimFile = docs.length > 0 ? docs[0] : null
  const claimFileMeta = claimFile?.metadata as Record<string, unknown> | undefined
  const claimFileName = claimFile ? (claimFileMeta?.fileName as string || claimFile.type || "Claim File") : null

  const hasNewFormat = daCategories.length > 0 || faCategories.length > 0

  return (
    <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <header className="h-14 md:h-16 flex items-center justify-between px-3 md:px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <div className="flex items-center gap-2 text-sm min-w-0" style={{ color: BRAND.purpleSecondary }}>
          <span className="cursor-pointer hover:opacity-80 transition-opacity shrink-0" onClick={() => setLocation("/claims")}>Claims</span>
          <NavArrowRight width={16} height={16} className="shrink-0" />
          <span className="font-semibold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{claim.claimNumber}</span>
        </div>

        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          {audit && (
            <Button
              size="sm"
              className="gap-1 md:gap-2 text-white border-transparent text-xs md:text-sm"
              style={{ backgroundColor: BRAND.gold, fontFamily: FONTS.heading, fontWeight: 600 }}
              onClick={handleOpenEmailModal}
            >
              <SendMail width={16} height={16} />
              <span className="hidden sm:inline">Email Scorecard</span>
              <span className="sm:hidden">Email</span>
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        <div className="w-72 flex flex-col shrink-0 overflow-hidden hidden md:flex" style={{ backgroundColor: BRAND.white, borderRight: `1px solid ${BRAND.greyLavender}` }}>
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center justify-between" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                Claim Details
                <Badge className="shadow-none border-transparent text-xs font-semibold" style={{ backgroundColor: claim.status === "analyzed" ? "#e8f5e9" : BRAND.lightPurpleGrey, color: claim.status === "analyzed" ? "#2e7d32" : BRAND.purple }}>
                  {claim.status?.charAt(0).toUpperCase() + claim.status?.slice(1)}
                </Badge>
              </h2>

              <div className="space-y-3">
                <DetailItem label="Claim Number" value={claim.claimNumber} mono />
                <DetailItem label="Insured" value={claim.insuredName} />
                <DetailItem label="Date of Loss" value={claim.dateOfLoss ?? "N/A"} />
                <DetailItem label="Carrier" value={claim.carrier ?? "N/A"} />
                {claimDetails.policyNumber && <DetailItem label="Policy Number" value={claimDetails.policyNumber} mono />}
                {claimDetails.lossType && <DetailItem label="Loss Type" value={claimDetails.lossType} />}
                {claimDetails.propertyAddress && <DetailItem label="Property Address" value={claimDetails.propertyAddress} />}
                {claimDetails.adjuster && <DetailItem label="Adjuster" value={claimDetails.adjuster} />}
                {claimDetails.totalClaimAmount && <DetailItem label="Total Claim Amount" value={claimDetails.totalClaimAmount} mono />}
                {claimDetails.deductible && <DetailItem label="Deductible" value={claimDetails.deductible} mono />}
                {claimDetails.summary && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium uppercase tracking-wider" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>Summary</span>
                    <span className="text-xs leading-relaxed" style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>{claimDetails.summary}</span>
                  </div>
                )}
              </div>
            </div>

            <Separator style={{ backgroundColor: BRAND.greyLavender }} />

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                Claim File
              </h3>
              {claimFile ? (
                <div className="flex items-center gap-2 p-2 rounded-md" style={{ backgroundColor: BRAND.lightPurpleGrey, border: `1px solid ${BRAND.purpleLight}` }}>
                  <Page width={16} height={16} style={{ color: BRAND.purple }} />
                  <span className="text-sm truncate" style={{ color: BRAND.purple, fontWeight: 600, fontFamily: FONTS.body }}>
                    {claimFileName}
                  </span>
                </div>
              ) : (
                <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                  No file uploaded yet. Go to Upload / Ingest to add a claim file.
                </p>
              )}
            </div>

            <div className="pt-4 space-y-2">
              <Button
                className="w-full text-white font-semibold"
                style={{ backgroundColor: auditing ? BRAND.purpleSecondary : BRAND.purple, fontFamily: FONTS.heading }}
                onClick={handleRunAudit}
                disabled={auditing}
              >
                {auditing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Running Audit...
                  </span>
                ) : (
                  "Run Carrier Audit"
                )}
              </Button>
              {auditError && (
                <p className="text-xs text-center" style={{ color: "#dc2626" }}>{auditError}</p>
              )}
              {!showDeleteConfirm ? (
                <Button
                  variant="outline"
                  className="w-full text-xs"
                  style={{ borderColor: BRAND.greyLavender, color: BRAND.purpleSecondary }}
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete Claim
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 text-xs"
                    style={{ borderColor: BRAND.greyLavender, color: BRAND.purpleSecondary }}
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 text-xs text-white"
                    style={{ backgroundColor: deleting ? BRAND.purpleSecondary : "#dc2626" }}
                    onClick={handleDeleteClaim}
                    disabled={deleting}
                  >
                    {deleting ? "Deleting..." : "Confirm Delete"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 relative" style={{ backgroundColor: BRAND.offWhite }}>
          <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4 md:space-y-6">
            <div className="md:hidden flex gap-2">
              <Button
                className="flex-1 text-white font-semibold text-sm"
                style={{ backgroundColor: auditing ? BRAND.purpleSecondary : BRAND.purple, fontFamily: FONTS.heading }}
                onClick={handleRunAudit}
                disabled={auditing}
              >
                {auditing ? "Running..." : "Run Audit"}
              </Button>
              {audit && (
                <Button
                  size="sm"
                  className="gap-1 text-sm text-white"
                  style={{ backgroundColor: BRAND.gold, fontFamily: FONTS.heading, fontWeight: 600 }}
                  onClick={handleOpenEmailModal}
                >
                  <SendMail width={16} height={16} />
                  Email
                </Button>
              )}
              {!showDeleteConfirm ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-sm"
                  style={{ borderColor: "#fca5a5", color: "#dc2626" }}
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <WarningTriangle width={16} height={16} />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="gap-1 text-sm text-white"
                  style={{ backgroundColor: deleting ? BRAND.purpleSecondary : "#dc2626" }}
                  onClick={handleDeleteClaim}
                  disabled={deleting}
                >
                  {deleting ? "..." : "Confirm"}
                </Button>
              )}
            </div>

            {showDeleteConfirm && (
              <div className="md:hidden flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: "#fef2f2", border: "1px solid #fca5a5" }}>
                <WarningTriangle width={16} height={16} style={{ color: "#dc2626" }} className="shrink-0" />
                <p className="text-xs flex-1" style={{ color: "#dc2626" }}>This will permanently delete the claim, documents, and audit data.</p>
                <button
                  className="text-xs font-semibold shrink-0 underline"
                  style={{ color: BRAND.purpleSecondary }}
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            )}

            <Card className="md:hidden shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
              <button
                className="w-full flex items-center justify-between p-4"
                onClick={() => setMobileDetailsOpen(!mobileDetailsOpen)}
              >
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                    Claim Details
                  </h2>
                  <Badge className="shadow-none border-transparent text-xs font-semibold" style={{ backgroundColor: claim.status === "analyzed" ? "#e8f5e9" : BRAND.lightPurpleGrey, color: claim.status === "analyzed" ? "#2e7d32" : BRAND.purple }}>
                    {claim.status?.charAt(0).toUpperCase() + claim.status?.slice(1)}
                  </Badge>
                </div>
                <NavArrowDown
                  width={16} height={16}
                  className={`transition-transform duration-200 ${mobileDetailsOpen ? "rotate-180" : ""}`}
                  style={{ color: BRAND.purpleSecondary }}
                />
              </button>
              {mobileDetailsOpen && (
                <CardContent className="px-4 pb-4 pt-0 space-y-3">
                  <Separator style={{ backgroundColor: BRAND.greyLavender }} />
                  <DetailItem label="Claim Number" value={claim.claimNumber} mono />
                  <DetailItem label="Insured" value={claim.insuredName} />
                  <DetailItem label="Date of Loss" value={claim.dateOfLoss ?? "N/A"} />
                  <DetailItem label="Carrier" value={claim.carrier ?? "N/A"} />
                  {claimFile && (
                    <>
                      <Separator style={{ backgroundColor: BRAND.greyLavender }} />
                      <div className="flex items-center gap-2 p-2 rounded-md" style={{ backgroundColor: BRAND.lightPurpleGrey, border: `1px solid ${BRAND.purpleLight}` }}>
                        <Page width={16} height={16} style={{ color: BRAND.purple }} />
                        <span className="text-sm truncate" style={{ color: BRAND.purple, fontWeight: 600, fontFamily: FONTS.body }}>
                          {claimFileName}
                        </span>
                      </div>
                    </>
                  )}
                </CardContent>
              )}
            </Card>

            {claimFile && (
              <Card className="md:hidden shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
                <button
                  className="w-full flex items-center justify-between p-4"
                  onClick={() => setMobileDocOpen(!mobileDocOpen)}
                >
                  <div className="flex items-center gap-2">
                    <PageSearch width={16} height={16} style={{ color: BRAND.purple }} />
                    <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                      Extraction Preview
                    </h2>
                  </div>
                  <NavArrowDown
                    width={16} height={16}
                    className={`transition-transform duration-200 ${mobileDocOpen ? "rotate-180" : ""}`}
                    style={{ color: BRAND.purpleSecondary }}
                  />
                </button>
                {mobileDocOpen && (
                  <CardContent className="px-4 pb-4 pt-0">
                    <div className="rounded p-3 text-xs leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto" style={{ backgroundColor: BRAND.offWhite, border: `1px solid ${BRAND.greyLavender}`, color: BRAND.deepPurple, fontFamily: FONTS.mono, fontSize: "11px" }}>
                      {claimFile.extractedText
                        ? claimFile.extractedText
                        : (
                          <p className="text-center py-6" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body, fontSize: "13px" }}>
                            Text not yet extracted. Run a carrier audit or re-upload the file.
                          </p>
                        )}
                    </div>
                  </CardContent>
                )}
              </Card>
            )}

            {audit && (() => {
              const isAllstate = (claim.carrier || "").toLowerCase().includes("allstate")
              const headerTitle = isAllstate ? "Allstate Quality Review" : "Carrier Audit Score"
              const totalQuestions = failedCount + partialCount + passedCount

              const effectiveHide = isAllstate || hideScores

              return (
              <>
                {!isAllstate && (
                  <div className="flex items-center justify-end gap-2 px-1">
                    <Checkbox
                      id="hide-scores"
                      checked={hideScores}
                      onCheckedChange={(checked) => setHideScores(checked === true)}
                    />
                    <label htmlFor="hide-scores" className="text-xs font-medium cursor-pointer select-none" style={{ color: BRAND.purpleSecondary }}>
                      {hideScores ? "Show numeric scores" : "Hide numeric scores"}
                    </label>
                  </div>
                )}

                <Card className="shadow-sm overflow-hidden relative" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
                  <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: BRAND.purple }} />
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row items-start gap-6">
                      <div className="flex items-center gap-6">
                        <div className="relative w-24 h-24 flex items-center justify-center rounded-full shrink-0">
                          <svg className="w-full h-full transform -rotate-90 absolute top-0 left-0" viewBox="0 0 36 36">
                            <path strokeWidth="3" stroke={BRAND.lightPurpleGrey} fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <path strokeWidth="3" strokeDasharray={`${overallPercent}, 100`} strokeLinecap="round" stroke={getScoreColor(overallPercent).bar} fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                          </svg>
                          <div className="text-center">
                            {effectiveHide ? (
                              <span className="text-sm font-bold" style={{ color: getScoreColor(overallPercent).text, fontFamily: FONTS.heading }}>{scoreLabel(overallPercent)}</span>
                            ) : (
                              <>
                                <span className="text-3xl font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{overallPercent}</span>
                                <span className="text-xs block -mt-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>%</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div>
                          <h2 className="text-xl font-bold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{headerTitle}</h2>
                          {isAllstate ? (
                            <div className="space-y-2 mb-3">
                              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                                <div>
                                  <span className="text-lg font-bold" style={{ color: getScoreColor(daScore).text, fontFamily: FONTS.heading }}>{scoreLabel(daScore)}</span>
                                  <span className="text-xs block" style={{ color: BRAND.purpleSecondary }}>Desk Adjuster ({daCategories.length} categories)</span>
                                </div>
                                <div>
                                  <span className="text-lg font-bold" style={{ color: getScoreColor(faScore).text, fontFamily: FONTS.heading }}>{scoreLabel(faScore)}</span>
                                  <span className="text-xs block" style={{ color: BRAND.purpleSecondary }}>Field Adjuster ({faCategories.length} categories)</span>
                                </div>
                              </div>
                              {totalQuestions > 0 && (
                                <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                                  {totalQuestions} questions evaluated &middot; {passedCount} passed &middot; {partialCount} partial &middot; {failedCount} failed
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                              <div>
                                {hideScores ? (
                                  <span className="text-lg font-bold" style={{ color: getScoreColor(daScore).text, fontFamily: FONTS.heading }}>{scoreLabel(daScore)}</span>
                                ) : (
                                  <span className="text-lg font-bold" style={{ color: getScoreColor(daScore).text, fontFamily: FONTS.mono }}>{daScore}%</span>
                                )}
                                <span className="text-xs block" style={{ color: BRAND.purpleSecondary }}>DA Score{hideScores ? "" : ` (${daAwarded}/${daPossible})`}</span>
                              </div>
                              <div>
                                {hideScores ? (
                                  <span className="text-lg font-bold" style={{ color: getScoreColor(faScore).text, fontFamily: FONTS.heading }}>{scoreLabel(faScore)}</span>
                                ) : (
                                  <span className="text-lg font-bold" style={{ color: getScoreColor(faScore).text, fontFamily: FONTS.mono }}>{faScore}%</span>
                                )}
                                <span className="text-xs block" style={{ color: BRAND.purpleSecondary }}>FA Score{hideScores ? "" : ` (${faAwarded}/${faPossible})`}</span>
                              </div>
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Badge className="shadow-none border" style={{ backgroundColor: readinessBg(readiness), color: readinessColor(readiness), borderColor: readinessBg(readiness) }}>
                              {readiness || "N/A"}
                            </Badge>
                            <Badge className="shadow-none border" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple, borderColor: BRAND.purpleLight }}>
                              {technicalRisk ? `${technicalRisk} Risk` : "N/A"}
                            </Badge>
                            {actionRequiredCount > 0 && (
                              <Badge className="shadow-none border" style={{ backgroundColor: "#fef2f2", color: "#dc2626", borderColor: "#fca5a5" }}>
                                {actionRequiredCount} Action{actionRequiredCount !== 1 ? "s" : ""} Required
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      {hasNewFormat && !isAllstate && (
                        <div className="flex gap-4 text-xs mt-2 md:mt-0 md:ml-auto" style={{ color: BRAND.purpleSecondary }}>
                          <div className="text-center">
                            <span className="text-lg font-bold block" style={{ color: "#dc2626", fontFamily: FONTS.mono }}>{failedCount}</span>
                            <span>Failed</span>
                          </div>
                          <div className="text-center">
                            <span className="text-lg font-bold block" style={{ color: "#ca8a04", fontFamily: FONTS.mono }}>{partialCount}</span>
                            <span>Partial</span>
                          </div>
                          <div className="text-center">
                            <span className="text-lg font-bold block" style={{ color: "#16a34a", fontFamily: FONTS.mono }}>{passedCount}</span>
                            <span>Passed</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {hasNewFormat && (
                  <>
                    <ScorecardPanel
                      title={isAllstate ? "Allstate DA Scorecard" : "Desk Adjuster Scorecard"}
                      icon={<Shield width={18} height={18} />}
                      scorePct={daScore}
                      awarded={daAwarded}
                      possible={daPossible}
                      categories={daCategories}
                      accentColor={BRAND.purple}
                      hideScores={effectiveHide}
                      carrierMode={isAllstate ? "allstate" : "default"}
                    />

                    <ScorecardPanel
                      title={isAllstate ? "Allstate FA Scorecard" : "Field Adjuster Scorecard"}
                      icon={<PageSearch width={18} height={18} />}
                      scorePct={faScore}
                      awarded={faAwarded}
                      possible={faPossible}
                      categories={faCategories}
                      accentColor={BRAND.gold}
                      hideScores={effectiveHide}
                      carrierMode={isAllstate ? "allstate" : "default"}
                    />
                  </>
                )}

                <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
                  <CardHeader className="pb-3 pt-5 px-5">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                        <Sparks width={18} height={18} style={{ color: BRAND.gold }} />
                        Executive Summary
                      </CardTitle>
                      <Badge variant="outline" className="text-xs" style={{ color: BRAND.purple, backgroundColor: BRAND.lightPurpleGrey, borderColor: BRAND.purpleLight }}>AI Generated</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="px-5 pb-5">
                    <p className="text-sm leading-relaxed" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
                      {audit.executiveSummary}
                    </p>
                  </CardContent>
                </Card>

                {rootIssueGroups.length > 0 && (
                  <RootIssuePanel groups={rootIssueGroups} />
                )}

                {auditIssues.length > 0 && (
                  <IssueDetailsPanel issues={auditIssues} />
                )}

                {validationChecks.length > 0 && (
                  <ValidationPanel checks={validationChecks} />
                )}

                {visionAnalysis && (visionAnalysis.tool_readings?.length > 0 || visionAnalysis.damage_verifications?.length > 0 || visionAnalysis.sequence_issues?.length > 0) && (
                  <VisionAnalysisPanel vision={visionAnalysis} />
                )}
              </>
            )})()}

            {!audit && (
              <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
                <CardContent className="p-12 text-center">
                  <Sparks width={48} height={48} className="mx-auto mb-4" style={{ color: BRAND.purpleSecondary }} />
                  <h3 className="text-lg font-semibold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>No Audit Available</h3>
                  <p className="text-sm mb-6" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
                    This claim hasn't been audited yet. Run a carrier audit to get AI-powered scoring.
                  </p>
                  <Button
                    className="text-white font-semibold"
                    style={{ backgroundColor: auditing ? BRAND.purpleSecondary : BRAND.purple, fontFamily: FONTS.heading }}
                    onClick={handleRunAudit}
                    disabled={auditing}
                  >
                    {auditing ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Running Audit...
                      </span>
                    ) : (
                      "Run Carrier Audit"
                    )}
                  </Button>
                  {auditError && (
                    <p className="text-xs mt-2" style={{ color: "#dc2626" }}>{auditError}</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>

        <div className="hidden xl:flex shrink-0 relative" style={{ borderLeft: `1px solid ${BRAND.greyLavender}` }}>
          <button
            onClick={() => setDocPanelOpen((v) => !v)}
            className="absolute -left-3 top-4 z-10 w-6 h-6 rounded-full border flex items-center justify-center shadow-sm hover:shadow transition-all"
            style={{ backgroundColor: BRAND.white, borderColor: BRAND.greyLavender }}
            aria-label={docPanelOpen ? "Collapse document panel" : "Expand document panel"}
          >
            <NavArrowRight
              width={14}
              height={14}
              style={{
                color: BRAND.purpleSecondary,
                transform: docPanelOpen ? "rotate(0deg)" : "rotate(180deg)",
                transition: "transform 200ms ease",
              }}
            />
          </button>

          <div
            className="flex flex-col overflow-hidden transition-all duration-200 ease-in-out"
            style={{
              width: docPanelOpen ? 320 : 0,
              opacity: docPanelOpen ? 1 : 0,
              backgroundColor: BRAND.white,
            }}
          >
            <div className="p-4 shrink-0" style={{ borderBottom: `1px solid ${BRAND.greyLavender}`, minWidth: 320 }}>
              <h2 className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Document Viewer</h2>
              {claimFileName && (
                <p className="text-xs mt-1 truncate" style={{ color: BRAND.purpleSecondary }}>{claimFileName}</p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4" style={{ backgroundColor: BRAND.offWhite, minWidth: 320 }}>
              {claimFile ? (
                <div className="rounded shadow-sm w-full p-4 text-xs leading-relaxed whitespace-pre-wrap" style={{ backgroundColor: BRAND.white, border: `1px solid ${BRAND.greyLavender}`, color: BRAND.deepPurple, fontFamily: FONTS.mono, fontSize: "11px" }}>
                  {claimFile.extractedText
                    ? claimFile.extractedText
                    : (
                      <p className="text-center mt-12" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body, fontSize: "13px" }}>
                        Text not yet extracted. Run a carrier audit or re-upload the file.
                      </p>
                    )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full py-20">
                  <Page width={40} height={40} className="mb-3" style={{ color: BRAND.purpleSecondary }} />
                  <p className="text-sm font-semibold mb-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>No File Uploaded</p>
                  <p className="text-xs text-center" style={{ color: BRAND.purpleSecondary }}>
                    Upload a claim PDF via Upload / Ingest to view it here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" style={{ backgroundColor: "rgba(52, 42, 79, 0.5)" }} onClick={() => { setShowEmailModal(false); setEmailPreviewHtml(null) }} role="dialog" aria-label="Email scorecard">
          <div className="w-full md:max-w-3xl h-[90vh] md:h-[85vh] rounded-t-xl md:rounded-xl shadow-2xl flex flex-col overflow-hidden" style={{ backgroundColor: BRAND.white }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 shrink-0" style={{ borderBottom: `1px solid ${BRAND.greyLavender}` }}>
              <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                <SendMail width={20} height={20} style={{ color: BRAND.gold }} />
                Email Scorecard
              </h3>
              <button onClick={() => { setShowEmailModal(false); setEmailPreviewHtml(null) }} className="p-1 rounded hover:opacity-70 transition-opacity" style={{ color: BRAND.purpleSecondary }} aria-label="Close email modal">
                <Xmark width={20} height={20} />
              </button>
            </div>

            {emailLoading && !emailPreviewHtml && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
                  <p className="text-sm" style={{ color: BRAND.purpleSecondary }}>Generating preview...</p>
                </div>
              </div>
            )}

            {emailPreviewHtml && (
              <iframe
                srcDoc={emailPreviewHtml}
                className="flex-1 w-full border-0 min-h-0"
                title="Email preview"
                sandbox="allow-same-origin"
              />
            )}

            <div className="shrink-0 p-4 space-y-3" style={{ borderTop: `1px solid ${BRAND.greyLavender}`, backgroundColor: BRAND.offWhite }}>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs font-bold uppercase tracking-wider mb-1.5 block" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                    Recipient Email
                  </label>
                  <input
                    type="email"
                    placeholder="carrier-reviewer@example.com"
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors"
                    style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.body, backgroundColor: BRAND.white }}
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    onFocus={(e) => (e.target.style.borderColor = BRAND.purple)}
                    onBlur={(e) => (e.target.style.borderColor = BRAND.greyLavender)}
                    autoFocus
                  />
                </div>
                <Button
                  className="gap-2 text-white px-6 shrink-0"
                  style={{ backgroundColor: emailSending ? BRAND.purpleSecondary : BRAND.gold, fontFamily: FONTS.heading, fontWeight: 600 }}
                  onClick={handleSendEmail}
                  disabled={!emailTo || emailSending || emailSent || emailLoading}
                >
                  {emailSending ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Sending...
                    </span>
                  ) : emailSent ? (
                    "Sent!"
                  ) : (
                    <>
                      <SendMail width={16} height={16} />
                      Send
                    </>
                  )}
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                  <strong style={{ color: BRAND.deepPurple }}>From:</strong> john@claimsiq.ai &nbsp;·&nbsp;
                  <strong style={{ color: BRAND.deepPurple }}>Subject:</strong> Claims iQ Audit — {claim.claimNumber}
                </p>
              </div>

              {emailError && (
                <p className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}>{emailError}</p>
              )}

              {emailSent && (
                <p className="text-xs px-3 py-2 rounded-lg flex items-center gap-2" style={{ backgroundColor: "#e8f5e9", color: "#2e7d32" }}>
                  <CheckCircle width={14} height={14} /> Email sent successfully!
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function ScorecardPanel({ title, icon, scorePct, awarded, possible, categories, accentColor, hideScores = false, carrierMode = "default" }: {
  title: string
  icon: React.ReactNode
  scorePct: number
  awarded: number
  possible: number
  categories: ScorecardCategory[]
  accentColor: string
  hideScores?: boolean
  carrierMode?: "allstate" | "default"
}) {
  const isAllstate = carrierMode === "allstate"
  const [expanded, setExpanded] = useState(true)
  const colors = getScoreColor(scorePct)

  return (
    <Card className="shadow-sm overflow-hidden" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <button
        className="w-full flex items-center justify-between p-5 hover:bg-black/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded" style={{ backgroundColor: `${accentColor}14`, color: accentColor }}>
            {icon}
          </div>
          <span className="text-sm font-bold uppercase tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
            {title}
          </span>
          <Badge className="shadow-none border" style={{ backgroundColor: colors.bg, color: colors.text, borderColor: colors.bg }}>
            {(hideScores || isAllstate) ? scoreLabel(scorePct) : `${scorePct}% (${awarded}/${possible})`}
          </Badge>
          {isAllstate && (
            <span className="text-[10px] ml-1" style={{ color: BRAND.purpleSecondary }}>
              {categories.reduce((sum, c) => sum + c.questions.length, 0)} questions
            </span>
          )}
        </div>
        <NavArrowDown
          width={16} height={16}
          className="transition-transform duration-200"
          style={{ color: BRAND.purpleSecondary, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="px-5 pb-5 space-y-5" style={{ borderTop: `1px solid ${BRAND.greyLavender}` }}>
          <div className="pt-3 space-y-5">
            {categories.map((cat) => {
              const catPct = cat.points_possible > 0 ? Math.round((cat.points_awarded / cat.points_possible) * 100) : 0
              const catColors = getScoreColor(catPct)

              return (
                <div key={cat.category_key}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                      {cat.category_name}
                    </span>
                    {hideScores ? (
                      <span className="text-xs font-bold" style={{ color: catColors.text, fontFamily: FONTS.heading }}>
                        {scoreLabel(catPct)}
                      </span>
                    ) : (
                      <span className="text-sm font-bold" style={{ color: catColors.text, fontFamily: FONTS.mono }}>
                        {cat.points_awarded}<span className="text-xs font-normal" style={{ color: BRAND.purpleSecondary }}>/{cat.points_possible}</span>
                      </span>
                    )}
                  </div>

                  <div className="w-full h-1.5 rounded-full overflow-hidden mb-2" style={{ backgroundColor: catColors.bg }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${catPct}%`, backgroundColor: catColors.bar }} />
                  </div>

                  <div className="space-y-2 pl-4">
                    {cat.questions.map((q) => {
                      const badge = answerBadge(q.answer)
                      const showDetails = q.answer !== "PASS" && q.answer !== "NOT_APPLICABLE"
                      return (
                        <div key={q.id} className="flex items-start gap-2">
                          <span className="inline-flex items-center justify-center text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5" style={{ backgroundColor: badge.bg, color: badge.color, minWidth: "40px", textAlign: "center" }}>
                            {badge.label}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium" style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>
                                {humanize(q.id)}
                              </span>
                              {!hideScores && (
                                <span className="text-[10px] font-bold ml-2 shrink-0" style={{ color: badge.color, fontFamily: FONTS.mono }}>
                                  {q.points_awarded}/{q.points_possible}
                                </span>
                              )}
                            </div>
                            {showDetails && q.fix && (
                              <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "#16a34a", fontFamily: FONTS.body }}>
                                <strong>Fix:</strong> {q.fix}
                              </p>
                            )}
                            {showDetails && q.issue && (
                              <p className="text-[11px] mt-0.5 leading-relaxed italic" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
                                {q.issue}
                              </p>
                            )}
                            {showDetails && q.impact && (
                              <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: "#dc2626", fontFamily: FONTS.body }}>
                                <strong>Impact:</strong> {q.impact}
                              </p>
                            )}
                            {showDetails && q.evidence_locations && q.evidence_locations.length > 0 && (
                              <p className="text-[10px] mt-0.5 leading-relaxed pl-2" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono, borderLeft: `2px solid ${BRAND.greyLavender}` }}>
                                {q.evidence_locations.join(", ")}
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}

function RootIssuePanel({ groups }: { groups: any[] }) {
  const [expanded, setExpanded] = useState(true)

  const affectsAreDifferent = (g: any) => {
    const affects = (g.affects || []) as string[]
    if (affects.length <= 1 && affects[0] === g.root_issue) return false
    if (affects.length <= 1) return true
    return true
  }

  return (
    <Card className="shadow-sm overflow-hidden" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-black/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded" style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}>
            <WarningTriangle width={16} height={16} />
          </div>
          <span className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Root Issues</span>
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-xs font-bold rounded-full" style={{ backgroundColor: "#dc2626", color: "#fff" }}>
            {groups.length}
          </span>
        </div>
        <NavArrowDown
          width={16} height={16}
          className="transition-transform duration-200"
          style={{ color: BRAND.purpleSecondary, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px solid ${BRAND.greyLavender}` }}>
          <div className="pt-3 space-y-3">
            {groups.map((g: any, i: number) => (
              <Card key={i} className="shadow-sm" style={{ borderColor: "#fca5a5", backgroundColor: BRAND.white, borderLeftWidth: 3, borderLeftColor: "#dc2626" }}>
                <CardContent className="p-4 space-y-2">
                  <h4 className="text-sm font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                    {humanize(g.root_issue)}
                  </h4>
                  {g.issue && (
                    <p className="text-sm leading-relaxed" style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>
                      {g.issue}
                    </p>
                  )}
                  {g.impact && (
                    <div className="flex gap-2 items-start text-sm leading-relaxed" style={{ color: "#b91c1c", fontFamily: FONTS.body }}>
                      <span className="font-semibold shrink-0">Impact:</span>
                      <span>{g.impact}</span>
                    </div>
                  )}
                  {g.fix && (
                    <div className="flex gap-2 items-start text-sm leading-relaxed" style={{ color: "#15803d", fontFamily: FONTS.body }}>
                      <span className="font-semibold shrink-0">Fix:</span>
                      <span>{g.fix}</span>
                    </div>
                  )}
                  {affectsAreDifferent(g) && (
                    <p className="text-xs pt-1" style={{ color: BRAND.purpleSecondary }}>
                      Affects {(g.affects || []).length > 1 ? `${g.affects.length} audit checks: ` : ""}{(g.affects as string[]).map((a: string) => humanize(a)).join(", ")}
                    </p>
                  )}
                  {g.evidence_locations && g.evidence_locations.length > 0 && (
                    <p className="text-xs" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>
                      Evidence: {g.evidence_locations.join(", ")}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function IssueDetailsPanel({ issues }: { issues: AuditIssue[] }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <Card className="shadow-sm overflow-hidden" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-black/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded" style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}>
            <WarningTriangle width={16} height={16} />
          </div>
          <span className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Issue Details</span>
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-xs font-bold rounded-full" style={{ backgroundColor: "#dc2626", color: "#fff" }}>
            {issues.length}
          </span>
        </div>
        <NavArrowDown
          width={16} height={16}
          className="transition-transform duration-200"
          style={{ color: BRAND.purpleSecondary, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px solid ${BRAND.greyLavender}` }}>
          <div className="pt-3 space-y-3">
            {issues.map((iss, i) => {
              const isF = iss.severity === "fail"
              return (
                <Card key={i} className="shadow-sm" style={{ borderColor: isF ? "#fca5a5" : BRAND.greyLavender, backgroundColor: BRAND.white, borderLeftWidth: 3, borderLeftColor: isF ? "#dc2626" : BRAND.gold }}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="shadow-none text-[10px]" style={{ backgroundColor: iss.source_scorecard === "DA" ? BRAND.lightPurpleGrey : "#fef9ec", color: iss.source_scorecard === "DA" ? BRAND.purple : BRAND.gold, border: `1px solid ${iss.source_scorecard === "DA" ? BRAND.purpleLight : BRAND.goldLight}` }}>
                        {iss.source_scorecard}
                      </Badge>
                      <h4 className="text-sm font-semibold flex-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{humanize(iss.question_key)}</h4>
                      <Badge className="shadow-none text-xs" style={{ backgroundColor: isF ? "#fef2f2" : "#fef9ec", color: isF ? "#dc2626" : "#ca8a04" }}>
                        {isF ? "Fail" : "Partial"}
                      </Badge>
                    </div>
                    {iss.issue && <p className="text-sm leading-relaxed mb-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}><strong style={{ color: BRAND.deepPurple }}>Issue:</strong> {iss.issue}</p>}
                    {iss.impact && <p className="text-sm leading-relaxed mb-1" style={{ color: "#dc2626", fontFamily: FONTS.body }}><strong>Impact:</strong> {iss.impact}</p>}
                    {iss.fix && <p className="text-sm leading-relaxed mb-1" style={{ color: "#16a34a", fontFamily: FONTS.body }}><strong>Fix:</strong> {iss.fix}</p>}
                    {iss.evidence_locations && iss.evidence_locations.length > 0 && (
                      <p className="text-xs" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>Evidence: {iss.evidence_locations.join(", ")}</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}

function ValidationPanel({ checks }: { checks: ValidationCheck[] }) {
  const [expanded, setExpanded] = useState(false)

  const severityColor = (s: string) => {
    if (s === "critical") return "#dc2626"
    if (s === "warning") return "#ca8a04"
    return "#6b7280"
  }

  return (
    <Card className="shadow-sm overflow-hidden" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-black/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded" style={{ backgroundColor: "#fef9ec", color: "#ca8a04" }}>
            <Notes width={16} height={16} />
          </div>
          <span className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Validation Checks</span>
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-xs font-bold rounded-full" style={{ backgroundColor: "#ca8a04", color: "#fff" }}>
            {checks.length}
          </span>
        </div>
        <NavArrowDown
          width={16} height={16}
          className="transition-transform duration-200"
          style={{ color: BRAND.purpleSecondary, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="px-4 pb-4" style={{ borderTop: `1px solid ${BRAND.greyLavender}` }}>
          <div className="pt-3 space-y-2">
            {checks.map((c, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded" style={{ backgroundColor: BRAND.offWhite }}>
                <span className="inline-flex items-center justify-center text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 uppercase" style={{ backgroundColor: `${severityColor(c.severity)}14`, color: severityColor(c.severity), minWidth: "50px" }}>
                  {c.severity}
                </span>
                <span className="text-xs leading-relaxed" style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>{c.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

interface VisionToolReading {
  page_number: number
  tool_type: string
  tool_model: string
  reading_value: string
  reading_unit: string
  material_or_location: string
  confidence: number
}

interface VisionDamageVerification {
  page_number: number
  caption_claim: string
  damage_visible: boolean
  damage_type: string
  discrepancy: string
  confidence: number
}

interface VisionAnalysisData {
  analyzed_pages: number[]
  total_photo_pages: number
  tool_readings: VisionToolReading[]
  photo_labels: { page_number: number; label_path: string; caption: string; section_type: string; order_index: number }[]
  damage_verifications: VisionDamageVerification[]
  photo_sequence_valid: boolean
  sequence_issues: string[]
  diagnostics_summary: {
    moisture_readings_found: number
    thermal_readings_found: number
    laser_readings_found: number
    captions_verified: number
    captions_with_discrepancy: number
  }
}

function VisionAnalysisPanel({ vision }: { vision: VisionAnalysisData }) {
  const [expanded, setExpanded] = useState(true)

  const totalFindings = (vision.tool_readings?.length ?? 0) + (vision.damage_verifications?.length ?? 0) + (vision.sequence_issues?.length ?? 0)
  const discrepancies = vision.damage_verifications?.filter(d => !d.damage_visible).length ?? 0
  const ds = vision.diagnostics_summary

  const toolTypeLabel = (t: string) => {
    const labels: Record<string, string> = { moisture_meter: "Moisture Meter", thermal_imager: "Thermal Imager", laser_measure: "Laser Measure", tape_measure: "Tape Measure" }
    return labels[t] || humanize(t)
  }

  return (
    <Card className="shadow-sm overflow-hidden" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-black/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded" style={{ backgroundColor: "#ede9fe", color: BRAND.purple }}>
            <Camera width={16} height={16} />
          </div>
          <span className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Photo Analysis (Vision AI)</span>
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-xs font-bold rounded-full" style={{ backgroundColor: BRAND.purple, color: "#fff" }}>
            {totalFindings}
          </span>
          {discrepancies > 0 && (
            <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-xs font-bold rounded-full" style={{ backgroundColor: "#dc2626", color: "#fff" }}>
              {discrepancies} discrepanc{discrepancies !== 1 ? "ies" : "y"}
            </span>
          )}
        </div>
        <NavArrowDown
          width={16} height={16}
          className="transition-transform duration-200"
          style={{ color: BRAND.purpleSecondary, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="px-4 pb-4" style={{ borderTop: `1px solid ${BRAND.greyLavender}` }}>
          {ds && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-3 pb-3">
              <VisionStat label="Moisture" value={ds.moisture_readings_found} />
              <VisionStat label="Thermal" value={ds.thermal_readings_found} />
              <VisionStat label="Laser" value={ds.laser_readings_found} />
              <VisionStat label="Verified" value={ds.captions_verified} color="#16a34a" />
              <VisionStat label="Discrepancies" value={ds.captions_with_discrepancy} color={ds.captions_with_discrepancy > 0 ? "#dc2626" : undefined} />
            </div>
          )}

          {vision.tool_readings?.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Diagnostic Tool Readings</h4>
              <div className="space-y-1.5">
                {vision.tool_readings.map((tr, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded text-xs" style={{ backgroundColor: BRAND.offWhite }}>
                    <span className="inline-flex items-center justify-center text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 uppercase" style={{ backgroundColor: "#ede9fe", color: BRAND.purple, minWidth: "80px" }}>
                      {toolTypeLabel(tr.tool_type)}
                    </span>
                    <span className="font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{tr.reading_value} {tr.reading_unit}</span>
                    <span style={{ color: BRAND.purpleSecondary }}>at {tr.material_or_location}</span>
                    <span className="ml-auto text-[10px] shrink-0" style={{ color: BRAND.purpleSecondary }}>p.{tr.page_number}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {vision.damage_verifications?.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Damage Verifications</h4>
              <div className="space-y-1.5">
                {vision.damage_verifications.map((dv, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded text-xs" style={{ backgroundColor: dv.damage_visible ? "#f0fdf4" : "#fef2f2" }}>
                    <span className="inline-flex items-center justify-center text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 uppercase" style={{ backgroundColor: dv.damage_visible ? "#dcfce7" : "#fecaca", color: dv.damage_visible ? "#16a34a" : "#dc2626", minWidth: "60px" }}>
                      {dv.damage_visible ? "Confirmed" : "Mismatch"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium block" style={{ color: BRAND.deepPurple }}>{dv.caption_claim}</span>
                      {dv.damage_visible ? (
                        <span style={{ color: "#16a34a" }}>Visible: {dv.damage_type}</span>
                      ) : (
                        <span style={{ color: "#dc2626" }}>{dv.discrepancy || "Damage not visually confirmed"}</span>
                      )}
                    </div>
                    <span className="text-[10px] shrink-0 mt-0.5" style={{ color: BRAND.purpleSecondary }}>p.{dv.page_number}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {vision.sequence_issues?.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Photo Sequence Issues</h4>
              <div className="space-y-1.5">
                {vision.sequence_issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded text-xs" style={{ backgroundColor: "#fef9ec" }}>
                    <WarningTriangle width={14} height={14} className="shrink-0 mt-0.5" style={{ color: "#ca8a04" }} />
                    <span style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>{issue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!vision.photo_sequence_valid && vision.sequence_issues?.length === 0 && (
            <div className="flex items-center gap-2 p-2 rounded text-xs" style={{ backgroundColor: "#fef9ec" }}>
              <WarningTriangle width={14} height={14} style={{ color: "#ca8a04" }} />
              <span style={{ color: BRAND.deepPurple }}>Photo sequence could not be validated</span>
            </div>
          )}

          <div className="flex items-center gap-2 mt-3 text-[11px]" style={{ color: BRAND.purpleSecondary }}>
            <MediaImage width={12} height={12} />
            <span>{vision.total_photo_pages} photo page{vision.total_photo_pages !== 1 ? "s" : ""} analyzed across {vision.analyzed_pages?.length ?? 0} page{(vision.analyzed_pages?.length ?? 0) !== 1 ? "s" : ""}</span>
          </div>
        </div>
      )}
    </Card>
  )
}

function VisionStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center p-2 rounded" style={{ backgroundColor: BRAND.offWhite }}>
      <span className="text-lg font-bold block" style={{ color: color || BRAND.deepPurple, fontFamily: FONTS.mono }}>{value}</span>
      <span className="text-[10px] uppercase tracking-wider" style={{ color: BRAND.purpleSecondary }}>{label}</span>
    </div>
  )
}

function DetailItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wider" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>{label}</span>
      <span className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: mono ? FONTS.mono : FONTS.body }}>{value}</span>
    </div>
  )
}
