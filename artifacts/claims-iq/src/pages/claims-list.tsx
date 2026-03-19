import React, { useState, useCallback, useRef } from "react"
import { useToast } from "@/hooks/use-toast"
import { BRAND, FONTS } from "@/lib/brand"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useListClaims } from "@workspace/api-client-react"
import { useLocation } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  PageEdit,
  CloudUpload,
  CheckCircle,
  Page,
  RefreshDouble,
  ArrowRight,
  Restart,
  WarningTriangle,
} from "iconoir-react"

type IngestStatus = "idle" | "uploading" | "extracting" | "parsing" | "complete" | "error"

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
  document: { id: string; fileName: string; extractedLength: number; storagePath: string }
  parsedData: ParsedClaimData
}

const statusColors: Record<string, { bg: string; color: string }> = {
  analyzed: { bg: "#e8f5e9", color: "#2e7d32" },
  approved: { bg: "#e3f2fd", color: "#1565c0" },
  pending: { bg: "#fef9ec", color: BRAND.gold },
  processing: { bg: `${BRAND.purple}14`, color: BRAND.purple },
  error: { bg: "#fef2f2", color: "#dc2626" },
  denied: { bg: "#fef2f2", color: "#dc2626" },
  review: { bg: BRAND.lightPurpleGrey, color: BRAND.purple },
}

export default function ClaimsListPage() {
  const { data: claims, isLoading } = useListClaims()
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [status, setStatus] = useState<IngestStatus>("idle")
  const [fileName, setFileName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IngestResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [retryingClaims, setRetryingClaims] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const baseUrl = import.meta.env.VITE_API_URL || "/api"

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setError("Please upload a PDF file.")
      setStatus("error")
      return
    }

    setStatus("uploading")
    setError(null)
    setFileName(file.name)
    setResult(null)

    try {
      setStatus("extracting")

      const formData = new FormData()
      formData.append("file", file)

      const ingestRes = await fetch(`${baseUrl}/ingest`, {
        method: "POST",
        body: formData,
        credentials: "include",
      })

      if (!ingestRes.ok) {
        const errBody = await ingestRes.json().catch(() => ({ error: "Processing failed" }))
        throw new Error(errBody.error || "Processing failed")
      }

      const data: IngestResult = await ingestRes.json()

      setStatus("extracting")
      const maxAttempts = 200
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        try {
          const statusRes = await fetch(`${baseUrl}/claims/${data.claim.id}/processing-status`, { credentials: "include" })
          if (!statusRes.ok) continue
          const ps = await statusRes.json()
          if (ps.status === "error") throw new Error(ps.error || "Extraction failed")
          if (ps.status === "ready") {
            data.claim.claimNumber = ps.claimNumber
            data.claim.insuredName = ps.insuredName
            break
          }
        } catch (pollErr: any) {
          if (pollErr.message && pollErr.message !== "Failed to fetch") throw pollErr
        }
      }

      setResult(data)
      setStatus("complete")
      queryClient.invalidateQueries({ queryKey: ["/claims"] })
    } catch (err: any) {
      setStatus("error")
      setError(err.message || "Failed to process file")
    }
  }, [baseUrl, queryClient])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    if (e.target) e.target.value = ""
  }, [handleFile])

  const handleReset = useCallback(() => {
    setStatus("idle")
    setFileName("")
    setError(null)
    setResult(null)
  }, [])

  const handleRetry = useCallback(async (claimId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setRetryingClaims((prev) => ({ ...prev, [claimId]: "retrying" }))
    try {
      const retryRes = await fetch(`${baseUrl}/claims/${claimId}/retry`, {
        method: "POST",
        credentials: "include",
      })
      if (!retryRes.ok) {
        const body = await retryRes.json().catch(() => ({ error: "Retry failed" }))
        const msg = body.error || "Retry failed"
        setRetryingClaims((prev) => ({ ...prev, [claimId]: msg }))
        toast({ title: "Retry failed", description: msg, variant: "destructive" })
        return
      }

      setRetryingClaims((prev) => ({ ...prev, [claimId]: "polling" }))
      const maxAttempts = 200
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        try {
          const statusRes = await fetch(`${baseUrl}/claims/${claimId}/processing-status`, { credentials: "include" })
          if (!statusRes.ok) continue
          const ps = await statusRes.json()
          if (ps.status === "error") {
            const msg = ps.error || "Processing failed"
            setRetryingClaims((prev) => ({ ...prev, [claimId]: msg }))
            toast({ title: "Retry failed", description: msg, variant: "destructive" })
            queryClient.invalidateQueries({ queryKey: ["/claims"] })
            return
          }
          if (ps.status === "ready") {
            setRetryingClaims((prev) => {
              const next = { ...prev }
              delete next[claimId]
              return next
            })
            queryClient.invalidateQueries({ queryKey: ["/claims"] })
            return
          }
        } catch (pollErr: any) {
          if (pollErr.message && pollErr.message !== "Failed to fetch") {
            setRetryingClaims((prev) => ({ ...prev, [claimId]: pollErr.message }))
            return
          }
        }
      }
      setRetryingClaims((prev) => ({ ...prev, [claimId]: "Timed out waiting for processing" }))
      toast({ title: "Retry timed out", description: "Processing is taking longer than expected. Check back later.", variant: "destructive" })
    } catch (err: any) {
      const msg = err.message || "Retry failed"
      setRetryingClaims((prev) => ({ ...prev, [claimId]: msg }))
      toast({ title: "Retry failed", description: msg, variant: "destructive" })
    }
  }, [baseUrl, queryClient, toast])

  const isBusy = status === "uploading" || status === "extracting" || status === "parsing"

  const statusLabels: Record<IngestStatus, string> = {
    idle: "",
    uploading: "Uploading file...",
    extracting: "Extracting text from PDF...",
    parsing: "AI is analyzing the claim...",
    complete: "Claim processed successfully",
    error: error || "Processing failed",
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-14 md:h-16 flex items-center justify-between px-4 md:px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <h1 className="text-base md:text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
          Claims
        </h1>
        {status === "idle" && (
          <Button
            className="gap-2 text-white text-sm"
            style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
            onClick={() => fileInputRef.current?.click()}
          >
            <CloudUpload width={16} height={16} />
            <span className="hidden sm:inline">New Claim</span>
            <span className="sm:hidden">Upload</span>
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-4xl mx-auto space-y-4">

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={handleInputChange}
          />

          {(status === "idle" || status === "error") && (!claims || claims.length === 0) && !isLoading && (
            <div
              className="border-2 border-dashed rounded-xl p-8 md:p-12 flex flex-col items-center justify-center text-center transition-all cursor-pointer"
              style={{
                borderColor: dragOver ? BRAND.purple : BRAND.purpleSecondary,
                backgroundColor: dragOver ? BRAND.lightPurpleGrey : BRAND.white,
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
                <CloudUpload width={28} height={28} style={{ color: BRAND.purple }} />
              </div>
              <p className="text-lg font-bold mb-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                {dragOver ? "Drop it here" : "Upload Your First Claim"}
              </p>
              <p className="text-sm mb-4" style={{ color: BRAND.purpleSecondary }}>
                Drop a claim PDF here or click to browse. We'll extract everything automatically.
              </p>
              <Button
                className="gap-2 text-white px-5"
                style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
              >
                <CloudUpload width={16} height={16} />
                Choose PDF
              </Button>
              {status === "error" && error && (
                <p className="text-sm mt-4 px-4 py-2 rounded-lg" style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}>
                  {error}
                </p>
              )}
            </div>
          )}

          {status === "error" && claims && claims.length > 0 && (
            <Card className="shadow-sm" style={{ borderColor: "#fca5a5", backgroundColor: BRAND.white }}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#dc2626" }}>{error}</p>
                  <p className="text-xs mt-0.5" style={{ color: BRAND.purpleSecondary }}>{fileName}</p>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleReset} style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple }}>
                  <RefreshDouble width={14} height={14} />
                  Dismiss
                </Button>
              </CardContent>
            </Card>
          )}

          {isBusy && (
            <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
              <CardContent className="p-6">
                <div className="flex flex-col items-center py-4">
                  <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin mb-4" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
                  <p className="text-sm font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                    {statusLabels[status]}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Page width={14} height={14} style={{ color: BRAND.purpleSecondary }} />
                    <span className="text-xs" style={{ color: BRAND.purpleSecondary }}>{fileName}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-5 w-full max-w-xs">
                    {["uploading", "extracting", "parsing"].map((step, i) => {
                      const steps = ["uploading", "extracting", "parsing"]
                      const currentIdx = steps.indexOf(status)
                      const isDone = i < currentIdx
                      const isActive = i === currentIdx
                      return (
                        <div key={step} className="flex-1">
                          <div className="h-1.5 rounded-full" style={{
                            backgroundColor: isDone ? BRAND.purple : isActive ? BRAND.purpleLight : BRAND.greyLavender,
                          }}>
                            {isActive && (
                              <div className="h-full rounded-full animate-pulse" style={{ backgroundColor: BRAND.purple, width: "60%" }} />
                            )}
                          </div>
                          <p className="text-[10px] mt-1 text-center" style={{
                            color: isDone || isActive ? BRAND.deepPurple : BRAND.purpleSecondary,
                            fontFamily: FONTS.heading,
                            fontWeight: isActive ? 700 : 400,
                          }}>
                            {step === "uploading" ? "Upload" : step === "extracting" ? "Extract" : "Parse"}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {status === "complete" && result && (
            <Card className="shadow-sm" style={{ borderColor: "#bbf7d0", backgroundColor: BRAND.white }}>
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "#e8f5e9" }}>
                    <CheckCircle width={20} height={20} style={{ color: "#16a34a" }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                      Claim Created — {result.parsedData.claimNumber || result.claim.claimNumber}
                    </p>
                    <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                      {result.document.extractedLength.toLocaleString()} characters extracted from {result.document.fileName}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                  <DataField label="Insured" value={result.parsedData.insuredName} />
                  <DataField label="Carrier" value={result.parsedData.carrier} />
                  <DataField label="Date of Loss" value={result.parsedData.dateOfLoss} mono />
                  <DataField label="Loss Type" value={result.parsedData.lossType} />
                  <DataField label="Total Claim" value={result.parsedData.totalClaimAmount} mono />
                  <DataField label="Deductible" value={result.parsedData.deductible} mono />
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Button
                    className="flex-1 gap-2 text-white"
                    style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                    onClick={() => setLocation(`/claims/${result.claim.id}`)}
                  >
                    View Claim & Run Audit
                    <ArrowRight width={16} height={16} />
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.heading, fontWeight: 600 }}
                    onClick={handleReset}
                  >
                    <RefreshDouble width={14} height={14} />
                    Upload Another
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isLoading && (
            <div className="text-center py-12">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
              <p className="text-sm" style={{ color: BRAND.purpleSecondary }}>Loading claims...</p>
            </div>
          )}

          {claims && claims.length > 0 && (
            <div
              className="space-y-3"
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {dragOver && (
                <div className="border-2 border-dashed rounded-xl p-6 flex items-center justify-center text-center" style={{ borderColor: BRAND.purple, backgroundColor: BRAND.lightPurpleGrey }}>
                  <p className="text-sm font-semibold" style={{ color: BRAND.purple }}>Drop PDF here to create a new claim</p>
                </div>
              )}
              {claims.map((claim) => {
                const sc = statusColors[claim.status] || statusColors.pending
                const retryState = retryingClaims[claim.id]
                const isRetrying = retryState === "retrying" || retryState === "polling"
                const retryError = retryState && !isRetrying ? retryState : null
                const canRetry = (claim.status === "processing" || claim.status === "error") && !isRetrying
                return (
                  <Card
                    key={claim.id}
                    className="shadow-sm cursor-pointer transition-all hover:shadow-md"
                    style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}
                    onClick={() => setLocation(`/claims/${claim.id}`)}
                  >
                    <CardContent className="p-4 md:p-5 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-lg" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
                          <PageEdit width={20} height={20} style={{ color: BRAND.purple }} />
                        </div>
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <span className="text-sm font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{claim.claimNumber}</span>
                            <Badge className="shadow-none text-xs border-transparent" style={{ backgroundColor: sc.bg, color: sc.color }}>
                              {isRetrying ? "Retrying…" : claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
                            </Badge>
                          </div>
                          <p className="text-sm" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>{claim.insuredName}</p>
                          {retryError && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <WarningTriangle width={12} height={12} style={{ color: "#dc2626" }} />
                              <p className="text-xs" style={{ color: "#dc2626" }}>{retryError}</p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {canRetry && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 shrink-0"
                            style={{ borderColor: BRAND.purple, color: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                            onClick={(e) => handleRetry(claim.id, e)}
                          >
                            <Restart width={14} height={14} />
                            Retry
                          </Button>
                        )}
                        {isRetrying && (
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
                            <span className="text-xs" style={{ color: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}>
                              {retryState === "retrying" ? "Starting…" : "Processing…"}
                            </span>
                          </div>
                        )}
                        <div className="text-right hidden sm:block">
                          <p className="text-xs" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
                            {claim.carrier}
                          </p>
                          <p className="text-xs" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>
                            {claim.dateOfLoss}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </main>
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
