import React, { useState } from "react"
import {
  DashboardDots,
  PageEdit,
  Upload as UploadIcon,
  ClipboardCheck,
  Settings as SettingsIcon,
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
} from "iconoir-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

const BRAND = {
  purple: "#7763B7",
  purpleSecondary: "#9D8BBF",
  purpleLight: "#CDBFF7",
  gold: "#C6A54E",
  goldLight: "#EAD4A2",
  deepPurple: "#342A4F",
  lightPurpleGrey: "#F0E6FA",
  greyLavender: "#E3DFE8",
  offWhite: "#F0EDF4",
  white: "#FFFFFF",
}

export function ClaimsAuditDashboard() {
  const [activeTab, setActiveTab] = useState("defects")
  const [activeDoc, setActiveDoc] = useState("desk")

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: BRAND.offWhite, fontFamily: "'Source Sans 3', 'Source Sans Pro', sans-serif", color: BRAND.deepPurple }}>
      <aside className="w-64 flex flex-col shrink-0" style={{ backgroundColor: BRAND.deepPurple }}>
        <div className="h-16 flex items-center px-5 gap-3" style={{ borderBottom: `1px solid rgba(255,255,255,0.1)` }}>
          <img src="/__mockup/images/claims-iq-logo.png" alt="Claims iQ" className="h-8 w-8" />
          <span className="text-white text-lg tracking-tight" style={{ fontFamily: "'Work Sans', sans-serif", fontWeight: 700 }}>
            Claims iQ
          </span>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1">
          <SidebarItem icon={<DashboardDots width={20} height={20} />} label="Dashboard" />
          <SidebarItem icon={<PageEdit width={20} height={20} />} label="Claims" active />
          <SidebarItem icon={<UploadIcon width={20} height={20} />} label="Upload / Ingest" />
          <SidebarItem icon={<ClipboardCheck width={20} height={20} />} label="Audit Results" />
          <SidebarItem icon={<SettingsIcon width={20} height={20} />} label="Settings" />
        </nav>

        <div className="p-4" style={{ borderTop: `1px solid rgba(255,255,255,0.1)` }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white" style={{ backgroundColor: BRAND.purple }}>
              JD
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-semibold text-white truncate" style={{ fontFamily: "'Work Sans', sans-serif" }}>John Doe</p>
              <p className="text-xs truncate" style={{ color: BRAND.purpleSecondary }}>Senior Auditor</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 flex items-center justify-between px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
          <div className="flex items-center gap-2 text-sm" style={{ color: BRAND.purpleSecondary }}>
            <span className="cursor-pointer hover:opacity-80 transition-opacity">Claims</span>
            <NavArrowRight width={16} height={16} />
            <span className="font-semibold" style={{ color: BRAND.deepPurple, fontFamily: "'Space Mono', monospace" }}>CLM-2024-00847</span>
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
            <Button size="sm" className="gap-2 text-white border-transparent" style={{ backgroundColor: BRAND.purple, fontFamily: "'Work Sans', sans-serif", fontWeight: 600 }}>
              <CheckCircle width={16} height={16} />
              Mark Ready for Submission
            </Button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-72 flex flex-col shrink-0 overflow-y-auto hidden md:flex" style={{ backgroundColor: BRAND.white, borderRight: `1px solid ${BRAND.greyLavender}` }}>
            <div className="p-5 space-y-6">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center justify-between" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>
                  Claim Details
                  <Badge className="shadow-none border-transparent text-xs font-semibold" style={{ backgroundColor: "#e8f5e9", color: "#2e7d32" }}>
                    Analyzed
                  </Badge>
                </h2>

                <div className="space-y-4">
                  <DetailItem label="Claim Number" value="CLM-2024-00847" mono />
                  <DetailItem label="Insured" value="Morrison Properties LLC" />
                  <DetailItem label="Date of Loss" value="January 15, 2024" />
                  <DetailItem label="Peril" value="Wind/Hail" />
                  <DetailItem label="Total Estimate" value="$42,550.00" mono />
                </div>
              </div>

              <Separator style={{ backgroundColor: BRAND.greyLavender }} />

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>
                  Documents
                </h3>
                <div className="space-y-1">
                  <DocumentItem name="FNOL Report" type="pdf" date="Jan 16" />
                  <DocumentItem name="Policy Declaration" type="pdf" date="Jan 16" />
                  <DocumentItem name="Xactimate Estimate" type="esx" date="Jan 18" />
                  <DocumentItem name="Field Photos (24)" type="img" date="Jan 19" />
                  <DocumentItem name="Desk Adjuster Report" type="doc" date="Jan 20" active />
                </div>
              </div>

              <div className="pt-4">
                <Button className="w-full text-white font-semibold" style={{ backgroundColor: BRAND.purple, fontFamily: "'Work Sans', sans-serif" }}>
                  Run Final Audit
                </Button>
              </div>
            </div>
          </div>

          <ScrollArea className="flex-1 relative" style={{ backgroundColor: BRAND.offWhite }}>
            <div className="max-w-4xl mx-auto p-6 space-y-6">
              <Card className="shadow-sm overflow-hidden relative" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
                <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: BRAND.purple }}></div>
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-6">
                      <div className="relative w-24 h-24 flex items-center justify-center rounded-full">
                        <svg className="w-full h-full transform -rotate-90 absolute top-0 left-0" viewBox="0 0 36 36">
                          <path
                            strokeWidth="3"
                            stroke={BRAND.lightPurpleGrey}
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            strokeWidth="3"
                            strokeDasharray="82, 100"
                            strokeLinecap="round"
                            stroke={BRAND.purple}
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                        </svg>
                        <div className="text-center">
                          <span className="text-3xl font-bold" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>82</span>
                          <span className="text-xs block -mt-1" style={{ color: BRAND.purpleSecondary, fontFamily: "'Space Mono', monospace" }}>/100</span>
                        </div>
                      </div>

                      <div>
                        <h2 className="text-2xl font-bold mb-2" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>Audit Score</h2>
                        <div className="flex gap-2">
                          <Badge className="shadow-none border" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple, borderColor: BRAND.purpleLight }}>
                            Low Risk
                          </Badge>
                          <Badge className="shadow-none border" style={{ backgroundColor: "#fef9ec", color: BRAND.gold, borderColor: BRAND.goldLight }}>
                            Recommend Approval
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="text-sm max-w-xs text-right hidden md:block" style={{ color: BRAND.purpleSecondary, fontFamily: "'Source Sans 3', sans-serif" }}>
                      Based on our AI analysis of 5 documents and 24 photos against carrier guidelines.
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div>
                <h3 className="text-sm font-semibold mb-3 ml-1" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>Score Breakdown</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <ScoreCard label="Coverage Clarity" score={88} icon={<Shield width={16} height={16} />} level="good" />
                  <ScoreCard label="Scope Completeness" score={76} icon={<CheckCircle width={16} height={16} />} level="warning" />
                  <ScoreCard label="Estimate Accuracy" score={85} icon={<Calculator width={16} height={16} />} level="good" />
                  <ScoreCard label="Doc Support" score={90} icon={<PageSearch width={16} height={16} />} level="good" />
                  <ScoreCard label="Financial Accuracy" score={79} icon={<DollarCircle width={16} height={16} />} level="warning" />
                  <ScoreCard label="Carrier Risk" score={74} icon={<WarningTriangle width={16} height={16} />} level="warning" />
                </div>
              </div>

              <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
                <CardHeader className="pb-3 pt-5 px-5">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>
                      <Sparks width={18} height={18} style={{ color: BRAND.gold }} />
                      Executive Summary
                    </CardTitle>
                    <Badge variant="outline" className="text-xs" style={{ color: BRAND.purple, backgroundColor: BRAND.lightPurpleGrey, borderColor: BRAND.purpleLight }}>AI Generated</Badge>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  <p className="text-sm leading-relaxed" style={{ color: BRAND.purpleSecondary, fontFamily: "'Source Sans 3', sans-serif" }}>
                    This claim generally aligns with policy coverage and standard pricing guidelines. The overall scope of repairs for the wind/hail damage is appropriate, and the provided field photos (24) well-substantiate the roof replacements. However, there are minor discrepancies regarding the depreciation calculation for the roofing materials and documentation of Overhead & Profit (O&P) that should be reviewed prior to final approval.
                  </p>
                </CardContent>
              </Card>

              <div className="pt-2 pb-10">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="p-1 w-full flex mb-4 h-auto" style={{ backgroundColor: BRAND.lightPurpleGrey, border: `1px solid ${BRAND.greyLavender}` }}>
                    <TabsTrigger value="defects" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: "'Work Sans', sans-serif" }} data-state={activeTab === "defects" ? "active" : ""}>
                      Defects <CountBadge count={3} />
                    </TabsTrigger>
                    <TabsTrigger value="questions" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: "'Work Sans', sans-serif" }}>
                      Carrier Questions <CountBadge count={2} />
                    </TabsTrigger>
                    <TabsTrigger value="risks" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: "'Work Sans', sans-serif" }}>
                      Risks <CountBadge count={4} />
                    </TabsTrigger>
                    <TabsTrigger value="deferred" className="flex-1 text-sm py-2 data-[state=active]:shadow-sm" style={{ fontFamily: "'Work Sans', sans-serif" }}>
                      Deferred Items <CountBadge count={1} />
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="defects" className="mt-0">
                    <div className="space-y-3">
                      <DefectCard
                        severity="warning"
                        title="Missing depreciation calculation for roofing materials"
                        description="The estimate includes full replacement cost for 15-year old architectural shingles without applying standard age-based depreciation (approx. 40%)."
                        category="Financial Accuracy"
                      />
                      <DefectCard
                        severity="critical"
                        title="Overhead & Profit not properly documented"
                        description="O&P of 10/10 was applied to the estimate, but the complexity of repairs (only 2 trades involved) does not meet carrier guidelines for O&P inclusion without further justification."
                        category="Carrier Risk"
                      />
                      <DefectCard
                        severity="warning"
                        title="Photo documentation gaps for north elevation"
                        description="The desk report references wind damage to the north elevation siding, but only 1 wide-angle photo was provided, making it difficult to verify the extent of the damage."
                        category="Documentation Support"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="questions" className="mt-0">
                    <EmptyTabContent icon={<PageSearch width={40} height={40} />} title="2 Carrier Questions Identified" subtitle="Select this tab to view questions to escalate to the carrier." />
                  </TabsContent>

                  <TabsContent value="risks" className="mt-0">
                    <EmptyTabContent icon={<WarningTriangle width={40} height={40} />} title="4 Potential Risks" subtitle="Select this tab to view identified claim risks." />
                  </TabsContent>

                  <TabsContent value="deferred" className="mt-0">
                    <EmptyTabContent icon={<ClipboardCheck width={40} height={40} />} title="1 Deferred Item" subtitle="Select this tab to view items deferred for later review." />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </ScrollArea>

          <div className="w-80 flex flex-col shrink-0 hidden xl:flex" style={{ backgroundColor: BRAND.white, borderLeft: `1px solid ${BRAND.greyLavender}` }}>
            <div className="p-4" style={{ borderBottom: `1px solid ${BRAND.greyLavender}` }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>Document Viewer</h2>
              <div className="flex rounded-md p-0.5 w-full" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
                {(["desk", "est", "photos"] as const).map((doc) => (
                  <button
                    key={doc}
                    className="flex-1 text-xs py-1.5 px-2 rounded-sm font-medium transition-colors"
                    style={{
                      backgroundColor: activeDoc === doc ? BRAND.white : "transparent",
                      color: activeDoc === doc ? BRAND.deepPurple : BRAND.purpleSecondary,
                      boxShadow: activeDoc === doc ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                      fontFamily: "'Work Sans', sans-serif",
                    }}
                    onClick={() => setActiveDoc(doc)}
                  >
                    {doc === "desk" ? "Desk Rpt" : doc === "est" ? "Estimate" : "Photos"}
                  </button>
                ))}
              </div>
            </div>

            <ScrollArea className="flex-1 p-4" style={{ backgroundColor: BRAND.offWhite }}>
              <div className="rounded shadow-sm w-full min-h-[600px] p-6 text-xs leading-relaxed" style={{ backgroundColor: BRAND.white, border: `1px solid ${BRAND.greyLavender}`, color: BRAND.deepPurple, fontFamily: "'Source Sans 3', sans-serif" }}>
                <div className="text-center font-bold text-sm mb-6 pb-4 uppercase tracking-widest" style={{ borderBottom: `1px solid ${BRAND.greyLavender}`, fontFamily: "'Work Sans', sans-serif" }}>
                  Desk Adjuster Report
                </div>

                <p className="mb-4" style={{ fontFamily: "'Space Mono', monospace", fontSize: "11px" }}>
                  <strong>Claim #:</strong> CLM-2024-00847<br />
                  <strong>Insured:</strong> Morrison Properties LLC<br />
                  <strong>Date:</strong> Jan 20, 2024
                </p>

                <h4 className="font-bold mt-6 mb-2 uppercase text-[10px] tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>Summary of Findings</h4>
                <p className="mb-4 text-justify">
                  Inspection of the property revealed significant wind and hail damage consistent with the reported date of loss. The primary dwelling sustained damage to the architectural shingle roof, particularly on the west and south facing slopes.
                </p>

                <h4 className="font-bold mt-6 mb-2 uppercase text-[10px] tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>Scope Notes</h4>
                <p className="mb-4 text-justify">
                  Full roof replacement is recommended.{" "}
                  <span className="px-1 py-0.5 rounded" style={{ backgroundColor: "#fef9ec", color: BRAND.gold, outline: `1px solid ${BRAND.goldLight}` }}>
                    Overhead and profit (10/10) has been applied to the estimate due to the coordination required between the roofing contractor and the siding repair team.
                  </span>{" "}
                  The north elevation siding also shows signs of minor wind damage, though further inspection may be necessary as access was limited during the initial visit.
                </p>

                <h4 className="font-bold mt-6 mb-2 uppercase text-[10px] tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>Depreciation Notes</h4>
                <p className="mb-4 text-justify">
                  <span className="px-1 py-0.5 rounded" style={{ backgroundColor: "#fef9ec", color: BRAND.gold, outline: `1px solid ${BRAND.goldLight}` }}>
                    The current estimate reflects RCV (Replacement Cost Value) for the roofing materials.
                  </span>{" "}
                  Age of roof is estimated at 15 years based on homeowner records.
                </p>
              </div>
            </ScrollArea>
          </div>
        </div>
      </main>
    </div>
  )
}

function SidebarItem({ icon, label, active = false }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
      style={{
        backgroundColor: active ? "rgba(119, 99, 183, 0.15)" : "transparent",
        color: active ? BRAND.purpleLight : "rgba(255,255,255,0.5)",
      }}
    >
      <div style={{ color: active ? BRAND.purpleLight : "rgba(255,255,255,0.4)" }}>{icon}</div>
      <span className="text-sm" style={{ fontFamily: "'Source Sans 3', sans-serif", fontWeight: active ? 600 : 400 }}>{label}</span>
    </div>
  )
}

function DetailItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wider" style={{ color: BRAND.purpleSecondary, fontFamily: "'Source Sans 3', sans-serif" }}>{label}</span>
      <span className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: mono ? "'Space Mono', monospace" : "'Source Sans 3', sans-serif" }}>{value}</span>
    </div>
  )
}

function DocumentItem({ name, type, date, active = false }: { name: string; type: "pdf" | "doc" | "esx" | "img"; date: string; active?: boolean }) {
  const iconColor = {
    pdf: BRAND.purple,
    doc: BRAND.purple,
    esx: BRAND.gold,
    img: BRAND.gold,
  }[type]

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
        <span className="text-sm truncate" style={{ color: active ? BRAND.purple : BRAND.deepPurple, fontWeight: active ? 600 : 400, fontFamily: "'Source Sans 3', sans-serif" }}>
          {name}
        </span>
      </div>
      <span className="text-xs shrink-0" style={{ color: BRAND.purpleSecondary, fontFamily: "'Space Mono', monospace", fontSize: "10px" }}>{date}</span>
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
            <span className="text-sm font-medium" style={{ color: BRAND.deepPurple, fontFamily: "'Source Sans 3', sans-serif" }}>{label}</span>
          </div>
          <span className="text-lg font-bold" style={{ color: c.text, fontFamily: "'Space Mono', monospace" }}>{score}</span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: c.barBg }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, backgroundColor: c.bar }}></div>
        </div>
      </CardContent>
    </Card>
  )
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-2 inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-semibold" style={{ backgroundColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: "'Space Mono', monospace", fontSize: "11px" }}>
      {count}
    </span>
  )
}

function DefectCard({ severity, title, description, category }: { severity: "warning" | "critical"; title: string; description: string; category: string }) {
  const dotColor = severity === "critical" ? "#dc2626" : BRAND.gold

  return (
    <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: dotColor }}></div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>{title}</h4>
              <Badge variant="outline" className="text-[10px] ml-2 shrink-0" style={{ color: BRAND.purpleSecondary, borderColor: BRAND.greyLavender, fontFamily: "'Space Mono', monospace" }}>
                {category}
              </Badge>
            </div>
            <p className="text-sm" style={{ color: BRAND.purpleSecondary, fontFamily: "'Source Sans 3', sans-serif" }}>{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyTabContent({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="rounded-lg p-8 text-center" style={{ backgroundColor: BRAND.white, border: `1px solid ${BRAND.greyLavender}` }}>
      <div className="mx-auto mb-3" style={{ color: BRAND.purpleLight }}>{icon}</div>
      <p className="font-semibold" style={{ color: BRAND.deepPurple, fontFamily: "'Work Sans', sans-serif" }}>{title}</p>
      <p className="text-sm mt-1" style={{ color: BRAND.purpleSecondary, fontFamily: "'Source Sans 3', sans-serif" }}>{subtitle}</p>
    </div>
  )
}
