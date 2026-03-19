import React, { useState, useCallback } from "react"
import {
  Shield,
  CheckCircle,
  PageSearch,
  DollarCircle,
  WarningTriangle,
  NavArrowRight,
  NavArrowDown,
  Sparks,
  Folder,
  Page,
  SendMail,
  Xmark,
  Notes,
} from "iconoir-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { BRAND, FONTS } from "@/lib/brand"
import { useGetClaimDetail, getListClaimsQueryKey, getGetClaimDetailQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { useLocation } from "wouter"

const SECTION_LABELS: Record<string, string> = {
  coverage: "Coverage & Liability",
  scope: "Scope Completeness",
  financial: "Financial Accuracy",
  documentation: "Documentation Quality",
  presentation: "Presentation & Readiness",
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  coverage: <Shield width={16} height={16} />,
  scope: <CheckCircle width={16} height={16} />,
  financial: <DollarCircle width={16} height={16} />,
  documentation: <Notes width={16} height={16} />,
  presentation: <Folder width={16} height={16} />,
}

const QUESTION_LABELS: Record<string, string> = {
  cause_of_loss: "Is cause of loss clearly stated?",
  coverage_applied: "Is coverage applied correctly?",
  exclusions_addressed: "Are exclusions addressed?",
  policy_provisions: "Are policy provisions addressed?",
  damage_accounted: "Is all damage accounted for?",
  deferred_items: "Are deferred items clearly explained?",
  payment_consistency: "Do payment values match?",
  deductible_correct: "Is deductible correct?",
  photo_alignment: "Are photos aligned to estimate?",
  fa_support: "Does FA support estimate?",
  file_order: "Is file stack logical?",
  da_quality: "Is DA report concise?",
}

const QUESTION_SECTIONS: Record<string, string> = {
  cause_of_loss: "coverage",
  coverage_applied: "coverage",
  exclusions_addressed: "coverage",
  policy_provisions: "coverage",
  damage_accounted: "scope",
  deferred_items: "scope",
  payment_consistency: "financial",
  deductible_correct: "financial",
  photo_alignment: "documentation",
  fa_support: "documentation",
  file_order: "presentation",
  da_quality: "presentation",
}

function getScoreColor(score: number, max: number): { text: string; bg: string; bar: string } {
  const pct = max > 0 ? (score / max) * 100 : 0
  if (pct >= 80) return { text: "#16a34a", bg: "#f0fdf4", bar: "#16a34a" }
  if (pct >= 60) return { text: BRAND.gold, bg: "#fef9ec", bar: BRAND.gold }
  return { text: "#dc2626", bg: "#fef2f2", bar: "#dc2626" }
}

export default function ClaimDetailPage({ claimId }: { claimId: string }) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    defects: true,
  })
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
  const technicalScore = audit?.technicalScore ?? 0
  const technicalMax = audit?.technicalMax ?? 27
  const presentationScore = audit?.presentationScore ?? 0
  const presentationMax = audit?.presentationMax ?? 10
  const sections = audit?.sections ?? []
  const findings = audit?.findings ?? []

  const sectionScoreMap: Record<string, number> = {}
  const sectionMaxMap: Record<string, number> = {}
  for (const s of sections) {
    sectionScoreMap[s.section] = s.score
    sectionMaxMap[s.section] = s.max ?? 0
  }

  const questionResults = findings.filter((f) => f.type === "question_result")
  const defects = findings.filter((f) => f.type === "defect")

  const claimFile = docs.length > 0 ? docs[0] : null
  const claimFileMeta = claimFile?.metadata as Record<string, unknown> | undefined
  const claimFileName = claimFile ? (claimFileMeta?.fileName as string || claimFile.type || "Claim File") : null

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

            {audit && (
              <>
                <Card className="shadow-sm overflow-hidden relative" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
                  <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: BRAND.purple }} />
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row items-center gap-6">
                      <div className="flex items-center gap-6">
                        <div className="relative w-24 h-24 flex items-center justify-center rounded-full">
                          <svg className="w-full h-full transform -rotate-90 absolute top-0 left-0" viewBox="0 0 36 36">
                            <path strokeWidth="3" stroke={BRAND.lightPurpleGrey} fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <path strokeWidth="3" strokeDasharray={`${overallPercent}, 100`} strokeLinecap="round" stroke={BRAND.purple} fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                          </svg>
                          <div className="text-center">
                            <span className="text-3xl font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{overallPercent}</span>
                            <span className="text-xs block -mt-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>%</span>
                          </div>
                        </div>
                        <div>
                          <h2 className="text-xl font-bold mb-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Carrier Audit Score</h2>
                          <div className="flex gap-4 mb-2">
                            <div>
                              <span className="text-lg font-bold" style={{ color: BRAND.purple, fontFamily: FONTS.mono }}>{technicalScore}</span>
                              <span className="text-xs ml-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>/ {technicalMax}</span>
                              <span className="text-xs block" style={{ color: BRAND.purpleSecondary }}>Technical</span>
                            </div>
                            <div>
                              <span className="text-lg font-bold" style={{ color: BRAND.purple, fontFamily: FONTS.mono }}>{presentationScore}</span>
                              <span className="text-xs ml-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>/ {presentationMax}</span>
                              <span className="text-xs block" style={{ color: BRAND.purpleSecondary }}>Presentation</span>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Badge className="shadow-none border" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple, borderColor: BRAND.purpleLight }}>
                              {audit.riskLevel === "LOW" ? "Low Risk" : audit.riskLevel === "MEDIUM" ? "Medium Risk" : "High Risk"}
                            </Badge>
                            <Badge className="shadow-none border" style={{ backgroundColor: "#fef9ec", color: BRAND.gold, borderColor: BRAND.goldLight }}>
                              {audit.approvalStatus === "APPROVE" ? "Recommend Approval"
                                : audit.approvalStatus === "APPROVE WITH MINOR CHANGES" ? "Approve w/ Changes"
                                : audit.approvalStatus === "REQUIRES REVIEW" ? "Needs Review"
                                : audit.approvalStatus === "REJECT" ? "Recommend Denial"
                                : audit.approvalStatus}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <QuestionScorecardPanel
                  sectionScoreMap={sectionScoreMap}
                  sectionMaxMap={sectionMaxMap}
                  questionResults={questionResults}
                />

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

                {defects.length > 0 && (
                  <div className="pt-2 pb-10 space-y-3">
                    <FindingsSection
                      sectionKey="defects"
                      title="Critical Failures"
                      icon={<WarningTriangle width={16} height={16} />}
                      accentColor="#dc2626"
                      count={defects.length}
                      expanded={expandedSections.defects}
                      onToggle={() => setExpandedSections((s) => ({ ...s, defects: !s.defects }))}
                    >
                      {defects.map((f) => (
                        <DefectCard key={f.id} severity="critical" title={f.title} description={f.description} category="Critical Failure" />
                      ))}
                    </FindingsSection>
                  </div>
                )}
              </>
            )}

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

        <div className="w-80 flex flex-col shrink-0 hidden xl:flex overflow-hidden" style={{ backgroundColor: BRAND.white, borderLeft: `1px solid ${BRAND.greyLavender}` }}>
          <div className="p-4 shrink-0" style={{ borderBottom: `1px solid ${BRAND.greyLavender}` }}>
            <h2 className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Document Viewer</h2>
            {claimFileName && (
              <p className="text-xs mt-1 truncate" style={{ color: BRAND.purpleSecondary }}>{claimFileName}</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4" style={{ backgroundColor: BRAND.offWhite }}>
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

function answerBadge(answer: string) {
  if (answer === "PASS" || answer === "pass") return { label: "PASS", color: "#16a34a", bg: "#f0fdf4" }
  if (answer === "PARTIAL" || answer === "partial") return { label: "PARTIAL", color: "#ca8a04", bg: "#fef9ec" }
  if (answer === "NOT_APPLICABLE" || answer === "na") return { label: "N/A", color: "#6b7280", bg: "#f3f4f6" }
  return { label: "FAIL", color: "#dc2626", bg: "#fef2f2" }
}

interface QuestionFinding {
  id: string
  title: string
  description: string
  severity: string
  answer?: string
  issue?: string
  impact?: string
  fix?: string
  location?: string
  confidence?: number
}

function QuestionScorecardPanel({ sectionScoreMap, sectionMaxMap, questionResults }: {
  sectionScoreMap: Record<string, number>
  sectionMaxMap: Record<string, number>
  questionResults: QuestionFinding[]
}) {
  const sectionKeys = ["coverage", "scope", "financial", "documentation", "presentation"]

  return (
    <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <CardHeader className="pb-2 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
            Question-Level Audit
          </CardTitle>
          <Badge variant="outline" className="text-xs" style={{ color: BRAND.purple, backgroundColor: BRAND.lightPurpleGrey, borderColor: BRAND.purpleLight }}>
            {questionResults.filter((q) => q.severity === "pass").length}/{questionResults.length} Passed
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="space-y-5">
          {sectionKeys.map((sKey) => {
            const score = sectionScoreMap[sKey] ?? 0
            const max = sectionMaxMap[sKey] ?? 0
            const colors = getScoreColor(score, max)
            const sectionQuestions = questionResults.filter((q) => QUESTION_SECTIONS[q.title] === sKey)

            return (
              <div key={sKey}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded" style={{ backgroundColor: colors.bg, color: colors.text }}>
                      {SECTION_ICONS[sKey]}
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                      {SECTION_LABELS[sKey] || sKey}
                    </span>
                  </div>
                  <span className="text-sm font-bold" style={{ color: colors.text, fontFamily: FONTS.mono }}>
                    {score}<span className="text-xs font-normal" style={{ color: BRAND.purpleSecondary }}>/{max}</span>
                  </span>
                </div>

                <div className="w-full h-1.5 rounded-full overflow-hidden mb-2" style={{ backgroundColor: colors.bg }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${max > 0 ? (score / max) * 100 : 0}%`, backgroundColor: colors.bar }} />
                </div>

                <div className="space-y-2 pl-7">
                  {sectionQuestions.map((q) => {
                    const badge = answerBadge(q.answer || q.severity)
                    const showDetails = q.answer !== "PASS" && q.answer !== "pass" && q.severity !== "pass"
                    return (
                      <div key={q.id} className="flex items-start gap-2">
                        <span className="inline-flex items-center justify-center text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5" style={{ backgroundColor: badge.bg, color: badge.color, minWidth: "40px", textAlign: "center" }}>
                          {badge.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium" style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>
                            {QUESTION_LABELS[q.title] || q.title}
                          </span>
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
                          {showDetails && q.location && (
                            <p className="text-[10px] mt-0.5 leading-relaxed pl-2" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono, borderLeft: `2px solid ${BRAND.greyLavender}` }}>
                              {q.location}
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
      </CardContent>
    </Card>
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

function FindingsSection({ sectionKey, title, icon, accentColor, count, expanded, onToggle, children }: {
  sectionKey: string; title: string; icon: React.ReactNode; accentColor: string; count: number; expanded: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <Card className="shadow-sm overflow-hidden" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-black/[0.02] transition-colors"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`findings-${sectionKey}`}
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded" style={{ backgroundColor: `${accentColor}14`, color: accentColor }}>{icon}</div>
          <span className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{title}</span>
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-xs font-bold rounded-full" style={{ backgroundColor: count > 0 ? accentColor : BRAND.greyLavender, color: count > 0 ? "#fff" : BRAND.purpleSecondary }}>
            {count}
          </span>
        </div>
        <NavArrowDown
          width={16} height={16}
          className="transition-transform duration-200"
          style={{ color: BRAND.purpleSecondary, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div id={`findings-${sectionKey}`} className="px-4 pb-4 space-y-3" style={{ borderTop: `1px solid ${BRAND.greyLavender}` }}>
          <div className="pt-3 space-y-3">
            {children}
          </div>
        </div>
      )}
    </Card>
  )
}

function DefectCard({ severity, title, description, category }: { severity: "warning" | "critical"; title: string; description: string; category: string }) {
  const isC = severity === "critical"
  return (
    <Card className="shadow-sm" style={{ borderColor: isC ? "#fca5a5" : BRAND.greyLavender, backgroundColor: BRAND.white, borderLeftWidth: 3, borderLeftColor: isC ? "#dc2626" : BRAND.gold }}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <h4 className="text-sm font-semibold flex-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{title}</h4>
          <Badge className="shadow-none text-xs ml-2 shrink-0" style={{ backgroundColor: isC ? "#fef2f2" : "#fef9ec", color: isC ? "#dc2626" : BRAND.gold, border: `1px solid ${isC ? "#fca5a5" : BRAND.goldLight}` }}>
            {isC ? "Critical" : "Warning"}
          </Badge>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>{description}</p>
        <p className="text-xs mt-2 font-medium uppercase tracking-wider" style={{ color: BRAND.purpleSecondary }}>{category}</p>
      </CardContent>
    </Card>
  )
}
