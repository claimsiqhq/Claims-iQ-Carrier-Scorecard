import React, { useState, useCallback, useRef } from "react"
import { BRAND, FONTS } from "@/lib/brand"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useListClaims } from "@workspace/api-client-react"
import { useUpload } from "@workspace/object-storage-web"
import {
  CloudUpload,
  Plus,
  Trash,
  CheckCircle,
  WarningTriangle,
  Page,
  Folder,
  NavArrowDown,
} from "iconoir-react"

interface UploadedDoc {
  id: string
  fileName: string
  type: string
  objectPath: string
  contentType: string
  status: "uploading" | "uploaded" | "registering" | "registered" | "extracting" | "extracted" | "error"
  error?: string
  extractedPreview?: string
}

const DOC_TYPE_OPTIONS = [
  { value: "FNOL", label: "FNOL Report" },
  { value: "policy", label: "Policy Declaration" },
  { value: "estimate", label: "Xactimate Estimate" },
  { value: "photos", label: "Field Photos" },
  { value: "desk_report", label: "Desk Adjuster Report" },
  { value: "field_report", label: "Field Adjuster Report" },
  { value: "invoice", label: "Invoice / Receipt" },
  { value: "correspondence", label: "Correspondence" },
  { value: "other", label: "Other" },
]

export default function UploadPage() {
  const { data: claims } = useListClaims()
  const [selectedClaimId, setSelectedClaimId] = useState<string>("")
  const [docType, setDocType] = useState("FNOL")
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const baseUrl = import.meta.env.VITE_API_URL || "/api"

  const { uploadFile, isUploading } = useUpload({
    basePath: `${baseUrl}/storage`,
    onError: (err) => console.error("Upload error:", err),
  })

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    if (!selectedClaimId) {
      alert("Please select a claim first.")
      return
    }

    const fileArray = Array.from(files)

    for (const file of fileArray) {
      const tempId = crypto.randomUUID()

      setUploadedDocs((prev) => [...prev, {
        id: tempId,
        fileName: file.name,
        type: docType,
        objectPath: "",
        contentType: file.type || "application/octet-stream",
        status: "uploading",
      }])

      try {
        const result = await uploadFile(file)
        if (!result) throw new Error("Upload failed")

        setUploadedDocs((prev) =>
          prev.map((d) => d.id === tempId ? { ...d, objectPath: result.objectPath, status: "registering" } : d)
        )

        const regRes = await fetch(`${baseUrl}/claims/${selectedClaimId}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: docType,
            objectPath: result.objectPath,
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
          }),
        })

        if (!regRes.ok) throw new Error("Failed to register document")
        const doc = await regRes.json()

        setUploadedDocs((prev) =>
          prev.map((d) => d.id === tempId ? { ...d, id: doc.id, status: "registered" } : d)
        )

        if (file.type === "application/pdf" || file.type?.startsWith("text/")) {
          setUploadedDocs((prev) =>
            prev.map((d) => d.id === doc.id ? { ...d, status: "extracting" } : d)
          )

          const extractRes = await fetch(`${baseUrl}/claims/${selectedClaimId}/documents/${doc.id}/extract`, {
            method: "POST",
          })

          if (extractRes.ok) {
            const extractData = await extractRes.json()
            setUploadedDocs((prev) =>
              prev.map((d) => d.id === doc.id ? { ...d, status: "extracted", extractedPreview: extractData.preview } : d)
            )
          } else {
            setUploadedDocs((prev) =>
              prev.map((d) => d.id === doc.id ? { ...d, status: "registered" } : d)
            )
          }
        }
      } catch (err: any) {
        setUploadedDocs((prev) =>
          prev.map((d) => d.id === tempId ? { ...d, status: "error", error: err.message } : d)
        )
      }
    }
  }, [selectedClaimId, docType, uploadFile, baseUrl])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const handleDelete = useCallback(async (doc: UploadedDoc) => {
    if (!selectedClaimId) return
    try {
      await fetch(`${baseUrl}/claims/${selectedClaimId}/documents/${doc.id}`, { method: "DELETE" })
      setUploadedDocs((prev) => prev.filter((d) => d.id !== doc.id))
    } catch {
      console.error("Failed to delete document")
    }
  }, [selectedClaimId, baseUrl])

  const selectedClaim = claims?.find((c) => c.id === selectedClaimId)

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-16 flex items-center px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <h1 className="text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Upload / Ingest</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-3xl mx-auto space-y-6">
          <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
            <CardContent className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider mb-2 block" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                    Select Claim
                  </label>
                  <div className="relative">
                    <select
                      className="w-full appearance-none rounded-lg border px-3 py-2.5 text-sm pr-8"
                      style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.body, backgroundColor: BRAND.white }}
                      value={selectedClaimId}
                      onChange={(e) => setSelectedClaimId(e.target.value)}
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

                <div>
                  <label className="text-xs font-bold uppercase tracking-wider mb-2 block" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                    Document Type
                  </label>
                  <div className="relative">
                    <select
                      className="w-full appearance-none rounded-lg border px-3 py-2.5 text-sm pr-8"
                      style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.body, backgroundColor: BRAND.white }}
                      value={docType}
                      onChange={(e) => setDocType(e.target.value)}
                    >
                      {DOC_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <NavArrowDown width={16} height={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: BRAND.purpleSecondary }} />
                  </div>
                </div>
              </div>

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
              multiple
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.esx"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
              <CloudUpload width={32} height={32} style={{ color: BRAND.purple }} />
            </div>
            <p className="text-lg font-semibold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
              {dragOver ? "Drop files here" : "Drag & drop claim documents here"}
            </p>
            <p className="text-sm mb-4" style={{ color: BRAND.purpleSecondary }}>
              {selectedClaimId
                ? "or click to browse files. Supports PDF, DOCX, TXT, and image files."
                : "Select a claim above first, then upload documents."}
            </p>
            {selectedClaimId && (
              <Button
                className="gap-2 text-white"
                style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                disabled={isUploading}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
              >
                <Plus width={16} height={16} />
                {isUploading ? "Uploading..." : "Browse Files"}
              </Button>
            )}
          </div>

          {uploadedDocs.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                Uploaded Documents ({uploadedDocs.length})
              </h3>
              {uploadedDocs.map((doc) => (
                <Card key={doc.id} className="shadow-sm" style={{ borderColor: doc.status === "error" ? "#fca5a5" : BRAND.greyLavender, backgroundColor: BRAND.white }}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Page width={20} height={20} style={{ color: doc.status === "error" ? "#dc2626" : BRAND.purple }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.body }}>{doc.fileName}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                              {DOC_TYPE_OPTIONS.find((o) => o.value === doc.type)?.label || doc.type}
                            </span>
                            <StatusBadge status={doc.status} />
                          </div>
                          {doc.error && <p className="text-xs mt-1" style={{ color: "#dc2626" }}>{doc.error}</p>}
                          {doc.extractedPreview && (
                            <p className="text-xs mt-2 p-2 rounded line-clamp-3" style={{ backgroundColor: BRAND.offWhite, color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>
                              {doc.extractedPreview.substring(0, 200)}...
                            </p>
                          )}
                        </div>
                      </div>
                      {(doc.status === "registered" || doc.status === "extracted") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-2 shrink-0"
                          style={{ color: "#dc2626" }}
                          onClick={() => handleDelete(doc)}
                        >
                          <Trash width={16} height={16} />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function StatusBadge({ status }: { status: UploadedDoc["status"] }) {
  const config: Record<string, { label: string; bg: string; color: string }> = {
    uploading: { label: "Uploading...", bg: BRAND.lightPurpleGrey, color: BRAND.purple },
    uploaded: { label: "Uploaded", bg: BRAND.lightPurpleGrey, color: BRAND.purple },
    registering: { label: "Saving...", bg: BRAND.lightPurpleGrey, color: BRAND.purple },
    registered: { label: "Saved", bg: "#e8f5e9", color: "#2e7d32" },
    extracting: { label: "Extracting text...", bg: "#fef9ec", color: BRAND.gold },
    extracted: { label: "Text extracted", bg: "#e8f5e9", color: "#2e7d32" },
    error: { label: "Error", bg: "#fef2f2", color: "#dc2626" },
  }
  const c = config[status] || config.error
  return (
    <Badge className="shadow-none text-[10px] px-1.5 py-0" style={{ backgroundColor: c.bg, color: c.color, border: "none" }}>
      {(status === "uploading" || status === "registering" || status === "extracting") && (
        <span className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin mr-1 inline-block" />
      )}
      {(status === "registered" || status === "extracted") && (
        <CheckCircle width={10} height={10} className="mr-1 inline-block" />
      )}
      {status === "error" && (
        <WarningTriangle width={10} height={10} className="mr-1 inline-block" />
      )}
      {c.label}
    </Badge>
  )
}
