import React, { useState, useCallback } from "react"
import {
  Shield,
  CheckCircle,
  Calculator,
  PageSearch,
  DollarCircle,
  WarningTriangle,
  NavArrowRight,
  Download,
  Mail,
  Sparks,
  PageEdit,
  ClipboardCheck,
  Folder,
  CreditCard,
  List,
  MediaImage,
  Page,
  BookStack,
  Lock,
} from "iconoir-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { BRAND, FONTS } from "@/lib/brand"
import { useGetClaimDetail } from "@workspace/api-client-react"
import { useLocation } from "wouter"

interface ScorecardRow {
  key: string
  label: string
  max: number
  icon: React.ReactNode
}

const TECHNICAL_ROWS: ScorecardRow[] = [
  { key: "coverage_clarity", label: "Coverage & Liability Clarity", max: 15, icon: <Shield width={16} height={16} /> },
  { key: "scope_completeness", label: "Scope Completeness", max: 15, icon: <CheckCircle width={16} height={16} /> },
  { key: "estimate_accuracy", label: "Estimate Technical Accuracy", max: 15, icon: <Calculator width={16} height={16} /> },
  { key: "documentation_support", label: "Documentation & Evidence Support", max: 10, icon: <PageSearch width={16} height={16} /> },
  { key: "financial_accuracy", label: "Financial Accuracy & Reconciliation", max: 10, icon: <DollarCircle width={16} height={16} /> },
  { key: "carrier_risk", label: "Carrier Risk & Completeness", max: 15, icon: <WarningTriangle width={16} height={16} /> },
]

const PRESENTATION_ROWS: ScorecardRow[] = [
  { key: "file_stack_order", label: "File Stack Order", max: 3, icon: <Folder width={16} height={16} /> },
  { key: "payment_match", label: "Payment Recommendations Match", max: 5, icon: <CreditCard width={16} height={16} /> },
  { key: "estimate_operational_order", label: "Estimate Operational Order", max: 3, icon: <List width={16} height={16} /> },
  { key: "photo_organization", label: "Photographs Clear and In Order", max: 3, icon: <MediaImage width={16} height={16} /> },
  { key: "da_report_quality", label: "DA Report Not Cumbersome", max: 2, icon: <Page width={16} height={16} /> },
  { key: "fa_report_quality", label: "FA Report Detailed Enough", max: 2, icon: <BookStack width={16} height={16} /> },
  { key: "policy_provisions", label: "Unique Policy Provisions Addressed", max: 2, icon: <Lock width={16} height={16} /> },
]

function getScoreColor(score: number, max: number): { text: string; bg: string; bar: string } {
  const pct = max > 0 ? (score / max) * 100 : 0
  if (pct >= 80) return { text: "#16a34a", bg: "#f0fdf4", bar: "#16a34a" }
  if (pct >= 60) return { text: BRAND.gold, bg: "#fef9ec", bar: BRAND.gold }
  return { text: "#dc2626", bg: "#fef2f2", bar: "#dc2626" }
}

export default function ClaimDetailPage({ claimId }: { claimId: string }) {
  const [activeTab, setActiveTab] = useState("defects")
  const [activeDoc, setActiveDoc] = useState("desk")
  const [, setLocation] = useLocation()
  const [auditing, setAuditing] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [emailLoading, setEmailLoading] = useState(false)

  const { data, isLoading, error, refetch } = useGetClaimDetail(claimId)

  const handleRunAudit = useCallback(async () => {
    setAuditing(true)
    setAuditError(null)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "/api"
      const res = await fetch(`${baseUrl}/claims/${claimId}/audit`, { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Audit failed")
      }
      await refetch()
    } catch (err: any) {
      setAuditError(err.message || "Failed to run audit")
    } finally {
      setAuditing(false)
    }
  }, [claimId, refetch])

  const handleGenerateEmail = useCallback(async () => {
    setEmailLoading(true)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "/api"
      const res = await fetch(`${baseUrl}/claims/${claimId}/email`)
      if (!res.ok) throw new Error("Failed to generate email")
      const { html } = await res.json()
      const win = window.open("", "_blank")
      if (win) {
        win.document.write(html)
        win.document.close()
      }
    } catch (err: any) {
      alert(err.message || "Failed to generate email")
    } finally {
      setEmailLoading(false)
    }
  }, [claimId])

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
  const overallScore = audit?.overallScore ?? 0
  const technicalScore = (audit as any)?.technicalScore ?? 0
  const presentationScore = (audit as any)?.presentationScore ?? 0
  const sections = audit?.sections ?? []
  const findings = audit?.findings ?? []

  const sectionScoreMap: Record<string, number> = {}
  for (const s of sections) {
    sectionScoreMap[s.section] = s.score
  }

  const defects = findings.filter((f) => f.type === "defect")
  const presentationIssues = findings.filter((f) => f.type === "presentation_issue")
  const questions = findings.filter((f) => f.type === "question" || f.type === "carrier_question")
  const risks = findings.filter((f) => f.type === "risk")
  const deferred = findings.filter((f) => f.type === "deferred")

  const docTypeLabels: Record<string, string> = {
    FNOL: "FNOL Report",
    policy: "Policy Declaration",
    estimate: "Xactimate Estimate",
    photos: "Field Photos",
    desk_report: "Desk Adjuster Report",
  }
  const docTypeFormats: Record<string, "pdf" | "doc" | "esx" | "img"> = {
    FNOL: "pdf",
    policy: "pdf",
    estimate: "esx",
    photos: "img",
    desk_report: "doc",
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-16 flex items-center justify-between px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <div className="flex items-center gap-2 text-sm" style={{ color: BRAND.purpleSecondary }}>
          <span className="cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setLocation("/claims")}>Claims</span>
          <NavArrowRight width={16} height={16} />
          <span className="font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{claim.claimNumber}</span>
        </div>

        <div className="flex items-center gap-3">
          {audit && (
            <Button
              variant="outline"
              size="sm"
              className="hidden lg:flex gap-2"
              style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple }}
              onClick={handleGenerateEmail}
              disabled={emailLoading}
            >
              <Mail width={16} height={16} />
              {emailLoading ? "Generating..." : "Generate Carrier Email"}
            </Button>
          )}
          <Button variant="outline" size="sm" className="hidden md:flex gap-2" style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple }}>
            <Download width={16} height={16} />
            Export Report (PDF)
          </Button>
          <Button size="sm" className="gap-2 text-white border-transparent" style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}>
            <CheckCircle width={16} height={16} />
            Mark Ready for Submission
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 flex flex-col shrink-0 overflow-y-auto hidden md:flex" style={{ backgroundColor: BRAND.white, borderRight: `1px solid ${BRAND.greyLavender}` }}>
          <div className="p-5 space-y-6">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center justify-between" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                Claim Details
                <Badge className="shadow-none border-transparent text-xs font-semibold" style={{ backgroundColor: claim.status === "analyzed" ? "#e8f5e9" : BRAND.lightPurpleGrey, color: claim.status === "analyzed" ? "#2e7d32" : BRAND.purple }}>
                  {claim.status?.charAt(0).toUpperCase() + claim.status?.slice(1)}
                </Badge>
              </h2>

              <div className="space-y-4">
                <DetailItem label="Claim Number" value={claim.claimNumber} mono />
                <DetailItem label="Insured" value={claim.insuredName} />
                <DetailItem label="Date of Loss" value={claim.dateOfLoss ?? "N/A"} />
                <DetailItem label="Carrier" value={claim.carrier ?? "N/A"} />
              </div>
            </div>

            <Separator style={{ backgroundColor: BRAND.greyLavender }} />

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                Documents
              </h3>
              <div className="space-y-1">
                {docs.map((d) => (
                  <DocumentItem
                    key={d.id}
                    name={docTypeLabels[d.type] || d.type}
                    type={docTypeFormats[d.type] || "doc"}
                    active={false}
                  />
                ))}
              </div>
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
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 relative" style={{ backgroundColor: BRAND.offWhite }}>
          <div className="max-w-4xl mx-auto p-6 space-y-6">
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
                            <path strokeWidth="3" strokeDasharray={`${overallScore}, 100`} strokeLinecap="round" stroke={BRAND.purple} fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                          </svg>
                          <div className="text-center">
                            <span className="text-3xl font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{overallScore}</span>
                            <span className="text-xs block -mt-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>/100</span>
                          </div>
                        </div>
                        <div>
                          <h2 className="text-xl font-bold mb-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Carrier Audit Score</h2>
                          <div className="flex gap-4 mb-2">
                            <div>
                              <span className="text-lg font-bold" style={{ color: BRAND.purple, fontFamily: FONTS.mono }}>{technicalScore}</span>
                              <span className="text-xs ml-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>/ 80</span>
                              <span className="text-xs block" style={{ color: BRAND.purpleSecondary }}>Technical</span>
                            </div>
                            <div>
                              <span className="text-lg font-bold" style={{ color: BRAND.purple, fontFamily: FONTS.mono }}>{presentationScore}</span>
                              <span className="text-xs ml-1" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>/ 20</span>
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

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <ScorecardPanel
                    title="Technical Scorecard"
                    subtitle={`${technicalScore} / 80`}
                    rows={TECHNICAL_ROWS}
                    scores={sectionScoreMap}
                  />
                  <ScorecardPanel
                    title="Carrier Readiness"
                    subtitle={`${presentationScore} / 20`}
                    rows={PRESENTATION_ROWS}
                    scores={sectionScoreMap}
                  />
                </div>

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

                <div className="pt-2 pb-10">
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="p-1 w-full flex mb-4 h-auto flex-wrap" style={{ backgroundColor: BRAND.lightPurpleGrey, border: `1px solid ${BRAND.greyLavender}` }}>
                      <TabsTrigger value="defects" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: FONTS.heading }}>
                        Critical / Defects <CountBadge count={defects.length} />
                      </TabsTrigger>
                      <TabsTrigger value="presentation" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: FONTS.heading }}>
                        Presentation <CountBadge count={presentationIssues.length} />
                      </TabsTrigger>
                      <TabsTrigger value="questions" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: FONTS.heading }}>
                        Carrier Questions <CountBadge count={questions.length} />
                      </TabsTrigger>
                      <TabsTrigger value="risks" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: FONTS.heading }}>
                        Risks <CountBadge count={risks.length} />
                      </TabsTrigger>
                      <TabsTrigger value="deferred" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: FONTS.heading }}>
                        Deferred <CountBadge count={deferred.length} />
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="defects" className="mt-0">
                      <div className="space-y-3">
                        {defects.length > 0 ? defects.map((f) => (
                          <DefectCard key={f.id} severity={f.severity === "high" || f.severity === "critical" ? "critical" : "warning"} title={f.title} description={f.description} category={(f as any).category || f.type} />
                        )) : (
                          <EmptyTabContent icon={<CheckCircle width={40} height={40} />} title="No Critical Failures or Defects" subtitle="No defects identified for this claim." />
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="presentation" className="mt-0">
                      <div className="space-y-3">
                        {presentationIssues.length > 0 ? presentationIssues.map((f) => (
                          <DefectCard key={f.id} severity="warning" title={f.title} description={f.description} category="Presentation" />
                        )) : (
                          <EmptyTabContent icon={<Folder width={40} height={40} />} title="No Presentation Issues" subtitle="File organization meets carrier readiness standards." />
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="questions" className="mt-0">
                      <div className="space-y-3">
                        {questions.length > 0 ? questions.map((f) => (
                          <DefectCard key={f.id} severity="warning" title={f.title} description={f.description} category={(f as any).category || "Question"} />
                        )) : (
                          <EmptyTabContent icon={<PageSearch width={40} height={40} />} title="No Carrier Questions" subtitle="No questions identified for this claim." />
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="risks" className="mt-0">
                      <div className="space-y-3">
                        {risks.length > 0 ? risks.map((f) => (
                          <DefectCard key={f.id} severity={f.severity === "high" || f.severity === "critical" ? "critical" : "warning"} title={f.title} description={f.description} category={(f as any).category || "Risk"} />
                        )) : (
                          <EmptyTabContent icon={<WarningTriangle width={40} height={40} />} title="No Risks Identified" subtitle="No risks found for this claim." />
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="deferred" className="mt-0">
                      <div className="space-y-3">
                        {deferred.length > 0 ? deferred.map((f) => (
                          <DefectCard key={f.id} severity="warning" title={f.title} description={f.description} category={(f as any).category || "Deferred"} />
                        )) : (
                          <EmptyTabContent icon={<ClipboardCheck width={40} height={40} />} title="No Deferred Items" subtitle="No items deferred for later review." />
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
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

        <div className="w-80 flex flex-col shrink-0 hidden xl:flex" style={{ backgroundColor: BRAND.white, borderLeft: `1px solid ${BRAND.greyLavender}` }}>
          <div className="p-4" style={{ borderBottom: `1px solid ${BRAND.greyLavender}` }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Document Viewer</h2>
            <div className="flex rounded-md p-0.5 w-full" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
              {(["desk", "est", "photos"] as const).map((doc) => (
                <button
                  key={doc}
                  className="flex-1 text-xs py-1.5 px-2 rounded-sm font-medium transition-colors"
                  style={{
                    backgroundColor: activeDoc === doc ? BRAND.white : "transparent",
                    color: activeDoc === doc ? BRAND.deepPurple : BRAND.purpleSecondary,
                    boxShadow: activeDoc === doc ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                    fontFamily: FONTS.heading,
                  }}
                  onClick={() => setActiveDoc(doc)}
                >
                  {doc === "desk" ? "Desk Rpt" : doc === "est" ? "Estimate" : "Photos"}
                </button>
              ))}
            </div>
          </div>

          <ScrollArea className="flex-1 p-4" style={{ backgroundColor: BRAND.offWhite }}>
            <div className="rounded shadow-sm w-full min-h-[600px] p-6 text-xs leading-relaxed" style={{ backgroundColor: BRAND.white, border: `1px solid ${BRAND.greyLavender}`, color: BRAND.deepPurple, fontFamily: FONTS.body }}>
              <div className="text-center font-bold text-sm mb-6 pb-4 uppercase tracking-widest" style={{ borderBottom: `1px solid ${BRAND.greyLavender}`, fontFamily: FONTS.heading }}>
                {activeDoc === "desk" ? "Desk Adjuster Report" : activeDoc === "est" ? "Xactimate Estimate" : "Field Photos"}
              </div>

              {activeDoc === "desk" && (
                <>
                  <p className="mb-4" style={{ fontFamily: FONTS.mono, fontSize: "11px" }}>
                    <strong>Claim #:</strong> {claim.claimNumber}<br />
                    <strong>Insured:</strong> {claim.insuredName}<br />
                    <strong>Date:</strong> {claim.dateOfLoss}
                  </p>
                  <h4 className="font-bold mt-6 mb-2 uppercase text-[10px] tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Summary of Findings</h4>
                  <p className="mb-4 text-justify">
                    Inspection of the property revealed significant wind and hail damage consistent with the reported date of loss. The primary dwelling sustained damage to the architectural shingle roof, particularly on the west and south facing slopes.
                  </p>
                  <h4 className="font-bold mt-6 mb-2 uppercase text-[10px] tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Scope Notes</h4>
                  <p className="mb-4 text-justify">
                    Full roof replacement is recommended.{" "}
                    <span className="px-1 py-0.5 rounded" style={{ backgroundColor: "#fef9ec", color: BRAND.gold, outline: `1px solid ${BRAND.goldLight}` }}>
                      Overhead and profit (10/10) has been applied to the estimate due to the coordination required between the roofing contractor and the siding repair team.
                    </span>{" "}
                    The north elevation siding also shows signs of minor wind damage.
                  </p>
                </>
              )}
              {activeDoc === "est" && (
                <p className="text-center mt-12" style={{ color: BRAND.purpleSecondary }}>
                  Xactimate estimate data will be displayed here once uploaded.
                </p>
              )}
              {activeDoc === "photos" && (
                <p className="text-center mt-12" style={{ color: BRAND.purpleSecondary }}>
                  Field photos will be displayed here once uploaded.
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </main>
  )
}

function ScorecardPanel({ title, subtitle, rows, scores }: { title: string; subtitle: string; rows: ScorecardRow[]; scores: Record<string, number> }) {
  return (
    <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <CardHeader className="pb-2 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
            {title}
          </CardTitle>
          <span className="text-sm font-bold" style={{ color: BRAND.purple, fontFamily: FONTS.mono }}>{subtitle}</span>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="space-y-3">
          {rows.map((row) => {
            const score = scores[row.key] ?? 0
            const pct = row.max > 0 ? (score / row.max) * 100 : 0
            const colors = getScoreColor(score, row.max)
            return (
              <div key={row.key}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded" style={{ backgroundColor: colors.bg, color: colors.text }}>{row.icon}</div>
                    <span className="text-xs font-medium" style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>{row.label}</span>
                  </div>
                  <span className="text-sm font-bold" style={{ color: colors.text, fontFamily: FONTS.mono }}>
                    {score}<span className="text-xs font-normal" style={{ color: BRAND.purpleSecondary }}>/{row.max}</span>
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.bg }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: colors.bar }} />
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

function DocumentItem({ name, type, active = false }: { name: string; type: "pdf" | "doc" | "esx" | "img"; active?: boolean }) {
  const iconColor = type === "esx" || type === "img" ? BRAND.gold : BRAND.purple
  return (
    <div
      className="flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors"
      style={{
        backgroundColor: active ? BRAND.lightPurpleGrey : "transparent",
        border: active ? `1px solid ${BRAND.purpleLight}` : "1px solid transparent",
      }}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <PageEdit width={16} height={16} style={{ color: iconColor }} />
        <span className="text-sm truncate" style={{ color: active ? BRAND.purple : BRAND.deepPurple, fontWeight: active ? 600 : 400, fontFamily: FONTS.body }}>
          {name}
        </span>
      </div>
    </div>
  )
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold rounded-full" style={{ backgroundColor: BRAND.purple, color: BRAND.white }}>
      {count}
    </span>
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

function EmptyTabContent({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <CardContent className="p-10 text-center">
        <div className="mb-3 flex justify-center" style={{ color: BRAND.purpleSecondary }}>{icon}</div>
        <h4 className="text-sm font-semibold mb-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{title}</h4>
        <p className="text-xs" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>{subtitle}</p>
      </CardContent>
    </Card>
  )
}
