import React, { useState } from "react"
import {
  LayoutDashboard,
  FileText,
  Upload,
  ClipboardCheck,
  Settings,
  Shield,
  CheckSquare,
  Calculator,
  FileCheck,
  DollarSign,
  AlertTriangle,
  ChevronRight,
  Download,
  Mail,
  CheckCircle2,
  AlertCircle,
  FileSearch,
  Activity,
  Search,
  Bell,
  Menu,
  ChevronDown
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function ClaimsAuditDashboard() {
  const [activeTab, setActiveTab] = useState("defects")
  const [activeDoc, setActiveDoc] = useState("desk")

  return (
    <div className="min-h-screen bg-gray-50 flex font-['Inter'] text-slate-900">
      {/* 1. LEFT SIDEBAR */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 transition-all duration-300">
        <div className="h-16 flex items-center px-6 border-b border-slate-800">
          <div className="flex items-center gap-2 text-white font-bold text-xl tracking-tight">
            <Activity className="h-6 w-6 text-blue-500" />
            Claims iQ
          </div>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1">
          <SidebarItem icon={<LayoutDashboard size={20} />} label="Dashboard" />
          <SidebarItem icon={<FileText size={20} />} label="Claims" active />
          <SidebarItem icon={<Upload size={20} />} label="Upload/Ingest" />
          <SidebarItem icon={<ClipboardCheck size={20} />} label="Audit Results" />
          <SidebarItem icon={<Settings size={20} />} label="Settings" />
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium text-white">
              JD
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium text-white truncate">John Doe</p>
              <p className="text-xs text-slate-400 truncate">Senior Auditor</p>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 5. TOP ACTION BAR */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium text-slate-500 flex items-center gap-2">
              <span className="hover:text-slate-900 cursor-pointer transition-colors">Claims</span>
              <ChevronRight size={16} />
              <span className="text-slate-900 font-semibold">CLM-2024-00847</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="hidden lg:flex gap-2">
              <Mail className="h-4 w-4" />
              Generate Carrier Email
            </Button>
            <Button variant="outline" size="sm" className="hidden md:flex gap-2">
              <Download className="h-4 w-4" />
              Export Report (PDF)
            </Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white gap-2 border-transparent">
              <CheckCircle2 className="h-4 w-4" />
              Mark Ready for Submission
            </Button>
          </div>
        </header>

        {/* 3-COLUMN LAYOUT */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* COLUMN 1 - CLAIM SUMMARY PANEL */}
          <div className="w-72 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-y-auto hidden md:flex">
            <div className="p-5 space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center justify-between">
                  Claim Details
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-transparent shadow-none">
                    Analyzed
                  </Badge>
                </h2>
                
                <div className="space-y-4">
                  <DetailItem label="Claim Number" value="CLM-2024-00847" />
                  <DetailItem label="Insured" value="Morrison Properties LLC" />
                  <DetailItem label="Date of Loss" value="January 15, 2024" />
                  <DetailItem label="Peril" value="Wind/Hail" />
                  <DetailItem label="Total Estimate" value="$42,550.00" />
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">
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
                <Button className="w-full bg-slate-900 hover:bg-slate-800 text-white">
                  Run Final Audit
                </Button>
              </div>
            </div>
          </div>

          {/* COLUMN 2 - CENTER SCORECARD */}
          <ScrollArea className="flex-1 bg-slate-50/50 relative">
            <div className="max-w-4xl mx-auto p-6 space-y-6">
              
              {/* TOP SECTION */}
              <Card className="border-slate-200 shadow-sm bg-white overflow-hidden relative">
                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-6">
                      <div className="relative w-24 h-24 flex items-center justify-center rounded-full">
                        <svg className="w-full h-full transform -rotate-90 absolute top-0 left-0" viewBox="0 0 36 36">
                          <path
                            className="text-slate-100"
                            strokeWidth="3"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            className="text-emerald-500"
                            strokeWidth="3"
                            strokeDasharray="82, 100"
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                        </svg>
                        <div className="text-center">
                          <span className="text-3xl font-bold text-slate-900">82</span>
                          <span className="text-xs text-slate-500 block -mt-1">/100</span>
                        </div>
                      </div>
                      
                      <div>
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">Audit Score</h2>
                        <div className="flex gap-2">
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50 shadow-none">
                            Low Risk
                          </Badge>
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50 shadow-none">
                            Recommend Approval
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="text-sm text-slate-500 max-w-xs text-right hidden md:block">
                      Based on our AI analysis of 5 documents and 24 photos against carrier guidelines.
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* SCORE BREAKDOWN */}
              <div>
                <h3 className="text-sm font-semibold text-slate-800 mb-3 ml-1">Score Breakdown</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <ScoreCard 
                    label="Coverage Clarity" 
                    score={88} 
                    icon={<Shield size={16} />} 
                    color="emerald" 
                  />
                  <ScoreCard 
                    label="Scope Completeness" 
                    score={76} 
                    icon={<CheckSquare size={16} />} 
                    color="amber" 
                  />
                  <ScoreCard 
                    label="Estimate Accuracy" 
                    score={85} 
                    icon={<Calculator size={16} />} 
                    color="emerald" 
                  />
                  <ScoreCard 
                    label="Doc Support" 
                    score={90} 
                    icon={<FileCheck size={16} />} 
                    color="emerald" 
                  />
                  <ScoreCard 
                    label="Financial Accuracy" 
                    score={79} 
                    icon={<DollarSign size={16} />} 
                    color="amber" 
                  />
                  <ScoreCard 
                    label="Carrier Risk" 
                    score={74} 
                    icon={<AlertTriangle size={16} />} 
                    color="amber" 
                  />
                </div>
              </div>

              {/* EXECUTIVE SUMMARY */}
              <Card className="border-slate-200 shadow-sm bg-white">
                <CardHeader className="pb-3 pt-5 px-5">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-blue-500" />
                      Executive Summary
                    </CardTitle>
                    <Badge variant="outline" className="text-xs text-blue-600 bg-blue-50 border-blue-200">AI Generated</Badge>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  <p className="text-sm text-slate-600 leading-relaxed">
                    This claim generally aligns with policy coverage and standard pricing guidelines. The overall scope of repairs for the wind/hail damage is appropriate, and the provided field photos (24) well-substantiate the roof replacements. However, there are minor discrepancies regarding the depreciation calculation for the roofing materials and documentation of Overhead & Profit (O&P) that should be reviewed prior to final approval.
                  </p>
                </CardContent>
              </Card>

              {/* TABS SECTION */}
              <div className="pt-2 pb-10">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="bg-slate-100 p-1 w-full flex mb-4 border border-slate-200 h-auto">
                    <TabsTrigger value="defects" className="flex-1 text-sm py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                      Defects <Badge className="ml-2 bg-slate-200 text-slate-700 hover:bg-slate-200 shadow-none">3</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="questions" className="flex-1 text-sm py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                      Carrier Questions <Badge className="ml-2 bg-slate-200 text-slate-700 hover:bg-slate-200 shadow-none">2</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="risks" className="flex-1 text-sm py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                      Risks <Badge className="ml-2 bg-slate-200 text-slate-700 hover:bg-slate-200 shadow-none">4</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="deferred" className="flex-1 text-sm py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                      Deferred Items <Badge className="ml-2 bg-slate-200 text-slate-700 hover:bg-slate-200 shadow-none">1</Badge>
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
                    <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">
                      <FileSearch className="h-10 w-10 mx-auto text-slate-300 mb-3" />
                      <p className="font-medium text-slate-700">2 Carrier Questions Identified</p>
                      <p className="text-sm mt-1">Select this tab to view questions to escalate to the carrier.</p>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="risks" className="mt-0">
                    <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">
                      <AlertTriangle className="h-10 w-10 mx-auto text-slate-300 mb-3" />
                      <p className="font-medium text-slate-700">4 Potential Risks</p>
                      <p className="text-sm mt-1">Select this tab to view identified claim risks.</p>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="deferred" className="mt-0">
                    <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">
                      <ClipboardCheck className="h-10 w-10 mx-auto text-slate-300 mb-3" />
                      <p className="font-medium text-slate-700">1 Deferred Item</p>
                      <p className="text-sm mt-1">Select this tab to view items deferred for later review.</p>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </ScrollArea>

          {/* COLUMN 3 - RIGHT PANEL - DOCUMENT VIEWER */}
          <div className="w-80 bg-white border-l border-slate-200 flex flex-col shrink-0 hidden xl:flex">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Document Viewer</h2>
              <div className="flex bg-slate-100 rounded-md p-0.5 w-full">
                <button 
                  className={`flex-1 text-xs py-1.5 px-2 rounded-sm font-medium transition-colors ${activeDoc === 'desk' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                  onClick={() => setActiveDoc('desk')}
                >
                  Desk Rpt
                </button>
                <button 
                  className={`flex-1 text-xs py-1.5 px-2 rounded-sm font-medium transition-colors ${activeDoc === 'est' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                  onClick={() => setActiveDoc('est')}
                >
                  Estimate
                </button>
                <button 
                  className={`flex-1 text-xs py-1.5 px-2 rounded-sm font-medium transition-colors ${activeDoc === 'photos' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                  onClick={() => setActiveDoc('photos')}
                >
                  Photos
                </button>
              </div>
            </div>

            <ScrollArea className="flex-1 bg-slate-100 p-4">
              {/* Simulated PDF Document */}
              <div className="bg-white rounded shadow-sm border border-slate-200 w-full min-h-[600px] p-6 text-xs font-serif leading-relaxed text-slate-800">
                <div className="text-center font-bold text-sm mb-6 pb-4 border-b border-slate-200 uppercase tracking-widest">
                  Desk Adjuster Report
                </div>
                
                <p className="mb-4">
                  <strong>Claim #:</strong> CLM-2024-00847<br/>
                  <strong>Insured:</strong> Morrison Properties LLC<br/>
                  <strong>Date:</strong> Jan 20, 2024
                </p>

                <h4 className="font-bold text-slate-900 mt-6 mb-2 uppercase text-[10px] tracking-wider">Summary of Findings</h4>
                <p className="mb-4 text-justify">
                  Inspection of the property revealed significant wind and hail damage consistent with the reported date of loss. The primary dwelling sustained damage to the architectural shingle roof, particularly on the west and south facing slopes.
                </p>

                <h4 className="font-bold text-slate-900 mt-6 mb-2 uppercase text-[10px] tracking-wider">Scope Notes</h4>
                <p className="mb-4 text-justify">
                  Full roof replacement is recommended. <span className="bg-amber-100 text-amber-900 px-1 py-0.5 rounded outline outline-1 outline-amber-300">Overhead and profit (10/10) has been applied to the estimate due to the coordination required between the roofing contractor and the siding repair team.</span> The north elevation siding also shows signs of minor wind damage, though further inspection may be necessary as access was limited during the initial visit.
                </p>
                
                <h4 className="font-bold text-slate-900 mt-6 mb-2 uppercase text-[10px] tracking-wider">Depreciation Notes</h4>
                <p className="mb-4 text-justify">
                  <span className="bg-amber-100 text-amber-900 px-1 py-0.5 rounded outline outline-1 outline-amber-300">The current estimate reflects RCV (Replacement Cost Value) for the roofing materials.</span> Age of roof is estimated at 15 years based on homeowner records.
                </p>
              </div>
            </ScrollArea>
          </div>

        </div>
      </main>
    </div>
  )
}

// --- SUB-COMPONENTS ---

function SidebarItem({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
      active 
        ? 'bg-blue-600/10 text-blue-500 font-medium' 
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
    }`}>
      <div className={active ? 'text-blue-500' : 'text-slate-400'}>
        {icon}
      </div>
      <span className="text-sm">{label}</span>
    </div>
  )
}

function DetailItem({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  )
}

function DocumentItem({ name, type, date, active = false }: { name: string, type: 'pdf' | 'doc' | 'esx' | 'img', date: string, active?: boolean }) {
  const getIcon = () => {
    switch(type) {
      case 'pdf': return <FileText className="h-4 w-4 text-rose-500" />;
      case 'doc': return <FileText className="h-4 w-4 text-blue-500" />;
      case 'esx': return <Calculator className="h-4 w-4 text-emerald-500" />;
      case 'img': return <FileText className="h-4 w-4 text-amber-500" />;
      default: return <FileText className="h-4 w-4 text-slate-400" />;
    }
  }

  return (
    <div className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
      active ? 'bg-blue-50 border border-blue-100' : 'hover:bg-slate-50 border border-transparent'
    }`}>
      <div className="flex items-center gap-2 overflow-hidden">
        {getIcon()}
        <span className={`text-sm truncate ${active ? 'text-blue-900 font-medium' : 'text-slate-700'}`}>
          {name}
        </span>
      </div>
      <span className="text-xs text-slate-400 shrink-0">{date}</span>
    </div>
  )
}

function ScoreCard({ label, score, icon, color }: { label: string, score: number, icon: React.ReactNode, color: 'emerald' | 'amber' | 'rose' }) {
  const colorStyles = {
    emerald: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      icon: 'text-emerald-500',
      progress: 'bg-emerald-500',
      progressBg: 'bg-emerald-100',
    },
    amber: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      icon: 'text-amber-500',
      progress: 'bg-amber-500',
      progressBg: 'bg-amber-100',
    },
    rose: {
      bg: 'bg-rose-50',
      text: 'text-rose-700',
      icon: 'text-rose-500',
      progress: 'bg-rose-500',
      progressBg: 'bg-rose-100',
    }
  };

  const style = colorStyles[color];

  return (
    <Card className="border-slate-200 shadow-sm overflow-hidden bg-white">
      <CardContent className="p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${style.bg} ${style.icon}`}>
              {icon}
            </div>
            <span className="text-sm font-medium text-slate-700">{label}</span>
          </div>
          <span className={`text-lg font-bold ${style.text}`}>{score}</span>
        </div>
        
        {/* Custom Progress Bar to handle colors */}
        <div className={`h-2 w-full overflow-hidden rounded-full ${style.progressBg}`}>
          <div 
            className={`h-full ${style.progress} transition-all duration-500 ease-in-out`} 
            style={{ width: `${score}%` }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function DefectCard({ severity, title, description, category }: { severity: 'critical' | 'warning', title: string, description: string, category: string }) {
  const isCritical = severity === 'critical';
  const colorClass = isCritical ? 'bg-rose-500' : 'bg-amber-500';
  const bgClass = isCritical ? 'bg-rose-50 border-rose-100' : 'bg-white border-slate-200';
  const icon = isCritical ? <AlertCircle className="h-4 w-4 text-rose-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />;

  return (
    <div className={`border rounded-lg p-4 flex gap-4 transition-all hover:shadow-md ${bgClass}`}>
      <div className="mt-1 shrink-0">
        <div className={`w-2.5 h-2.5 rounded-full ${colorClass} mt-1`} />
      </div>
      <div className="flex-1">
        <div className="flex items-start justify-between gap-4 mb-1">
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider shrink-0 bg-white">
            {category}
          </Badge>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          {description}
        </p>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs px-2 bg-white">View in Document</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2 bg-white">Dismiss</Button>
        </div>
      </div>
    </div>
  )
}
