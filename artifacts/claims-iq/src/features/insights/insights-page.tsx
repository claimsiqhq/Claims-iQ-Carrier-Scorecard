import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { BarChart3, CheckCircle2, Files, Gauge, ShieldAlert } from "lucide-react"
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

  const scoreDistribution = useMemo(() => {
    const bins = [
      { label: "90–100", min: 90, max: 101, value: 0, tone: "verified" as const },
      { label: "75–89", min: 75, max: 90, value: 0, tone: "verified" as const },
      { label: "60–74", min: 60, max: 75, value: 0, tone: "financial" as const },
      { label: "Below 60", min: -Infinity, max: 60, value: 0, tone: "critical" as const },
      { label: "Unavailable", min: 0, max: 0, value: 0 },
    ]
    ;(dashboard.data?.recentClaims || []).forEach((claim) => {
      if (typeof claim.overallScore !== "number") {
        bins[4].value += 1
        return
      }
      const bin = bins.find(
        (candidate, index) =>
          index < 4 && claim.overallScore! >= candidate.min && claim.overallScore! < candidate.max,
      )
      if (bin) bin.value += 1
    })
    return bins.map(({ label, value, tone }) => ({ label, value, tone }))
  }, [dashboard.data])

  if (dashboard.isLoading) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="loading"
          title="Calculating corpus insights"
          description="Aggregating the current dashboard response without projecting missing values."
        />
      </div>
    )
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="error"
          title="Insights are unavailable"
          description="The dashboard aggregate endpoint did not return a current corpus."
          actionLabel="Retry"
          onAction={() => void dashboard.refetch()}
        />
      </div>
    )
  }

  const data = dashboard.data
  const totalFindings = Object.values(data.findingSeverity).reduce((sum, count) => sum + count, 0)
  const knownScores = data.recentClaims.filter((claim) => typeof claim.overallScore === "number").length
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

  return (
    <div className="ciq-page">
      <PageHeader
        compact
        eyebrow="Current corpus"
        title="Quality and workload insights"
        description="Descriptive aggregates from the dashboard API. No forecast, comparison period, or recoverable-dollar estimate is implied."
        meta={
          <>
            <StatusPill value="neutral" label={`${data.stats.totalClaims} claims in scope`} />
            <StatusPill
              value="neutral"
              label={`${knownScores} scored claim${knownScores === 1 ? "" : "s"}`}
            />
          </>
        }
      />
      <PageBody>
        <section className="ciq-metric-grid" aria-label="Corpus quality metrics">
          <MetricTile
            label="Corpus size"
            value={data.stats.totalClaims.toLocaleString()}
            detail="Current dashboard scope"
            icon={<Files />}
          />
          <MetricTile
            label="Completed audits"
            value={data.stats.analyzedCount.toLocaleString()}
            detail="Ready for human workflow"
            tone="verified"
            icon={<CheckCircle2 />}
          />
          <MetricTile
            label="Average score"
            value={formatScore(data.stats.avgScore)}
            detail={data.stats.avgScore === null ? "Not supplied" : "Completed audit corpus"}
            tone="financial"
            icon={<Gauge />}
          />
          <MetricTile
            label="Findings"
            value={totalFindings.toLocaleString()}
            detail="Across returned finding severities"
            tone={totalFindings ? "warning" : "verified"}
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
        </div>

        <section className="ciq-panel ciq-panel--flush mt-4">
          <div className="ciq-panel__header">
            <div>
              <h2>Carrier workload and quality</h2>
              <p>Current corpus count and mean audit score</p>
            </div>
            <BarChart3 className="h-4 w-4 text-[var(--ciq-aubergine)]" aria-hidden="true" />
          </div>
          {data.carriers.length ? (
            <div className="overflow-x-auto">
              <table className="ciq-table min-w-[560px]">
                <caption>Carrier workload and average audit score</caption>
                <thead>
                  <tr>
                    <th scope="col">Carrier</th>
                    <th scope="col">Claims</th>
                    <th scope="col">Share of corpus</th>
                    <th scope="col">Average score</th>
                    <th scope="col">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.carriers]
                    .sort((left, right) => right.count - left.count)
                    .map((carrier) => (
                      <tr key={carrier.name}>
                        <td className="font-semibold">{carrier.name}</td>
                        <td className="ciq-mono">{carrier.count.toLocaleString()}</td>
                        <td className="ciq-mono">
                          {data.stats.totalClaims
                            ? `${Math.round((carrier.count / data.stats.totalClaims) * 100)}%`
                            : "—"}
                        </td>
                        <td className="ciq-mono font-semibold">
                          {formatScore(carrier.avgScore)}
                        </td>
                        <td className="w-48">
                          <div
                            className="ciq-bar ciq-bar--verified"
                            role="progressbar"
                            aria-label={`${carrier.name} share of corpus`}
                            aria-valuemin={0}
                            aria-valuemax={Math.max(data.stats.totalClaims, 1)}
                            aria-valuenow={carrier.count}
                          >
                            <span
                              style={{
                                width: `${data.stats.totalClaims ? (carrier.count / data.stats.totalClaims) * 100 : 0}%`,
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

        <p className="mt-4 text-xs leading-5 text-[var(--ciq-ink-muted)]">
          Scope note: “current corpus” means the values returned by the live dashboard endpoint at
          load time. The API does not currently provide prior-period baselines, trend timestamps,
          or recoverable-dollar measures.
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
