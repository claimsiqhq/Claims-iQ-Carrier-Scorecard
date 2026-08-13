import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Check,
  FileText,
  LoaderCircle,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react"
import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { intakeRecoveryKey } from "@/lib/tenant-state"
import { cn } from "@/lib/utils"

const MAX_FILE_SIZE = 100 * 1024 * 1024

type UploadStage =
  | "queued"
  | "uploading"
  | "extracting"
  | "auditing"
  | "ready"
  | "error"
  | "cancelled"

interface UploadItem {
  id: string
  file?: File
  fileName: string
  size?: number
  stage: UploadStage
  claimId?: string
  jobId?: string
  claimNumber?: string
  duplicate?: boolean
  error?: string
}

const stageCopy: Record<UploadStage, string> = {
  queued: "Ready for preflight",
  uploading: "Uploading securely",
  extracting: "Extracting source record",
  auditing: "Automatic carrier audit",
  ready: "Ready for review",
  error: "Attention required",
  cancelled: "Processing cancelled",
}

function readRecoveryQueue(recoveryKey: string | null): UploadItem[] {
  if (!recoveryKey) return []
  try {
    const stored = JSON.parse(localStorage.getItem(recoveryKey) || "[]") as Array<{
      id: string
      fileName: string
      claimId: string
      jobId?: string
      stage: UploadStage
    }>
    return stored
      .filter((item) => item.claimId)
      .map((item) => ({ ...item, stage: item.stage === "auditing" ? "auditing" : "extracting" }))
  } catch {
    return []
  }
}

export function UploadClaimsDialog({
  trigger,
  open: openProp,
  initialOpen = false,
  onOpenChange,
}: {
  trigger?: ReactNode
  open?: boolean
  initialOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { user, organization } = useAuth()
  const recoveryKey = useMemo(
    () => intakeRecoveryKey(user?.id, organization?.id),
    [organization?.id, user?.id],
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const resumedRef = useRef(new Set<string>())
  const cancelledRef = useRef(new Set<string>())
  const isControlled = openProp !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = useState(initialOpen)
  const open = isControlled ? openProp : uncontrolledOpen
  const [dragging, setDragging] = useState(false)
  const [queue, setQueue] = useState<UploadItem[]>(() => readRecoveryQueue(recoveryKey))
  const [processingBatch, setProcessingBatch] = useState(false)
  const [preflightMessage, setPreflightMessage] = useState<string | null>(null)
  const tenantName = organization?.name || "this tenant"

  useEffect(() => {
    if (!isControlled) setUncontrolledOpen(initialOpen)
  }, [initialOpen, isControlled])

  useEffect(() => {
    const resumable = queue.filter(
      (item) =>
        item.claimId &&
        (item.stage === "extracting" || item.stage === "auditing") &&
        !resumedRef.current.has(item.id),
    )
    resumable.forEach((item) => {
      resumedRef.current.add(item.id)
      void waitForCompletion(item.id, item.claimId!)
    })
    // waitForCompletion is intentionally keyed by queue recovery state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!recoveryKey) return
    try {
      const recoverable = queue
        .filter(
          (item) =>
            item.claimId
            && item.stage !== "ready"
            && item.stage !== "error"
            && item.stage !== "cancelled",
        )
        .map(({ id, fileName, claimId, jobId, stage }) => ({
          id,
          fileName,
          claimId,
          jobId,
          stage,
        }))
      if (recoverable.length) {
        localStorage.setItem(recoveryKey, JSON.stringify(recoverable))
      } else {
        localStorage.removeItem(recoveryKey)
      }
    } catch {
      // Recovery is an enhancement; processing remains server-owned.
    }
  }, [queue, recoveryKey])

  const setDialogOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setQueue((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const refreshClaims = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      queryClient.invalidateQueries({ queryKey: queryKeys.claims }),
    ])
  }, [queryClient])

  const waitForCompletion = useCallback(
    async (itemId: string, claimId: string) => {
      for (let attempt = 0; attempt < 240; attempt += 1) {
        try {
          const status = await api.getProcessingStatus(claimId)
          const job = status.job
          if (
            status.systemStatus === "error" ||
            status.aiStatus === "failed" ||
            job?.status === "failed" ||
            job?.status === "cancelled"
          ) {
            throw new Error(job?.error?.message || "The server could not process this claim.")
          }

          const processingStage =
            job?.stage === "auditing" || status.aiStatus === "running" ? "auditing" : "extracting"
          updateItem(itemId, { stage: processingStage, jobId: job?.id, error: undefined })

          if (
            status.systemStatus === "ready" ||
            job?.status === "succeeded" ||
            job?.status === "degraded"
          ) {
            const detail = await api.getClaim(claimId)
            if (detail.audit || detail.claim.aiStatus === "succeeded" || detail.claim.status === "analyzed") {
              updateItem(itemId, {
                stage: "ready",
                claimNumber: detail.claim.claimNumber,
              })
              await refreshClaims()
              return
            }
            if (detail.claim.status === "error" || detail.claim.aiStatus === "failed") {
              throw new Error(detail.claim.summary || "Automatic audit failed.")
            }
          }
        } catch (error) {
          if (cancelledRef.current.has(itemId)) return
          updateItem(itemId, {
            stage: "error",
            error: apiErrorMessage(error, "Processing failed."),
          })
          return
        }
        await new Promise((resolve) => window.setTimeout(resolve, 3_000))
      }

      updateItem(itemId, {
        stage: "auditing",
        error: "The server is still working. Progress will recover when you return.",
      })
    },
    [refreshClaims, updateItem],
  )

  const ingestItem = useCallback(
    async (item: UploadItem) => {
      if (!item.file) return
      updateItem(item.id, { stage: "uploading", error: undefined })
      try {
        const result = await api.ingest(item.file)
        const claimId = result.claim?.id || result.job.claimId
        if (!claimId) throw new Error("The server queued this file without a claim identifier.")
        updateItem(item.id, {
          stage: "extracting",
          claimId,
          jobId: result.job.id,
          claimNumber: result.claim?.claimNumber,
          duplicate: result.duplicate === true,
        })
        await waitForCompletion(item.id, claimId)
      } catch (error) {
        updateItem(item.id, {
          stage: "error",
          error: apiErrorMessage(error, "Upload failed."),
        })
      }
    },
    [updateItem, waitForCompletion],
  )

  const addFiles = useCallback((files: File[]) => {
    const accepted: UploadItem[] = []
    const messages: string[] = []
    files.forEach((file) => {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      if (!isPdf) {
        messages.push(`${file.name}: PDF files only`)
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        messages.push(`${file.name}: exceeds the 100 MB limit`)
        return
      }
      accepted.push({
        id: `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
        file,
        fileName: file.name,
        size: file.size,
        stage: "queued",
      })
    })
    if (accepted.length) setQueue((items) => [...items, ...accepted])
    setPreflightMessage(messages.length ? messages.join(" · ") : null)
  }, [])

  const startBatch = async () => {
    const queued = queue.filter((item) => item.stage === "queued" && item.file)
    if (!queued.length) return
    setProcessingBatch(true)
    for (let index = 0; index < queued.length; index += 3) {
      await Promise.all(queued.slice(index, index + 3).map(ingestItem))
    }
    setProcessingBatch(false)
  }

  const retryItem = async (item: UploadItem) => {
    cancelledRef.current.delete(item.id)
    updateItem(item.id, { error: undefined })
    if (item.claimId) {
      try {
        updateItem(item.id, { stage: "extracting" })
        await api.retryClaim(item.claimId)
        await waitForCompletion(item.id, item.claimId)
      } catch (error) {
        updateItem(item.id, { stage: "error", error: apiErrorMessage(error) })
      }
      return
    }
    await ingestItem({ ...item, stage: "queued" })
  }

  const cancelItem = async (item: UploadItem) => {
    if (!item.jobId) return
    cancelledRef.current.add(item.id)
    try {
      await api.cancelJob(item.jobId)
      updateItem(item.id, {
        stage: "cancelled",
        error: undefined,
      })
      await refreshClaims()
    } catch (error) {
      cancelledRef.current.delete(item.id)
      updateItem(item.id, {
        stage: "error",
        error: apiErrorMessage(error, "The processing job could not be cancelled."),
      })
    }
  }

  const queuedCount = queue.filter((item) => item.stage === "queued").length
  const activeCount = queue.filter((item) =>
    ["uploading", "extracting", "auditing"].includes(item.stage),
  ).length
  const readyCount = queue.filter((item) => item.stage === "ready").length
  const hasQueue = queue.length > 0
  const overallMessage = useMemo(() => {
    if (activeCount) return `${activeCount} claim${activeCount === 1 ? "" : "s"} processing`
    if (readyCount) return `${readyCount} claim${readyCount === 1 ? "" : "s"} ready`
    return `${queuedCount} file${queuedCount === 1 ? "" : "s"} queued`
  }, [activeCount, queuedCount, readyCount])

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-[var(--ciq-border)] px-5 pb-4 pt-5 text-left">
          <span className="ciq-eyebrow !mb-1 !text-[var(--ciq-financial)]">Claim intake</span>
          <DialogTitle className="font-[var(--ciq-font-serif)] text-2xl">
            Add source packages to the ledger
          </DialogTitle>
          <DialogDescription>
            PDF packages are uploaded, extracted, and automatically audited by the server.
            Nothing is emailed without a reviewer action.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.target.files) addFiles(Array.from(event.target.files))
              event.target.value = ""
            }}
            aria-label="Choose claim PDF files"
          />

          <button
            type="button"
            className={cn(
              "flex min-h-36 w-full flex-col items-center justify-center rounded-lg border border-dashed p-5 text-center transition-colors",
              dragging
                ? "border-[var(--ciq-verified)] bg-[var(--ciq-verified-soft)]"
                : "border-[var(--ciq-border-strong)] bg-[var(--ciq-surface-subtle)] hover:border-[var(--ciq-aubergine)]",
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              addFiles(Array.from(event.dataTransfer.files))
            }}
          >
            <UploadCloud className="mb-2 h-7 w-7 text-[var(--ciq-aubergine)]" aria-hidden="true" />
            <strong className="text-sm text-[var(--ciq-ink)]">
              {dragging ? "Release to add files" : "Drop claim PDFs or browse"}
            </strong>
            <span className="mt-1 text-xs text-[var(--ciq-ink-muted)]">
              Multiple PDFs · 100 MB maximum per file
            </span>
          </button>

          {preflightMessage && (
            <p
              className="rounded-md border border-[#e7c781] bg-[var(--ciq-warning-soft)] px-3 py-2 text-xs text-[var(--ciq-warning)]"
              role="alert"
            >
              {preflightMessage}
            </p>
          )}

          <p className="rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] px-3 py-2 text-xs leading-5 text-[var(--ciq-ink-muted)]">
            This intake uses the {tenantName} assigned prompt and ruleset.
            Writing-company labels are applied after extraction when the source names one.
          </p>

          {hasQueue && (
            <section aria-labelledby="intake-queue-heading">
              <div className="mb-2 flex items-center justify-between">
                <h3 id="intake-queue-heading" className="ciq-section-title">
                  Batch queue
                </h3>
                <span className="text-xs text-[var(--ciq-ink-muted)]" aria-live="polite">
                  {overallMessage}
                </span>
              </div>
              <ul className="space-y-2">
                {queue.map((item) => (
                  <li
                    key={item.id}
                    className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-3"
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-md",
                        item.stage === "ready"
                          ? "bg-[var(--ciq-verified-soft)] text-[var(--ciq-verified)]"
                          : item.stage === "error" || item.stage === "cancelled"
                            ? "bg-[var(--ciq-critical-soft)] text-[var(--ciq-critical)]"
                            : "bg-[var(--ciq-info-soft)] text-[var(--ciq-info)]",
                      )}
                    >
                      {["uploading", "extracting", "auditing"].includes(item.stage) ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : item.stage === "ready" ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <FileText className="h-4 w-4" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-xs font-semibold text-[var(--ciq-ink)]">
                        {item.claimNumber || item.fileName}
                      </strong>
                      <span className="mt-0.5 block text-[0.68rem] text-[var(--ciq-ink-muted)]">
                        {item.error || (item.duplicate ? "Existing matching intake resumed" : stageCopy[item.stage])}
                        {item.size ? ` · ${(item.size / 1024 / 1024).toFixed(1)} MB` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      {item.stage === "ready" && item.claimId && (
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/claims/${item.claimId}`}>Review</Link>
                        </Button>
                      )}
                      {["extracting", "auditing"].includes(item.stage) && item.jobId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void cancelItem(item)}
                          aria-label={`Cancel processing for ${item.fileName}`}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      )}
                      {(item.stage === "error" || item.stage === "cancelled") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void retryItem(item)}
                          aria-label={`Retry ${item.fileName}`}
                        >
                          <RotateCcw aria-hidden="true" />
                        </Button>
                      )}
                      {(
                        item.stage === "queued"
                        || item.stage === "ready"
                        || item.stage === "error"
                        || item.stage === "cancelled"
                      ) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setQueue((items) => items.filter((entry) => entry.id !== item.id))}
                          aria-label={`Remove ${item.fileName} from queue`}
                        >
                          {item.stage === "queued" ? <X aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-between gap-3 border-t border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] px-5 py-4 sm:justify-between sm:space-x-0">
          <div className="hidden text-xs text-[var(--ciq-ink-muted)] sm:block">
            Progress can recover after a refresh.
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {activeCount ? "Continue in background" : "Close"}
            </Button>
            <Button
              onClick={() => void startBatch()}
              disabled={!queuedCount || processingBatch}
            >
              {processingBatch ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                  Processing
                </>
              ) : (
                <>
                  <UploadCloud aria-hidden="true" />
                  Start {queuedCount || ""} intake{queuedCount === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
