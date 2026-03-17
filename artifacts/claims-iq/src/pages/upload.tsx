import React, { useState, useCallback, useRef } from "react"
import { useLocation } from "wouter"
import { BRAND, FONTS } from "@/lib/brand"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useUpload } from "@workspace/object-storage-web"
import {
  CloudUpload,
  CheckCircle,
  Page,
  RefreshDouble,
  ArrowRight,
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
  document: { id: string; fileName: string; extractedLength: number }
  parsedData: ParsedClaimData
}

export default function UploadPage() {
  const [, setLocation] = useLocation()
  const [status, setStatus] = useState<IngestStatus>("idle")
  const [fileName, setFileName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IngestResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const baseUrl = import.meta.env.VITE_API_URL || "/api"

  const { uploadFile } = useUpload({
    basePath: `${baseUrl}/storage`,
    onError: (err) => console.error("Upload error:", err),
  })

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
      const uploadResult = await uploadFile(file)
      if (!uploadResult) throw new Error("Upload to storage failed")

      setStatus("extracting")

      const ingestRes = await fetch(`${baseUrl}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectPath: uploadResult.objectPath,
          fileName: file.name,
          contentType: file.type || "application/pdf",
        }),
      })

      if (!ingestRes.ok) {
        const errBody = await ingestRes.json().catch(() => ({ error: "Processing failed" }))
        throw new Error(errBody.error || "Processing failed")
      }

      setStatus("parsing")
      const data: IngestResult = await ingestRes.json()
      setResult(data)
      setStatus("complete")
    } catch (err: any) {
      setStatus("error")
      setError(err.message || "Failed to process file")
    }
  }, [uploadFile, baseUrl])

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
      <header className="h-16 flex items-center px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <h1 className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Upload / Ingest</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-2xl mx-auto space-y-6">

          {(status === "idle" || status === "error") && (
            <div
              className="border-2 border-dashed rounded-xl p-16 flex flex-col items-center justify-center text-center transition-all cursor-pointer"
              style={{
                borderColor: dragOver ? BRAND.purple : BRAND.purpleSecondary,
                backgroundColor: dragOver ? BRAND.lightPurpleGrey : BRAND.white,
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleInputChange}
              />
              <div className="w-20 h-20 rounded-full flex items-center justify-center mb-5" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
                <CloudUpload width={40} height={40} style={{ color: BRAND.purple }} />
              </div>
              <p className="text-xl font-bold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                {dragOver ? "Drop it here" : "Drop your claim file"}
              </p>
              <p className="text-sm mb-6" style={{ color: BRAND.purpleSecondary }}>
                Upload the complete claim PDF package and we'll extract everything automatically.
              </p>
              <Button
                className="gap-2 text-white px-6"
                style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
              >
                <CloudUpload width={16} height={16} />
                Choose PDF
              </Button>
              {status === "error" && error && (
                <p className="text-sm mt-5 px-4 py-2.5 rounded-lg" style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}>
                  {error}
                </p>
              )}
            </div>
          )}

          {isBusy && (
            <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
              <CardContent className="p-8">
                <div className="flex flex-col items-center py-6">
                  <div className="w-12 h-12 border-3 border-t-transparent rounded-full animate-spin mb-5" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
                  <p className="text-base font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                    {statusLabels[status]}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Page width={14} height={14} style={{ color: BRAND.purpleSecondary }} />
                    <span className="text-sm" style={{ color: BRAND.purpleSecondary }}>{fileName}</span>
                  </div>

                  <div className="flex items-center gap-3 mt-6 w-full max-w-xs">
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
            <div className="space-y-4">
              <Card className="shadow-sm" style={{ borderColor: "#bbf7d0", backgroundColor: BRAND.white }}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: "#e8f5e9" }}>
                      <CheckCircle width={22} height={22} style={{ color: "#16a34a" }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-base font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                        Claim Created Successfully
                      </p>
                      <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                        {result.document.extractedLength.toLocaleString()} characters extracted from {result.document.fileName}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <DataField label="Claim Number" value={result.parsedData.claimNumber} mono />
                    <DataField label="Insured Name" value={result.parsedData.insuredName} />
                    <DataField label="Carrier" value={result.parsedData.carrier} />
                    <DataField label="Date of Loss" value={result.parsedData.dateOfLoss} mono />
                    <DataField label="Policy Number" value={result.parsedData.policyNumber} mono />
                    <DataField label="Loss Type" value={result.parsedData.lossType} />
                    <DataField label="Property Address" value={result.parsedData.propertyAddress} full />
                    <DataField label="Adjuster" value={[result.parsedData.adjusterName, result.parsedData.adjusterCompany].filter(Boolean).join(" — ")} />
                    <DataField label="Total Claim" value={result.parsedData.totalClaimAmount} mono />
                    <DataField label="Deductible" value={result.parsedData.deductible} mono />
                  </div>

                  {result.parsedData.summary && (
                    <div className="rounded-lg p-3 mb-4" style={{ backgroundColor: BRAND.offWhite, border: `1px solid ${BRAND.greyLavender}` }}>
                      <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Summary</p>
                      <p className="text-sm leading-relaxed" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
                        {result.parsedData.summary}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
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
            </div>
          )}

        </div>
      </div>
    </main>
  )
}

function DataField({ label, value, mono, full }: { label: string; value: string; mono?: boolean; full?: boolean }) {
  if (!value) return null
  return (
    <div className={full ? "col-span-2" : ""}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.heading }}>{label}</p>
      <p className="text-sm" style={{ color: BRAND.deepPurple, fontFamily: mono ? FONTS.mono : FONTS.body }}>{value}</p>
    </div>
  )
}
