import React, { useState } from "react"
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

const SECTION_ICONS: Record<string, React.ReactNode> = {
  "Coverage Clarity": <Shield width={16} height={16} />,
  "Scope Completeness": <CheckCircle width={16} height={16} />,
  "Estimate Accuracy": <Calculator width={16} height={16} />,
  "Doc Support": <PageSearch width={16} height={16} />,
  "Financial Accuracy": <DollarCircle width={16} height={16} />,
  "Carrier Risk": <WarningTriangle width={16} height={16} />,
}

function getScoreLevel(score: number): "good" | "warning" | "critical" {
  if (score >= 85) return "good"
  if (score >= 70) return "warning"
  return "critical"
}

export default function ClaimDetailPage({ claimId }: { claimId: string }) {
  const [activeTab, setActiveTab] = useState("defects")
  const [activeDoc, setActiveDoc] = useState("desk")
  const [, setLocation] = useLocation()

  const { data, isLoading, error } = useGetClaimDetail(claimId)

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
  const sections = audit?.sections ?? []
  const findings = audit?.findings ?? []

  const defects = findings.filter((f) => f.type === "defect")
  const questions = findings.filter((f) => f.type === "question")
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

  const deskDoc = docs.find((d) => d.type === "desk_report")

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-16 flex items-center justify-between px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <div className="flex items-center gap-2 text-sm" style={{ color: BRAND.purpleSecondary }}>
          <span className="cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setLocation("/claims")}>Claims</span>
          <NavArrowRight width={16} height={16} />
          <span className="font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{claim.claimNumber}</span>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="hidden lg:flex gap-2" style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple }}>
            <Mail width={16} height={16} />
            Generate Carrier Email
          </Button>
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

            <div className="pt-4">
              <Button className="w-full text-white font-semibold" style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading }}>
                Run Final Audit
              </Button>
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
                    <div className="flex flex-col md:flex-row items-center justify-between gap-6">
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
                          <h2 className="text-2xl font-bold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Audit Score</h2>
                          <div className="flex gap-2">
                            <Badge className="shadow-none border" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple, borderColor: BRAND.purpleLight }}>
                              {audit.riskLevel === "LOW" ? "Low Risk" : audit.riskLevel === "MEDIUM" ? "Medium Risk" : "High Risk"}
                            </Badge>
                            <Badge className="shadow-none border" style={{ backgroundColor: "#fef9ec", color: BRAND.gold, borderColor: BRAND.goldLight }}>
                              {audit.approvalStatus === "APPROVE" ? "Recommend Approval" : audit.approvalStatus === "REVIEW" ? "Needs Review" : "Recommend Denial"}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="text-sm max-w-xs text-right hidden md:block" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
                        Based on our AI analysis of {docs.length} documents against carrier guidelines.
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div>
                  <h3 className="text-sm font-semibold mb-3 ml-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Score Breakdown</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {sections.map((s) => (
                      <ScoreCard
                        key={s.id}
                        label={s.section}
                        score={s.score}
                        icon={SECTION_ICONS[s.section] || <Shield width={16} height={16} />}
                        level={getScoreLevel(s.score)}
                      />
                    ))}
                  </div>
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
                    <TabsList className="p-1 w-full flex mb-4 h-auto" style={{ backgroundColor: BRAND.lightPurpleGrey, border: `1px solid ${BRAND.greyLavender}` }}>
                      <TabsTrigger value="defects" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: FONTS.heading }}>
                        Defects <CountBadge count={defects.length} />
                      </TabsTrigger>
                      <TabsTrigger value="questions" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: FONTS.heading }}>
                        Carrier Questions <CountBadge count={questions.length} />
                      </TabsTrigger>
                      <TabsTrigger value="risks" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: FONTS.heading }}>
                        Risks <CountBadge count={risks.length} />
                      </TabsTrigger>
                      <TabsTrigger value="deferred" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: FONTS.heading }}>
                        Deferred Items <CountBadge count={deferred.length} />
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="defects" className="mt-0">
                      <div className="space-y-3">
                        {defects.map((f) => (
                          <DefectCard key={f.id} severity={f.severity === "high" || f.severity === "critical" ? "critical" : "warning"} title={f.title} description={f.description} category={(f as any).category || f.type} />
                        ))}
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
                    This claim hasn't been audited yet. Run an audit to get AI-powered analysis.
                  </p>
                  <Button className="text-white font-semibold" style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading }}>
                    Run Audit Now
                  </Button>
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
                  <h4 className="font-bold mt-6 mb-2 uppercase text-[10px] tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Depreciation Notes</h4>
                  <p className="mb-4 text-justify">
                    <span className="px-1 py-0.5 rounded" style={{ backgroundColor: "#fef9ec", color: BRAND.gold, outline: `1px solid ${BRAND.goldLight}` }}>
                      The current estimate reflects RCV (Replacement Cost Value) for the roofing materials.
                    </span>{" "}
                    Age of roof is estimated at 15 years based on homeowner records.
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

function ScoreCard({ label, score, icon, level }: { label: string; score: number; icon: React.ReactNode; level: "good" | "warning" | "critical" }) {
  const colors = {
    good: { bar: BRAND.purple, barBg: BRAND.lightPurpleGrey, iconBg: BRAND.lightPurpleGrey, iconColor: BRAND.purple, text: BRAND.purple },
    warning: { bar: BRAND.gold, barBg: "#fef9ec", iconBg: "#fef9ec", iconColor: BRAND.gold, text: BRAND.gold },
    critical: { bar: "#dc2626", barBg: "#fef2f2", iconBg: "#fef2f2", iconColor: "#dc2626", text: "#dc2626" },
  }
  const c = colors[level]
  return (
    <Card className="shadow-sm overflow-hidden" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <CardContent className="p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md" style={{ backgroundColor: c.iconBg, color: c.iconColor }}>{icon}</div>
            <span className="text-sm font-medium" style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>{label}</span>
          </div>
          <span className="text-lg font-bold" style={{ color: c.text, fontFamily: FONTS.mono }}>{score}</span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: c.barBg }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, backgroundColor: c.bar }} />
        </div>
      </CardContent>
    </Card>
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
