import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "wouter"
import { Archive, ArrowRight, Building2, FileCode2, Plus } from "lucide-react"
import { PageState, StatusPill, formatDate } from "@/components/complete-iq/status"
import { PageBody, PageHeader } from "@/components/layout/app-shell"
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
import { Button } from "@/components/ui/button"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import type { CarrierProfile } from "@/lib/types"

export default function CarriersPage() {
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState<CarrierProfile | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const carriers = useQuery({ queryKey: queryKeys.carriers, queryFn: api.getCarriers })

  const deleteCarrier = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteCarrier(deleteTarget.carrierKey)
      setDeleteTarget(null)
      await queryClient.invalidateQueries({ queryKey: queryKeys.carriers })
    } catch (error) {
      setDeleteError(apiErrorMessage(error, "The carrier could not be deactivated."))
    } finally {
      setDeleting(false)
    }
  }

  if (carriers.isLoading) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="loading"
          title="Loading carrier profiles"
          description="Opening the current draft and published rulesets."
        />
      </div>
    )
  }

  if (carriers.isError) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="error"
          title="Carrier administration is unavailable"
          description={apiErrorMessage(carriers.error)}
          actionLabel="Retry"
          onAction={() => void carriers.refetch()}
        />
      </div>
    )
  }

  const profiles = carriers.data || []
  const published = profiles.filter((profile) => profile.active).length
  const drafts = profiles.filter((profile) => profile.hasDraft).length

  return (
    <div className="ciq-page">
      <PageHeader
        compact
        eyebrow="Administrator workspace"
        title="Carrier profiles"
        description="Govern carrier policy through validated drafts, explicit publication approval, immutable history, impact review, and rollback."
        meta={
          <>
            <StatusPill value="published" label={`${published} published`} tone="verified" />
            <StatusPill
              value="draft"
              label={`${drafts} with draft changes`}
              tone="progress"
            />
          </>
        }
        actions={
          <Button
            asChild
            className="border-white/15 bg-white text-[var(--ciq-aubergine)] hover:bg-[#f7f3ed]"
          >
            <Link href="/carriers/new">
              <Plus aria-hidden="true" />
              New carrier
            </Link>
          </Button>
        }
      />

      <PageBody>
        <section className="ciq-panel ciq-panel--flush">
          <div className="ciq-panel__header">
            <div>
              <h2>Ruleset registry</h2>
              <p>Published profiles are available to the live audit workflow</p>
            </div>
            <span className="ciq-mono text-sm font-semibold">{profiles.length}</span>
          </div>

          {profiles.length ? (
            <div className="divide-y divide-[var(--ciq-border)]">
              {profiles.map((profile) => {
                const visibleRuleset = profile.latestVersion?.ruleset || profile.ruleset
                const daCount = visibleRuleset?.da_questions?.length || 0
                const faCount = visibleRuleset?.fa_questions?.length || 0
                const categoryCount = visibleRuleset?.scorecard_categories?.length || 0
                return (
                  <article
                    key={profile.carrierKey}
                    className="grid gap-4 p-4 transition-colors hover:bg-[var(--ciq-surface-subtle)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)]">
                        {profile.logoUrl ? (
                          <img
                            src={profile.logoUrl}
                            alt=""
                            className="h-full w-full object-contain p-1.5"
                          />
                        ) : (
                          <Building2 className="h-5 w-5 text-[var(--ciq-aubergine)]" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            className="ciq-link text-sm font-bold"
                            href={`/carriers/${profile.carrierKey}`}
                          >
                            {profile.displayName}
                          </Link>
                          <StatusPill
                            value={profile.active ? "published" : "unavailable"}
                            label={profile.active ? "Live" : "Inactive"}
                          />
                          {profile.hasDraft && <StatusPill value="draft" label="Draft pending" />}
                        </div>
                        <p className="ciq-mono mt-1 truncate text-[0.68rem] text-[var(--ciq-ink-muted)]">
                          {profile.carrierKey} · version{" "}
                          {profile.latestVersion?.versionNumber || 1} ·{" "}
                          {visibleRuleset?.version || "1.0"}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="ciq-status">{daCount} DA questions</span>
                          <span className="ciq-status">{faCount} FA questions</span>
                          <span className="ciq-status">{categoryCount} categories</span>
                          {profile.updatedAt && (
                            <span className="ciq-status">Updated {formatDate(profile.updatedAt)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 md:justify-end">
                      <Button variant="outline" asChild>
                        <Link href={`/carriers/${profile.carrierKey}`}>
                          <FileCode2 aria-hidden="true" />
                          Edit profile
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-[var(--ciq-critical)]"
                        onClick={() => setDeleteTarget(profile)}
                        aria-label={`Deactivate ${profile.displayName}`}
                      >
                        <Archive aria-hidden="true" />
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="p-4">
              <PageState
                kind="empty"
                title="No carrier profiles configured"
                description="Create a draft profile, validate its questions and categories, then publish it to the audit workflow."
              >
                <Button asChild>
                  <Link href="/carriers/new">
                    <Plus aria-hidden="true" />
                    Create first profile
                  </Link>
                </Button>
              </PageState>
            </div>
          )}
        </section>
      </PageBody>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteTarget(null)
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deleteTarget?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              New intake will no longer offer this carrier. Published versions and historical claim
              provenance remain immutable and available for review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="rounded-md bg-[var(--ciq-critical-soft)] p-3 text-sm text-[var(--ciq-critical)]" role="alert">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep active</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--ciq-critical)] text-white"
              onClick={(event) => {
                event.preventDefault()
                void deleteCarrier()
              }}
              disabled={deleting}
            >
              <Archive aria-hidden="true" />
              {deleting ? "Deactivating…" : "Deactivate carrier"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
