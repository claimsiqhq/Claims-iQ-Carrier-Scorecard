import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useLocation } from "wouter"
import {
  ArrowDownUp,
  ArrowRight,
  Eye,
  Files,
  Filter,
  LayoutList,
  RotateCcw,
  Search,
  UploadCloud,
} from "lucide-react"
import { UploadClaimsDialog } from "@/components/complete-iq/upload-claims-dialog"
import {
  PageState,
  StatusPill,
  formatDate,
  formatScore,
  humanize,
} from "@/components/complete-iq/status"
import { PageBody, PageHeader } from "@/components/layout/app-shell"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import type { ClaimSummary } from "@/lib/types"

type SortKey = "received" | "claim" | "carrier" | "score"
type Density = "comfortable" | "compact"
type Preset = "all" | "review" | "processing" | "risk" | "exceptions" | "custom"

const PER_PAGE = 20

function nextAction(claim: ClaimSummary) {
  if (claim.systemStatus === "error" || claim.aiStatus === "failed" || claim.status === "error") {
    return "Retry processing"
  }
  if (
    claim.systemStatus === "processing" ||
    ["queued", "running"].includes(claim.aiStatus || "") ||
    claim.status === "processing" ||
    claim.status === "pending"
  ) {
    return "Monitor intake"
  }
  if (claim.humanReviewStatus === "changes_requested") return "Resolve requested changes"
  if (claim.humanReviewStatus === "pending" || claim.humanReviewStatus === "in_review") {
    return "Continue human review"
  }
  if (claim.approvalStatus?.toUpperCase() === "REVIEW") return "Resolve required actions"
  if ((claim.riskLevel || "").toUpperCase() === "HIGH") return "Review high-risk evidence"
  return "Open evidence workbench"
}

export default function ClaimsPage() {
  const queryClient = useQueryClient()
  const [, setLocation] = useLocation()
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: api.getDashboard })
  const claimsQuery = useQuery({ queryKey: queryKeys.claims, queryFn: () => api.getClaims(100, 0) })
  const [search, setSearch] = useState("")
  const [carrier, setCarrier] = useState("all")
  const [status, setStatus] = useState("all")
  const [risk, setRisk] = useState("all")
  const [readiness, setReadiness] = useState("all")
  const [sort, setSort] = useState<SortKey>("received")
  const [density, setDensity] = useState<Density>("comfortable")
  const [preset, setPreset] = useState<Preset>("all")
  const [page, setPage] = useState(1)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})

  const allClaims = useMemo(() => {
    const rich = new Map((dashboard.data?.recentClaims || []).map((claim) => [claim.id, claim]))
    const merged = (claimsQuery.data || []).map((claim) => ({ ...claim, ...rich.get(claim.id) }))
    rich.forEach((claim, id) => {
      if (!merged.some((item) => item.id === id)) merged.push(claim)
    })
    return merged
  }, [claimsQuery.data, dashboard.data])

  const carriers = useMemo(
    () =>
      Array.from(new Set(allClaims.map((claim) => claim.carrier).filter(Boolean) as string[])).sort(),
    [allClaims],
  )

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    const list = allClaims.filter((claim) => {
      if (
        normalizedSearch &&
        ![claim.claimNumber, claim.insuredName, claim.carrier || "", claim.policyNumber || ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch)
      ) {
        return false
      }
      if (carrier !== "all" && claim.carrier !== carrier) return false
      if (status !== "all" && (claim.systemStatus || claim.status) !== status) return false
      if (risk !== "all" && (claim.riskLevel || "").toUpperCase() !== risk) return false
      if (
        readiness !== "all" &&
        (claim.approvalStatus || "").toUpperCase() !== readiness
      ) {
        return false
      }
      if (preset === "review") {
        return (
          ["pending", "in_review", "changes_requested"].includes(claim.humanReviewStatus || "") ||
          (claim.approvalStatus || "").toUpperCase() === "REVIEW"
        )
      }
      if (preset === "processing") {
        return (
          claim.systemStatus === "processing" ||
          ["queued", "running"].includes(claim.aiStatus || "") ||
          ["processing", "pending"].includes(claim.status)
        )
      }
      if (preset === "risk") return (claim.riskLevel || "").toUpperCase() === "HIGH"
      if (preset === "exceptions") {
        return (
          claim.systemStatus === "error" ||
          claim.aiStatus === "failed" ||
          claim.status === "error" ||
          (claim.approvalStatus || "").toUpperCase() === "REVIEW" ||
          (claim.riskLevel || "").toUpperCase() === "HIGH"
        )
      }
      return true
    })

    return list.sort((left, right) => {
      if (sort === "claim") return left.claimNumber.localeCompare(right.claimNumber)
      if (sort === "carrier") return (left.carrier || "").localeCompare(right.carrier || "")
      if (sort === "score") return (right.overallScore ?? -1) - (left.overallScore ?? -1)
      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
    })
  }, [allClaims, carrier, preset, readiness, risk, search, sort, status])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const visibleClaims = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE)

  const applyPreset = (next: Preset) => {
    setPreset(next)
    setCarrier("all")
    setStatus("all")
    setRisk("all")
    setReadiness("all")
    setPage(1)
  }

  const setCustom = (setter: (value: string) => void, value: string) => {
    setter(value)
    setPreset("custom")
    setPage(1)
  }

  const retryClaim = async (claimId: string) => {
    setRetrying((current) => ({ ...current, [claimId]: true }))
    try {
      await api.retryClaim(claimId)
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const result = await api.getProcessingStatus(claimId)
        if (
          result.systemStatus !== "processing" &&
          !["queued", "running"].includes(result.job?.status || "")
        ) {
          break
        }
        await new Promise((resolve) => window.setTimeout(resolve, 3_000))
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.claims }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.claim(claimId) }),
      ])
    } finally {
      setRetrying((current) => ({ ...current, [claimId]: false }))
    }
  }

  const isLoading = dashboard.isLoading && claimsQuery.isLoading
  const isError = dashboard.isError && claimsQuery.isError

  if (isLoading) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="loading"
          title="Opening the operational queue"
          description="Reconciling claim records with current audit readiness."
        />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="error"
          title="The claim queue is unavailable"
          description={apiErrorMessage(dashboard.error || claimsQuery.error)}
          actionLabel="Retry"
          onAction={() => {
            void dashboard.refetch()
            void claimsQuery.refetch()
          }}
        />
      </div>
    )
  }

  const uploadRequested = new URLSearchParams(window.location.search).get("upload") === "1"

  return (
    <div className="ciq-page">
      <PageHeader
        compact
        eyebrow="Operational queue"
        title="Claims"
        description="Triage every intake by workflow state, carrier risk, and evidence readiness."
        meta={
          <>
            <StatusPill value="neutral" label={`${allClaims.length} current records`} />
            <StatusPill
              value="review"
              label={`${allClaims.filter((claim) => ["pending", "in_review", "changes_requested"].includes(claim.humanReviewStatus || "") || claim.approvalStatus?.toUpperCase() === "REVIEW").length} need review`}
              tone="warning"
            />
          </>
        }
        actions={
          <UploadClaimsDialog
            initialOpen={uploadRequested}
            onOpenChange={(open) => {
              if (!open && uploadRequested) setLocation("/claims", { replace: true })
            }}
            trigger={
              <Button className="border-white/15 bg-white text-[var(--ciq-aubergine)] hover:bg-[#f7f3ed]">
                <UploadCloud aria-hidden="true" />
                New intake
              </Button>
            }
          />
        }
      />

      <PageBody>
        <section className="ciq-panel ciq-panel--flush">
          <div className="border-b border-[var(--ciq-border)] px-4 py-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="Queue presets">
              {(
                [
                  ["all", "All claims"],
                  ["review", "Needs review"],
                  ["processing", "Processing"],
                  ["risk", "High risk"],
                  ["exceptions", "Exceptions"],
                ] as Array<[Preset, string]>
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={`min-h-11 shrink-0 rounded-full border px-4 text-xs font-semibold transition-colors ${
                    preset === value
                      ? "border-[var(--ciq-aubergine)] bg-[var(--ciq-aubergine)] text-white"
                      : "border-[var(--ciq-border)] bg-[var(--ciq-surface)] text-[var(--ciq-ink-muted)] hover:border-[var(--ciq-border-strong)]"
                  }`}
                  onClick={() => applyPreset(value)}
                  aria-pressed={preset === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="ciq-toolbar">
            <div className="ciq-field ciq-field--grow">
              <label htmlFor="claim-search">Search queue</label>
              <div className="ciq-search">
                <Search aria-hidden="true" />
                <input
                  id="claim-search"
                  type="search"
                  className="ciq-control"
                  placeholder="Claim, insured, carrier, policy…"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                />
              </div>
            </div>
            <QueueSelect
              id="carrier-filter"
              label="Carrier"
              value={carrier}
              onChange={(value) => setCustom(setCarrier, value)}
              options={[["all", "All carriers"], ...carriers.map((value) => [value, value] as [string, string])]}
            />
            <QueueSelect
              id="status-filter"
              label="Workflow"
              value={status}
              onChange={(value) => setCustom(setStatus, value)}
              options={[
                ["all", "All statuses"],
                ["uploaded", "Uploaded"],
                ["processing", "Processing"],
                ["ready", "Ready"],
                ["error", "Error"],
                ["archived", "Archived"],
              ]}
            />
            <QueueSelect
              id="risk-filter"
              label="Risk"
              value={risk}
              onChange={(value) => setCustom(setRisk, value)}
              options={[
                ["all", "All risk"],
                ["HIGH", "High"],
                ["MEDIUM", "Medium"],
                ["LOW", "Low"],
              ]}
            />
            <QueueSelect
              id="readiness-filter"
              label="Readiness"
              value={readiness}
              onChange={(value) => setCustom(setReadiness, value)}
              options={[
                ["all", "All readiness"],
                ["READY", "Ready"],
                ["REVIEW", "Review"],
                ["NOT_READY", "Not ready"],
              ]}
            />
            <QueueSelect
              id="sort-queue"
              label="Sort"
              value={sort}
              onChange={(value) => setSort(value as SortKey)}
              icon={<ArrowDownUp />}
              options={[
                ["received", "Newest received"],
                ["claim", "Claim number"],
                ["carrier", "Carrier"],
                ["score", "Highest score"],
              ]}
            />
            <QueueSelect
              id="density-queue"
              label="Density"
              value={density}
              onChange={(value) => setDensity(value as Density)}
              icon={<LayoutList />}
              options={[
                ["comfortable", "Comfortable"],
                ["compact", "Compact"],
              ]}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-b border-[var(--ciq-border)] px-4 py-2 text-xs text-[var(--ciq-ink-muted)]">
            <span>
              {filtered.length.toLocaleString()} match{filtered.length === 1 ? "" : "es"}
              {preset === "custom" ? " · Custom view" : ` · ${humanize(preset)} view`}
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              Filters use current API values only
            </span>
          </div>

          {visibleClaims.length ? (
            <>
              <div className="ciq-desktop-table overflow-x-auto">
                <table
                  className={`ciq-table min-w-[1120px] ${density === "compact" ? "ciq-table--compact" : ""}`}
                >
                  <caption>Complete iQ operational claim queue</caption>
                  <thead>
                    <tr>
                      <th scope="col">Claim / received</th>
                      <th scope="col">Insured</th>
                      <th scope="col">Carrier</th>
                      <th scope="col">System workflow</th>
                      <th scope="col">AI processing</th>
                      <th scope="col">Human review</th>
                      <th scope="col">Risk</th>
                      <th scope="col">Score</th>
                      <th scope="col">Next action</th>
                      <th scope="col">Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleClaims.map((claim) => (
                      <tr key={claim.id}>
                        <td>
                          <Link className="ciq-link ciq-mono" href={`/claims/${claim.id}`}>
                            {claim.claimNumber}
                          </Link>
                          <span className="mt-0.5 block text-[0.65rem] text-[var(--ciq-ink-muted)]">
                            {formatDate(claim.createdAt)}
                          </span>
                        </td>
                        <td>
                          <strong className="font-medium">{claim.insuredName}</strong>
                          {claim.dateOfLoss && (
                            <span className="mt-0.5 block text-[0.65rem] text-[var(--ciq-ink-muted)]">
                              Loss {formatDate(claim.dateOfLoss)}
                            </span>
                          )}
                        </td>
                        <td>{claim.carrier || <span className="ciq-empty-dash">—</span>}</td>
                        <td>
                          <StatusPill value={claim.systemStatus || claim.status} />
                        </td>
                        <td>
                          {claim.aiStatus ? (
                            <StatusPill value={claim.aiStatus} />
                          ) : (
                            <span className="text-xs text-[var(--ciq-ink-faint)]">Unavailable</span>
                          )}
                        </td>
                        <td>
                          {claim.humanReviewStatus ? (
                            <StatusPill value={claim.humanReviewStatus} />
                          ) : (
                            <span className="text-xs text-[var(--ciq-ink-faint)]">Unavailable</span>
                          )}
                        </td>
                        <td>
                          {claim.riskLevel ? (
                            <StatusPill value={claim.riskLevel} />
                          ) : (
                            <span className="ciq-empty-dash">—</span>
                          )}
                        </td>
                        <td className="ciq-mono font-semibold">{formatScore(claim.overallScore)}</td>
                        <td>
                          {claim.systemStatus === "error" || claim.aiStatus === "failed" || claim.status === "error" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void retryClaim(claim.id)}
                              disabled={retrying[claim.id]}
                            >
                              <RotateCcw className={retrying[claim.id] ? "animate-spin" : ""} aria-hidden="true" />
                              {retrying[claim.id] ? "Retrying" : "Retry"}
                            </Button>
                          ) : (
                            <Link className="ciq-link text-xs" href={`/claims/${claim.id}`}>
                              {nextAction(claim)}
                            </Link>
                          )}
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setPreviewId(claim.id)}
                            aria-label={`Preview ${claim.claimNumber}`}
                          >
                            <Eye aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="ciq-mobile-card-list">
                {visibleClaims.map((claim) => (
                  <article
                    key={claim.id}
                    className="rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link className="ciq-link ciq-mono text-sm" href={`/claims/${claim.id}`}>
                          {claim.claimNumber}
                        </Link>
                        <p className="mt-1 truncate text-sm font-semibold">{claim.insuredName}</p>
                        <p className="mt-0.5 text-xs text-[var(--ciq-ink-muted)]">
                          {claim.carrier || "Carrier unavailable"}
                        </p>
                      </div>
                      <span className="ciq-mono text-sm font-semibold">
                        {formatScore(claim.overallScore)}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <StatusPill value={claim.systemStatus || claim.status} />
                      {claim.aiStatus && <StatusPill value={claim.aiStatus} />}
                      {claim.humanReviewStatus && <StatusPill value={claim.humanReviewStatus} />}
                      {claim.riskLevel && <StatusPill value={claim.riskLevel} />}
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => setPreviewId(claim.id)}>
                        <Eye aria-hidden="true" />
                        Preview
                      </Button>
                      <Button className="flex-1" asChild>
                        <Link href={`/claims/${claim.id}`}>
                          Review
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="p-4">
              <PageState
                kind={allClaims.length ? "empty" : "unavailable"}
                title={allClaims.length ? "No claims match this view" : "No claim records returned"}
                description={
                  allClaims.length
                    ? "Adjust the current filters or return to the full queue."
                    : "Start an intake to add the first source package."
                }
                actionLabel={allClaims.length ? "Clear filters" : undefined}
                onAction={allClaims.length ? () => applyPreset("all") : undefined}
              />
            </div>
          )}

          {filtered.length > 0 && (
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] px-4 py-3 text-xs text-[var(--ciq-ink-muted)]">
              <span>
                {(currentPage - 1) * PER_PAGE + 1}–
                {Math.min(currentPage * PER_PAGE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <span className="ciq-mono px-1">
                  {currentPage}/{totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </footer>
          )}
        </section>
      </PageBody>

      <ClaimPreview claimId={previewId} onOpenChange={(open) => !open && setPreviewId(null)} />
    </div>
  )
}

function QueueSelect({
  id,
  label,
  value,
  onChange,
  options,
  icon,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
  icon?: React.ReactNode
}) {
  return (
    <div className="ciq-field">
      <label htmlFor={id} className="flex items-center gap-1.5">
        {icon && <span className="[&_svg]:h-3 [&_svg]:w-3">{icon}</span>}
        {label}
      </label>
      <select
        id={id}
        className="ciq-control"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  )
}

function ClaimPreview({
  claimId,
  onOpenChange,
}: {
  claimId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const detail = useQuery({
    queryKey: queryKeys.claim(claimId || "preview"),
    queryFn: () => api.getClaim(claimId!),
    enabled: Boolean(claimId),
  })

  return (
    <Sheet open={Boolean(claimId)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-8 text-left">
          <span className="ciq-eyebrow !mb-1 !text-[var(--ciq-financial)]">Claim preview</span>
          <SheetTitle className="font-[var(--ciq-font-serif)] text-2xl">
            {detail.data?.claim.claimNumber || "Loading record…"}
          </SheetTitle>
          <SheetDescription>
            A concise view of the source record and current audit readiness.
          </SheetDescription>
        </SheetHeader>
        {detail.isLoading && (
          <div className="mt-6">
            <PageState kind="loading" title="Loading preview" />
          </div>
        )}
        {detail.isError && (
          <div className="mt-6">
            <PageState
              kind="error"
              title="Preview unavailable"
              description={apiErrorMessage(detail.error)}
              actionLabel="Retry"
              onAction={() => void detail.refetch()}
            />
          </div>
        )}
        {detail.data && (
          <div className="mt-6 space-y-5">
            <div className="flex flex-wrap gap-2">
              <StatusPill value={detail.data.claim.status} />
              {detail.data.claim.aiStatus && <StatusPill value={detail.data.claim.aiStatus} />}
              {detail.data.claim.humanReviewStatus && (
                <StatusPill value={detail.data.claim.humanReviewStatus} />
              )}
              {detail.data.audit?.technicalRisk && (
                <StatusPill value={detail.data.audit.technicalRisk} />
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-4">
              <PreviewField label="Insured" value={detail.data.claim.insuredName} />
              <PreviewField label="Carrier" value={detail.data.claim.carrier || "Unavailable"} />
              <PreviewField label="Date of loss" value={formatDate(detail.data.claim.dateOfLoss)} />
              <PreviewField
                label="Audit score"
                value={formatScore(detail.data.audit?.overallScore)}
                mono
              />
              <PreviewField
                label="Documents"
                value={String(detail.data.documents.length)}
                mono
              />
              <PreviewField
                label="Required actions"
                value={
                  detail.data.audit?.actionRequiredCount === undefined
                    ? "Unavailable"
                    : String(detail.data.audit.actionRequiredCount)
                }
                mono
              />
            </dl>
            {detail.data.audit?.executiveSummary && (
              <div>
                <h3 className="ciq-section-title">Audit summary</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">
                  {detail.data.audit.executiveSummary}
                </p>
              </div>
            )}
            <div className="border-t border-[var(--ciq-border)] pt-4">
              <Button className="w-full" asChild>
                <Link href={`/claims/${detail.data.claim.id}`}>
                  Open evidence workbench
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function PreviewField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--ciq-ink-muted)]">
        {label}
      </dt>
      <dd className={`mt-1 text-sm font-semibold ${mono ? "ciq-mono" : ""}`}>{value}</dd>
    </div>
  )
}
