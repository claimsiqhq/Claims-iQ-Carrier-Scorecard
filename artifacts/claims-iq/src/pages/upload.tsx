import React, { useState, useCallback, useRef } from "react"
import { BRAND, FONTS } from "@/lib/brand"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useListClaims } from "@workspace/api-client-react"
import { useUpload } from "@workspace/object-storage-web"
import {
  CloudUpload,
  Trash,
  CheckCircle,
  WarningTriangle,
  Page,
  Folder,
  NavArrowDown,
  RefreshDouble,
  Plus,
} from "iconoir-react"

type UploadStatus = "idle" | "uploading" | "registering" | "extracting" | "complete" | "error"

export default function UploadPage() {
  const { data: claims, refetch: refetchClaims } = useListClaims()
  const [selectedClaimId, setSelectedClaimId] = useState<string>("")
  const [showNewClaim, setShowNewClaim] = useState(false)
  const [newClaim, setNewClaim] = useState({ claimNumber: "", insuredName: "", carrier: "", dateOfLoss: "" })
  const [creating, setCreating] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle")
  const [uploadedFile, setUploadedFile] = useState<{ name: string; id?: string; preview?: string } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const baseUrl = import.meta.env.VITE_API_URL || "/api"

  const { uploadFile, isUploading } = useUpload({
    basePath: `${baseUrl}/storage`,
    onError: (err) => console.error("Upload error:", err),
  })

  const handleFile = useCallback(async (file: File) => {
    if (!selectedClaimId) {
      alert("Please select a claim first.")
      return
    }

    setUploadStatus("uploading")
    setUploadError(null)
    setUploadedFile({ name: file.name })

    try {
      const result = await uploadFile(file)
      if (!result) throw new Error("Upload to storage failed")

      setUploadStatus("registering")

      const regRes = await fetch(`${baseUrl}/claims/${selectedClaimId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "claim_file",
          objectPath: result.objectPath,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      })

      if (!regRes.ok) throw new Error("Failed to register document")
      const doc = await regRes.json()

      if (file.type === "application/pdf" || file.type?.startsWith("text/")) {
        setUploadStatus("extracting")

        const extractRes = await fetch(`${baseUrl}/claims/${selectedClaimId}/documents/${doc.id}/extract`, {
          method: "POST",
        })

        if (extractRes.ok) {
          const extractData = await extractRes.json()
          setUploadedFile({ name: file.name, id: doc.id, preview: extractData.preview })
        } else {
          setUploadedFile({ name: file.name, id: doc.id })
        }
      } else {
        setUploadedFile({ name: file.name, id: doc.id })
      }

      setUploadStatus("complete")
    } catch (err: any) {
      setUploadStatus("error")
      setUploadError(err.message || "Upload failed")
    }
  }, [selectedClaimId, uploadFile, baseUrl])

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

  const handleRemove = useCallback(async () => {
    if (!uploadedFile?.id || !selectedClaimId) return
    try {
      await fetch(`${baseUrl}/claims/${selectedClaimId}/documents/${uploadedFile.id}`, { method: "DELETE" })
    } catch {}
    setUploadedFile(null)
    setUploadStatus("idle")
    setUploadError(null)
  }, [uploadedFile, selectedClaimId, baseUrl])

  const handleReplace = useCallback(() => {
    setUploadedFile(null)
    setUploadStatus("idle")
    setUploadError(null)
    fileInputRef.current?.click()
  }, [])

  const handleCreateClaim = useCallback(async () => {
    if (!newClaim.claimNumber || !newClaim.insuredName) return
    setCreating(true)
    try {
      const res = await fetch(`${baseUrl}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newClaim),
      })
      if (!res.ok) throw new Error("Failed to create claim")
      const created = await res.json()
      await refetchClaims()
      setSelectedClaimId(created.id)
      setShowNewClaim(false)
      setNewClaim({ claimNumber: "", insuredName: "", carrier: "", dateOfLoss: "" })
    } catch (err: any) {
      alert(err.message || "Failed to create claim")
    } finally {
      setCreating(false)
    }
  }, [newClaim, baseUrl, refetchClaims])

  const selectedClaim = claims?.find((c) => c.id === selectedClaimId)
  const isBusy = uploadStatus === "uploading" || uploadStatus === "registering" || uploadStatus === "extracting"

  const statusLabels: Record<UploadStatus, string> = {
    idle: "",
    uploading: "Uploading file to storage...",
    registering: "Registering document...",
    extracting: "Extracting text from PDF...",
    complete: "File uploaded and parsed successfully",
    error: uploadError || "Upload failed",
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-16 flex items-center px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <h1 className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Upload / Ingest</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-2xl mx-auto space-y-6">
          <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
            <CardContent className="p-5 space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider mb-2 block" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                  Select Claim
                </label>
                <div className="relative">
                  <select
                    className="w-full appearance-none rounded-lg border px-3 py-2.5 text-sm pr-8"
                    style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.body, backgroundColor: BRAND.white }}
                    value={selectedClaimId}
                    onChange={(e) => { setSelectedClaimId(e.target.value); setUploadedFile(null); setUploadStatus("idle"); setUploadError(null) }}
                  >
                    <option value="">— Choose a claim —</option>
                    {claims?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.claimNumber} — {c.insuredName}
                      </option>
                    ))}
                  </select>
                  <NavArrowDown width={16} height={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: BRAND.purpleSecondary }} />
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 mt-1"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                onClick={() => setShowNewClaim(!showNewClaim)}
              >
                <Plus width={14} height={14} />
                {showNewClaim ? "Cancel" : "New Claim"}
              </Button>

              {showNewClaim && (
                <div className="rounded-lg p-4 space-y-3" style={{ backgroundColor: BRAND.offWhite, border: `1px solid ${BRAND.greyLavender}` }}>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Claim Number *</label>
                      <input className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.mono }} placeholder="CLM-00062950" value={newClaim.claimNumber} onChange={(e) => setNewClaim({ ...newClaim, claimNumber: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Insured Name *</label>
                      <input className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.body }} placeholder="John Smith" value={newClaim.insuredName} onChange={(e) => setNewClaim({ ...newClaim, insuredName: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Carrier</label>
                      <input className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.body }} placeholder="Bay State Insurance" value={newClaim.carrier} onChange={(e) => setNewClaim({ ...newClaim, carrier: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Date of Loss</label>
                      <input type="date" className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.mono }} value={newClaim.dateOfLoss} onChange={(e) => setNewClaim({ ...newClaim, dateOfLoss: e.target.value })} />
                    </div>
                  </div>
                  <Button
                    className="w-full text-white gap-2"
                    style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                    onClick={handleCreateClaim}
                    disabled={creating || !newClaim.claimNumber || !newClaim.insuredName}
                  >
                    {creating ? "Creating..." : "Create Claim"}
                  </Button>
                </div>
              )}

              {selectedClaim && (
                <div className="rounded-lg p-3 flex items-center gap-3" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
                  <Folder width={18} height={18} style={{ color: BRAND.purple }} />
                  <div>
                    <span className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.mono }}>{selectedClaim.claimNumber}</span>
                    <span className="text-sm ml-2" style={{ color: BRAND.purpleSecondary }}>{selectedClaim.insuredName}</span>
                  </div>
                  <Badge className="ml-auto shadow-none text-xs" style={{ backgroundColor: selectedClaim.status === "analyzed" ? "#e8f5e9" : BRAND.offWhite, color: selectedClaim.status === "analyzed" ? "#2e7d32" : BRAND.purple }}>
                    {selectedClaim.status}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {uploadStatus === "idle" || uploadStatus === "error" ? (
            <div
              className="border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center transition-all cursor-pointer"
              style={{
                borderColor: dragOver ? BRAND.purple : selectedClaimId ? BRAND.purpleSecondary : BRAND.greyLavender,
                backgroundColor: dragOver ? BRAND.lightPurpleGrey : BRAND.white,
                opacity: selectedClaimId ? 1 : 0.5,
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => selectedClaimId && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleInputChange}
              />
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
                <CloudUpload width={32} height={32} style={{ color: BRAND.purple }} />
              </div>
              <p className="text-lg font-semibold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                {dragOver ? "Drop your claim file here" : "Upload Claim File"}
              </p>
              <p className="text-sm mb-1" style={{ color: BRAND.purpleSecondary }}>
                {selectedClaimId
                  ? "Drag & drop the complete claim PDF here, or click to browse."
                  : "Select a claim above first."}
              </p>
              <p className="text-xs mb-4" style={{ color: BRAND.purpleSecondary }}>
                Upload one PDF containing the full claim package (DA report, SOL, payment letter, FA report, estimate, photos, etc.)
              </p>
              {selectedClaimId && (
                <Button
                  className="gap-2 text-white"
                  style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                  disabled={isBusy}
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                >
                  <CloudUpload width={16} height={16} />
                  Choose PDF File
                </Button>
              )}
              {uploadStatus === "error" && uploadError && (
                <p className="text-sm mt-4 px-4 py-2 rounded-lg" style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}>
                  {uploadError}
                </p>
              )}
            </div>
          ) : (
            <Card className="shadow-sm" style={{ borderColor: uploadStatus === "complete" ? "#bbf7d0" : BRAND.greyLavender, backgroundColor: BRAND.white }}>
              <CardContent className="p-5">
                {isBusy && (
                  <div className="flex flex-col items-center py-8">
                    <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin mb-4" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
                    <p className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                      {statusLabels[uploadStatus]}
                    </p>
                    <p className="text-xs mt-1" style={{ color: BRAND.purpleSecondary }}>{uploadedFile?.name}</p>
                  </div>
                )}

                {uploadStatus === "complete" && uploadedFile && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: "#e8f5e9" }}>
                        <CheckCircle width={22} height={22} style={{ color: "#16a34a" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                          File Uploaded Successfully
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Page width={14} height={14} style={{ color: BRAND.purple }} />
                          <span className="text-xs truncate" style={{ color: BRAND.purpleSecondary }}>{uploadedFile.name}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple }}
                          onClick={handleReplace}
                        >
                          <RefreshDouble width={14} height={14} />
                          Replace
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          style={{ color: "#dc2626" }}
                          onClick={handleRemove}
                        >
                          <Trash width={16} height={16} />
                        </Button>
                      </div>
                    </div>

                    {uploadedFile.preview && (
                      <div className="rounded-lg p-3" style={{ backgroundColor: BRAND.offWhite, border: `1px solid ${BRAND.greyLavender}` }}>
                        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                          Extracted Text Preview
                        </p>
                        <p className="text-xs leading-relaxed line-clamp-6" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>
                          {uploadedFile.preview}
                        </p>
                      </div>
                    )}

                    <p className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                      The claim file has been parsed. Go to the claim detail page to run a carrier audit.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  )
}
