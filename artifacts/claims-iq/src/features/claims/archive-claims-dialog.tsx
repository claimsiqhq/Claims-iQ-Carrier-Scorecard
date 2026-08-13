import { useEffect, useState } from "react"
import { Archive, ShieldCheck, Trash } from "iconoir-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import { useQueryClient } from "@tanstack/react-query"
import type { ClaimSummary } from "@/lib/types"

export type ArchiveClaimTarget = Pick<ClaimSummary, "id" | "claimNumber" | "insuredName">

interface ArchiveClaimsDialogProps {
  open: boolean
  claims: ArchiveClaimTarget[]
  onOpenChange: (open: boolean) => void
  onArchived?: (result: {
    archivedCount: number
    alreadyArchivedCount: number
    message: string
  }) => void
}

export function ArchiveClaimsDialog({
  open,
  claims,
  onOpenChange,
  onArchived,
}: ArchiveClaimsDialogProps) {
  const queryClient = useQueryClient()
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const claimCount = claims.length
  const plural = claimCount !== 1

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  const changeOpen = (nextOpen: boolean) => {
    if (archiving) return
    if (nextOpen) setError(null)
    onOpenChange(nextOpen)
  }

  const archiveSelectedClaims = async () => {
    if (!claimCount) return
    setArchiving(true)
    setError(null)
    try {
      const result = await api.archiveClaims(claims.map((claim) => claim.id))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.claims }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.insights }),
      ])
      onArchived?.(result)
      onOpenChange(false)
    } catch (archiveError) {
      setError(
        apiErrorMessage(
          archiveError,
          `The selected claim${plural ? "s" : ""} could not be deleted from active work.`,
        ),
      )
    } finally {
      setArchiving(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ciq-critical-soft)] text-[var(--ciq-critical)]">
            <Trash className="h-5 w-5" aria-hidden="true" />
          </div>
          <AlertDialogTitle>
            Delete {claimCount === 1 ? claims[0]?.claimNumber || "this claim" : `${claimCount} claims`}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {plural ? "These claims" : "This claim"} will be removed from active dashboards and
            queue views. Complete iQ retains the source record and immutable audit provenance under
            Archived for compliance and traceability.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ciq-ink)]">
            <Archive className="h-4 w-4 text-[var(--ciq-financial)]" aria-hidden="true" />
            Governed deletion
          </div>
          <ul className="mt-2 space-y-1 text-xs text-[var(--ciq-ink-muted)]">
            {claims.slice(0, 5).map((claim) => (
              <li key={claim.id} className="flex items-center justify-between gap-3">
                <span className="ciq-mono font-semibold text-[var(--ciq-ink)]">
                  {claim.claimNumber}
                </span>
                <span className="truncate">{claim.insuredName}</span>
              </li>
            ))}
            {claimCount > 5 && <li>+ {claimCount - 5} more selected claims</li>}
          </ul>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-[var(--ciq-info)]/25 bg-[var(--ciq-info-soft)] p-3 text-xs leading-5 text-[var(--ciq-ink-muted)]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ciq-info)]" aria-hidden="true" />
          Claims with queued or running processing are protected. Cancel or finish that work before
          deleting the claim.
        </div>

        {error && (
          <p
            className="rounded-md border border-[var(--ciq-critical)]/25 bg-[var(--ciq-critical-soft)] p-3 text-sm text-[var(--ciq-critical)]"
            role="alert"
          >
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={archiving}>Keep active</AlertDialogCancel>
          <AlertDialogAction
            className="bg-[var(--ciq-critical)] text-white hover:bg-[var(--ciq-critical)]/90"
            onClick={(event) => {
              event.preventDefault()
              void archiveSelectedClaims()
            }}
            disabled={archiving || claimCount === 0}
          >
            <Trash aria-hidden="true" />
            {archiving
              ? "Deleting…"
              : `Delete ${claimCount === 1 ? "claim" : `${claimCount} claims`}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
