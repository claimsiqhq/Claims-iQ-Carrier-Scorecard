import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "wouter"
import {
  ArrowRight,
  BarChart3,
  Clock3,
  CircleDollarSign,
  Files,
  ShieldAlert,
  Trash2,
  TrendingUp,
} from "lucide-react"
import { useIntakeDialog } from "@/components/complete-iq/intake-dialog-context"
import {
  ArchiveClaimsDialog,
  type ArchiveClaimTarget,
} from "@/features/claims/archive-claims-dialog"
import {
  MetricTile,
  PageState,
  StatusPill,
  formatDate,
  formatScore,
  humanize,
} from "@/components/complete-iq/status"
import { PageBody, PageHeader } from "@/components/layout/app-shell"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { api, queryKeys } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import type { ClaimSummary } from "@/lib/types"

function nextAction(claim: ClaimSummary) {
  if (claim.status === "processing" || claim.status === "pending") return "Monitor intake"
  if (claim.status === "error") return "Retry intake"
  if (claim.approvalStatus?.toUpperCase() === "REVIEW") return "Resolve findings"
  return "Review evidence"
}

export default function DashboardPage() {
  const { user, organization } = useAuth()
  const { openIntake } = useIntakeDialog()
  const canCreate = Boolean(organization?.permissions.includes("claims:create"))
  const canDelete = Boolean(organization?.permissions.includes("claims:delete"))
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [archiveTargets, setArchiveTargets] = useState<ArchiveClaimTarget[]>([])
  const dashboard = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: api.getDashboard,
    refetchInterval: (query) => {
      const data = query.state.data
      return data?.recentClaims.some((claim) => claim.status === "processing") ? 8_000 : false
    },
  })

  const rankedFindings = useMemo(() => {
    const order = ["critical", "fail", "high", "warning", "partial", "medium", "info", "low"]
    return Object.entries(dashboard.data?.findingSeverity || {}).sort(([left], [right]) => {
      const leftIndex = order.indexOf(left.toLowerCase())
      const rightIndex = order.indexOf(right.toLowerCase())
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex)
    })
  }, [dashboard.data])

  if (dashboard.isLoading) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="loading"
          title="Opening the evidence ledger"
          description="Loading current claims, review readiness, and finding distribution."
        />
      </div>
    )
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="error"
          title="The command center is unavailable"
          description="No dashboard values have been substituted. Retry when the service is available."
          actionLabel="Retry"
          onAction={() => void dashboard.refetch()}
        />
      </div>
    )
  }

  const { stats, recentClaims, recentActivity, approvalDistribution } = dashboard.data
  const priorityClaims = recentClaims.slice(0, 7)
  const selectedPriorityClaims = priorityClaims.filter((claim) =>
    selectedIds.includes(claim.id),
  )
  const allPrioritySelected =
    priorityClaims.length > 0
    && priorityClaims.every((claim) => selectedIds.includes(claim.id))
  const reviewCount =
    approvalDistribution.REVIEW ??
    approvalDistribution.review ??
    recentClaims.filter((claim) => claim.approvalStatus?.toUpperCase() === "REVIEW").length
  const processingCount = recentClaims.filter((claim) =>
    ["processing", "pending"].includes(claim.status),
  ).length

  return (
    <div className="ciq-page">
      <PageHeader
        eyebrow="Evidence ledger · Current corpus"
        title={`Good ${getGreeting()}, ${user?.firstName || "reviewer"}.`}
        description="Move the review queue forward from source evidence to an accountable carrier decision."
        meta={
          <>
            <StatusPill
              value="review"
              label={`${reviewCount} need human review`}
              tone={reviewCount > 0 ? "warning" : "verified"}
            />
            <StatusPill
              value="processing"
              label={`${processingCount} processing`}
              tone="progress"
            />
            <StatusPill
              value="verified"
              label={`${stats.completedLast7Days} completed in 7 days`}
              tone="verified"
            />
          </>
        }
      />

      <PageBody overlap>
        <section className="ciq-metric-grid" aria-label="Current claim metrics">
          <MetricTile
            label="Review backlog"
            value={stats.backlogCount.toLocaleString()}
            detail={`${stats.totalClaims.toLocaleString()} total claims in this organization`}
            tone={stats.backlogCount > 0 ? "warning" : "verified"}
            icon={<Clock3 />}
          />
          <MetricTile
            label="Dollars at risk"
            value={formatCurrency(stats.dollarsAtRisk)}
            detail="Exposure on high-risk or not-ready audits"
            tone="financial"
            icon={<CircleDollarSign />}
          />
          <MetricTile
            label="Average aging"
            value={`${stats.averageAgeDays}d`}
            detail="Claims not fully approved and ready"
            tone={stats.averageAgeDays > 7 ? "warning" : "neutral"}
            icon={<Clock3 />}
          />
          <MetricTile
            label="7-day throughput"
            value={stats.completedLast7Days.toLocaleString()}
            detail={`${stats.openFindingCount.toLocaleString()} open findings remain`}
            tone="verified"
            icon={<TrendingUp />}
          />
        </section>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <section className="ciq-panel ciq-panel--flush min-w-0">
            <div className="ciq-panel__header">
              <div>
                <h2>Priority review queue</h2>
                <p>Most recently received claims · current server order</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1">
                {canDelete && selectedPriorityClaims.length > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setArchiveTargets(selectedPriorityClaims)}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete {selectedPriorityClaims.length} selected
                  </Button>
                )}
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/claims">
                    Open queue
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
            {recentClaims.length ? (
              <>
                <div className="ciq-desktop-table overflow-x-auto">
                  <table className="ciq-table min-w-[820px]">
                    <caption>Recent claims requiring review</caption>
                    <thead>
                      <tr>
                        {canDelete && (
                          <th scope="col" className="w-12">
                            <Checkbox
                              checked={allPrioritySelected}
                              onCheckedChange={(checked) =>
                                setSelectedIds(checked ? priorityClaims.map((claim) => claim.id) : [])
                              }
                              aria-label="Select all priority claims"
                            />
                          </th>
                        )}
                        <th scope="col">Claim</th>
                        <th scope="col">Insured</th>
                        <th scope="col">Carrier</th>
                        <th scope="col">Workflow</th>
                        <th scope="col">AI readiness</th>
                        <th scope="col">Score</th>
                        <th scope="col">Next action</th>
                        {canDelete && <th scope="col">Delete</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {priorityClaims.map((claim) => (
                        <tr key={claim.id}>
                          {canDelete && (
                            <td>
                              <Checkbox
                                checked={selectedIds.includes(claim.id)}
                                onCheckedChange={(checked) =>
                                  setSelectedIds((current) =>
                                    checked
                                      ? Array.from(new Set([...current, claim.id]))
                                      : current.filter((claimId) => claimId !== claim.id),
                                  )
                                }
                                aria-label={`Select claim ${claim.claimNumber}`}
                              />
                            </td>
                          )}
                          <td>
                            <Link className="ciq-link ciq-mono" href={`/claims/${claim.id}`}>
                              {claim.claimNumber}
                            </Link>
                            <span className="mt-0.5 block text-[0.65rem] text-[var(--ciq-ink-muted)]">
                              {formatDate(claim.createdAt)}
                            </span>
                          </td>
                          <td className="font-medium">{claim.insuredName}</td>
                          <td>{claim.carrier || <span className="ciq-empty-dash">—</span>}</td>
                          <td>
                            <StatusPill value={claim.status} />
                          </td>
                          <td>
                            {claim.approvalStatus ? (
                              <StatusPill value={claim.approvalStatus} />
                            ) : (
                              <span className="text-xs text-[var(--ciq-ink-faint)]">Not available</span>
                            )}
                          </td>
                          <td className="ciq-mono font-semibold">
                            {formatScore(claim.overallScore)}
                          </td>
                          <td>
                            <Link className="ciq-link text-xs" href={`/claims/${claim.id}`}>
                              {nextAction(claim)}
                            </Link>
                          </td>
                          {canDelete && (
                            <td>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-[var(--ciq-critical)] hover:bg-[var(--ciq-critical-soft)] hover:text-[var(--ciq-critical)]"
                                onClick={() => setArchiveTargets([claim])}
                                aria-label={`Delete claim ${claim.claimNumber}`}
                              >
                                <Trash2 aria-hidden="true" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ciq-mobile-card-list">
                  {priorityClaims.map((claim) => (
                    <article
                      key={claim.id}
                      className="rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        {canDelete && (
                          <Checkbox
                            checked={selectedIds.includes(claim.id)}
                            onCheckedChange={(checked) =>
                              setSelectedIds((current) =>
                                checked
                                  ? Array.from(new Set([...current, claim.id]))
                                  : current.filter((claimId) => claimId !== claim.id),
                              )
                            }
                            aria-label={`Select claim ${claim.claimNumber}`}
                          />
                        )}
                        <div className="min-w-0">
                          <Link className="ciq-link ciq-mono text-sm" href={`/claims/${claim.id}`}>
                            {claim.claimNumber}
                          </Link>
                          <p className="mt-1 truncate text-sm font-medium">{claim.insuredName}</p>
                        </div>
                        <span className="ciq-mono text-sm font-semibold">
                          {formatScore(claim.overallScore)}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <StatusPill value={claim.status} />
                        {claim.approvalStatus && <StatusPill value={claim.approvalStatus} />}
                      </div>
                      <p className="mt-3 text-xs text-[var(--ciq-ink-muted)]">
                        {claim.carrier || "Carrier unavailable"} · {nextAction(claim)}
                      </p>
                      {canDelete && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 w-full border-[var(--ciq-critical)]/30 text-[var(--ciq-critical)] hover:bg-[var(--ciq-critical-soft)] hover:text-[var(--ciq-critical)]"
                          onClick={() => setArchiveTargets([claim])}
                        >
                          <Trash2 aria-hidden="true" />
                          Delete claim
                        </Button>
                      )}
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="p-5">
                <PageState
                  kind="empty"
                  title="No claims in the ledger"
                  description="Begin with a source PDF. The server will extract and automatically audit it."
                  actionLabel={canCreate ? "Start intake" : undefined}
                  onAction={canCreate ? openIntake : undefined}
                />
              </div>
            )}
          </section>

          <aside className="ciq-panel ciq-panel--flush">
            <div className="ciq-panel__header">
              <div>
                <h2>Ranked intelligence</h2>
                <p>Finding severity beside current financial exposure</p>
              </div>
              <ShieldAlert className="h-4 w-4 text-[var(--ciq-financial)]" aria-hidden="true" />
            </div>
            <div className="ciq-panel__body">
              {rankedFindings.length ? (
                <ol className="space-y-4">
                  {rankedFindings.slice(0, 6).map(([severity, count], index) => {
                    const max = Math.max(...rankedFindings.map(([, value]) => value), 1)
                    const critical = ["critical", "fail", "high"].includes(severity.toLowerCase())
                    return (
                      <li key={severity}>
                        <div className="mb-1.5 flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-[var(--ciq-ink)]">
                            <span className="ciq-mono mr-2 text-[var(--ciq-ink-faint)]">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            {humanize(severity)}
                          </span>
                          <strong className="ciq-mono text-xs">{count.toLocaleString()}</strong>
                        </div>
                        <div
                          className={`ciq-bar ${critical ? "ciq-bar--critical" : index === 1 ? "ciq-bar--financial" : ""}`}
                          role="progressbar"
                          aria-label={`${humanize(severity)} findings`}
                          aria-valuemin={0}
                          aria-valuemax={max}
                          aria-valuenow={count}
                        >
                          <span style={{ width: `${Math.max(4, (count / max) * 100)}%` }} />
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="text-sm leading-6 text-[var(--ciq-ink-muted)]">
                  Finding severity is unavailable until completed audits populate the current corpus.
                </p>
              )}
              <div className="mt-5 border-t border-[var(--ciq-border)] pt-4">
                <span className="ciq-section-title">Current dollars at risk</span>
                <strong className="ciq-mono mt-2 block text-xl text-[var(--ciq-financial-strong)]">
                  {formatCurrency(stats.dollarsAtRisk)}
                </strong>
                <p className="mt-1 text-xs leading-5 text-[var(--ciq-ink-muted)]">
                  Sum of supplied claim exposure on high-risk or not-ready current audits.
                </p>
              </div>
            </div>
          </aside>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="ciq-panel">
            <div className="ciq-panel__header">
              <div>
                <h2>Recent ledger activity</h2>
                <p>Derived from claim receipt and workflow state</p>
              </div>
            </div>
            <div className="divide-y divide-[var(--ciq-border)]">
              {recentActivity.length ? (
                recentActivity.slice(0, 6).map((activity) => (
                  <div key={activity.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ciq-info-soft)] text-[var(--ciq-info)]">
                      <Files className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[var(--ciq-ink)]">
                        <Link className="ciq-link ciq-mono" href={`/claims/${activity.claimId}`}>
                          {activity.claimNumber}
                        </Link>{" "}
                        · {humanize(activity.type)}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--ciq-ink-muted)]">
                        {formatDate(activity.createdAt, true)}
                      </p>
                    </div>
                    <StatusPill value={activity.type} />
                  </div>
                ))
              ) : (
                <p className="p-4 text-sm text-[var(--ciq-ink-muted)]">
                  No immutable workflow activity has been recorded yet.
                </p>
              )}
            </div>
          </section>

          <section className="ciq-panel">
            <div className="ciq-panel__header">
              <div>
                <h2>Quick actions</h2>
                <p>Move directly into operational work</p>
              </div>
            </div>
            <div className="grid gap-2 p-3">
              <Button variant="outline" className="justify-start" asChild>
                <Link href="/claims">
                  <Files aria-hidden="true" />
                  Triage review queue
                </Link>
              </Button>
              <Button variant="outline" className="justify-start" asChild>
                <Link href="/insights">
                  <BarChart3 aria-hidden="true" />
                  Inspect corpus quality
                </Link>
              </Button>
            </div>
          </section>
        </div>
      </PageBody>
      <ArchiveClaimsDialog
        open={archiveTargets.length > 0}
        claims={archiveTargets}
        onOpenChange={(open) => {
          if (!open) setArchiveTargets([])
        }}
        onArchived={() => {
          const archivedIds = new Set(archiveTargets.map((claim) => claim.id))
          setSelectedIds((current) => current.filter((claimId) => !archivedIds.has(claimId)))
        }}
      />
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return "morning"
  if (hour < 18) return "afternoon"
  return "evening"
}

function formatCurrency(value: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount)
}
