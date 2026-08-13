import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "wouter"
import { CheckCircle, DashboardSpeed, MultiplePages, ShieldAlert, StatsReport } from "iconoir-react"
import {
  MetricTile,
  PageState,
  StatusPill,
  formatScore,
  humanize,
} from "@/components/complete-iq/status"
import { PageBody, PageHeader } from "@/components/layout/app-shell"
import { api, queryKeys } from "@/lib/api"

type DistributionRow = { label: string; value: number; tone?: "verified" | "financial" | "critical" }

export default function InsightsPage() {
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: api.getDashboard })
  const insights = useQuery({ queryKey: queryKeys.insights, queryFn: api.getInsights })

  const scoreDistribution = useMemo(() => {
    const tones: Record<string, DistributionRow["tone"]> = {
      "90–100": "verified",
      "75–89": "verified",
      "60–74": "financial",
      "Below 60": "critical",
    }
    return (insights.data?.scoreDistribution || []).map((row) => ({
      label: row.bucket,
      value: row.count,
      tone: tones[row.bucket],
    }))
  }, [insights.data])

  if (dashboard.isLoading || insights.isLoading) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="loading"
          title="Calculating corpus insights"
          description="Aggregating current audits, reviewer outcomes, evidence mapping, and processing quality."
        />
      </div>
    )
  }

  if (dashboard.isError || insights.isError || !dashboard.data || !insights.data) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="error"
          title="Insights are unavailable"
          description="The analytics endpoints did not return a current organization corpus."
          actionLabel="Retry"
          onAction={() => {
            void dashboard.refetch()
            void insights.refetch()
          }}
        />
      </div>
    )
  }

  const data = dashboard.data
  const analytics = insights.data
  const knownScores = data.stats.analyzedCount
  const readinessRows = Object.entries(data.approvalDistribution).map(([label, value]) => ({
    label: humanize(label),
    value,
    tone:
      label.toUpperCase() === "READY"
        ? ("verified" as const)
        : label.toUpperCase() === "REVIEW"
          ? ("financial" as const)
          : ("critical" as const),
  }))
  const riskRows = Object.entries(data.riskDistribution).map(([label, value]) => ({
    label: humanize(label),
    value,
    tone:
      label.toUpperCase() === "HIGH"
        ? ("critical" as const)
        : label.toUpperCase() === "LOW"
          ? ("verified" as const)
          : ("financial" as const),
  }))
  const severityRows = Object.entries(data.findingSeverity)
    .sort(([, left], [, right]) => right - left)
    .map(([label, value]) => ({
      label: humanize(label),
      value,
      tone: ["critical", "high", "fail"].includes(label.toLowerCase())
        ? ("critical" as const)
        : ["warning", "partial", "medium"].includes(label.toLowerCase())
          ? ("financial" as const)
          : ("verified" as const),
    }))
  const workflowRows = analytics.workflowDistribution.map((row) => ({
    label: `${humanize(row.status)} · ${row.averageAgeDays}d avg`,
    value: row.count,
    tone:
      row.status === "approved"
        ? ("verified" as const)
        : row.status === "changes_requested"
          ? ("critical" as const)
          : ("financial" as const),
  }))

  return (
    <div className="ciq-page">
      <PageHeader
        compact
        eyebrow="Current corpus"
        title="Quality and workload insights"
        description="Carrier quality, reviewer outcomes, workflow aging, evidence mapping, and processing reliability for the current organization."
        meta={
          <>
            <StatusPill value="neutral" label={`${data.stats.totalClaims} claims in scope`} />
            <StatusPill
              value="neutral"
              label={`${knownScores} scored claim${knownScores === 1 ? "" : "s"}`}
            />
            <StatusPill value="verified" label={`${analytics.summary.runCount} immutable audit runs`} />
          </>
        }
      />
      <PageBody>
        <section className="ciq-metric-grid" aria-label="Corpus quality metrics">
          <MetricTile
            label="Processing success"
            value={formatPercent(analytics.summary.processingSuccessRate)}
            detail={`${analytics.summary.failedCount} failed · ${analytics.summary.degradedCount} degraded`}
            tone="verified"
            icon={<CheckCircle />}
          />
          <MetricTile
            label="Mapped citations"
            value={formatPercent(analytics.summary.citationMappingRate)}
            detail="Evidence anchors verified to source pages"
            tone="verified"
            icon={<MultiplePages />}
          />
          <MetricTile
            label="Reviewer agreement"
            value={formatPercent(analytics.summary.reviewAgreementRate)}
            detail="Accepted or remediated reviewed findings"
            tone="financial"
            icon={<DashboardSpeed />}
          />
          <MetricTile
            label="Override rate"
            value={formatPercent(analytics.summary.overrideRate)}
            detail={`${formatLatency(analytics.summary.averageLatencySeconds)} average audit latency`}
            tone={analytics.summary.overrideRate && analytics.summary.overrideRate > 20 ? "warning" : "neutral"}
            icon={<ShieldAlert />}
          />
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <DistributionPanel
            title="Carrier score distribution"
            description="Claim-level scores in the current dashboard response"
            rows={scoreDistribution}
          />
          <DistributionPanel
            title="AI readiness mix"
            description="System readiness is separate from human disposition"
            rows={readinessRows}
          />
          <DistributionPanel
            title="Technical risk mix"
            description="Risk classifications returned by completed audits"
            rows={riskRows}
          />
          <DistributionPanel
            title="Finding severity"
            description="Finding counts by API-provided severity"
            rows={severityRows}
          />
          <DistributionPanel
            title="Human workflow and aging"
            description="Claim count by reviewer state with average age"
            rows={workflowRows}
          />
        </div>

        <section className="ciq-panel ciq-panel--flush mt-4">
          <div className="ciq-panel__header">
            <div>
              <h2>Carrier workload and quality</h2>
              <p>Current corpus count and mean audit score</p>
            </div>
            <StatsReport className="h-4 w-4 text-[var(--ciq-brand)]" aria-hidden="true" />
          </div>
          {analytics.carrierPerformance.length ? (
            <div className="overflow-x-auto">
              <table className="ciq-table min-w-[560px]">
                <caption>Carrier workload and average audit score</caption>
                <thead>
                  <tr>
                    <th scope="col">Carrier</th>
                    <th scope="col">Claims</th>
                    <th scope="col">Share of corpus</th>
                    <th scope="col">Average score</th>
                    <th scope="col">Dollars at risk</th>
                    <th scope="col">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {[...analytics.carrierPerformance]
                    .sort((left, right) => right.claimCount - left.claimCount)
                    .map((carrier) => (
                      <tr key={carrier.name}>
                        <td className="font-semibold">
                          <Link
                            className="ciq-link"
                            href={`/claims?carrier=${encodeURIComponent(carrier.name)}`}
                          >
                            {carrier.name}
                          </Link>
                        </td>
                        <td className="ciq-mono">{carrier.claimCount.toLocaleString()}</td>
                        <td className="ciq-mono">
                          {data.stats.totalClaims
                            ? `${Math.round((carrier.claimCount / data.stats.totalClaims) * 100)}%`
                            : "—"}
                        </td>
                        <td className="ciq-mono font-semibold">
                          {formatScore(carrier.averageScore)}
                        </td>
                        <td className="ciq-mono font-semibold text-[var(--ciq-financial-strong)]">
                          {formatCurrency(carrier.dollarsAtRisk)}
                        </td>
                        <td className="w-48">
                          <div
                            className="ciq-bar ciq-bar--verified"
                            role="progressbar"
                            aria-label={`${carrier.name} share of corpus`}
                            aria-valuemin={0}
                            aria-valuemax={Math.max(data.stats.totalClaims, 1)}
                            aria-valuenow={carrier.claimCount}
                          >
                            <span
                              style={{
                                width: `${data.stats.totalClaims ? (carrier.claimCount / data.stats.totalClaims) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <PageState
                kind="unavailable"
                title="Carrier aggregates unavailable"
                description="No carrier rows were returned for the current corpus."
              />
            </div>
          )}
        </section>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <section className="ciq-panel ciq-panel--flush">
            <div className="ciq-panel__header">
              <div>
                <h2>Reviewer outcomes</h2>
                <p>Assignment volume, approvals, requested changes, and mean score</p>
              </div>
            </div>
            {analytics.reviewerPerformance.length ? (
              <div className="overflow-x-auto">
                <table className="ciq-table min-w-[560px]">
                  <caption>Reviewer workload and decision outcomes</caption>
                  <thead>
                    <tr>
                      <th scope="col">Reviewer</th>
                      <th scope="col">Assigned</th>
                      <th scope="col">Approved</th>
                      <th scope="col">Changes</th>
                      <th scope="col">Avg score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.reviewerPerformance.map((reviewer) => (
                      <tr key={reviewer.userId || "unassigned"}>
                        <td className="font-semibold">{reviewer.label}</td>
                        <td className="ciq-mono">{reviewer.assignedCount}</td>
                        <td className="ciq-mono">{reviewer.approvedCount}</td>
                        <td className="ciq-mono">{reviewer.changesRequestedCount}</td>
                        <td className="ciq-mono">{formatScore(reviewer.averageScore)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-4 text-sm text-[var(--ciq-ink-muted)]">
                Reviewer outcome data is not yet available.
              </p>
            )}
          </section>

          <section className="ciq-panel">
            <div className="ciq-panel__header">
              <div>
                <h2>Recurring root causes</h2>
                <p>Current-audit findings grouped by recorded cause or category</p>
              </div>
            </div>
            <div className="space-y-4 p-4">
              {analytics.rootCauses.length ? (
                analytics.rootCauses.map((cause) => {
                  const maximum = Math.max(...analytics.rootCauses.map((row) => row.count), 1)
                  return (
                    <div key={`${cause.label}-${cause.severity}`}>
                      <div className="mb-1.5 flex items-start justify-between gap-3">
                        <div>
                          <span className="text-xs font-semibold">{humanize(cause.label)}</span>
                          <StatusPill value={cause.severity} className="ml-2" />
                        </div>
                        <strong className="ciq-mono text-xs">{cause.count}</strong>
                      </div>
                      <div
                        className="ciq-bar ciq-bar--critical"
                        role="progressbar"
                        aria-label={`${humanize(cause.label)}: ${cause.count}`}
                        aria-valuemin={0}
                        aria-valuemax={maximum}
                        aria-valuenow={cause.count}
                      >
                        <span style={{ width: `${Math.max(4, (cause.count / maximum) * 100)}%` }} />
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-[var(--ciq-ink-muted)]">
                  No recurring non-pass causes are available.
                </p>
              )}
            </div>
          </section>
        </div>

        <p className="mt-4 text-xs leading-5 text-[var(--ciq-ink-muted)]">
          Scope note: these are current-state descriptive aggregates, not forecasts. “Dollars at
          risk” uses supplied claim exposure for high-risk or not-ready audits; it is not a
          guaranteed recoverable amount.
        </p>
      </PageBody>
    </div>
  )
}

function DistributionPanel({
  title,
  description,
  rows,
}: {
  title: string
  description: string
  rows: DistributionRow[]
}) {
  const max = Math.max(...rows.map((row) => row.value), 1)
  return (
    <section className="ciq-panel">
      <div className="ciq-panel__header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="space-y-4 p-4">
        {rows.length ? (
          rows.map((row) => (
            <div key={row.label}>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-[var(--ciq-ink)]">{row.label}</span>
                <strong className="ciq-mono text-xs">{row.value.toLocaleString()}</strong>
              </div>
              <div
                className={`ciq-bar ${
                  row.tone === "verified"
                    ? "ciq-bar--verified"
                    : row.tone === "financial"
                      ? "ciq-bar--financial"
                      : row.tone === "critical"
                        ? "ciq-bar--critical"
                        : ""
                }`}
                role="progressbar"
                aria-label={`${row.label}: ${row.value}`}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-valuenow={row.value}
              >
                <span style={{ width: `${row.value ? Math.max(4, (row.value / max) * 100) : 0}%` }} />
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm leading-6 text-[var(--ciq-ink-muted)]">
            This distribution is not available in the current corpus.
          </p>
        )}
      </div>
    </section>
  )
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`
}

function formatLatency(value: number | null) {
  if (value === null) return "Unavailable"
  if (value < 60) return `${value}s`
  return `${(value / 60).toFixed(1)}m`
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
