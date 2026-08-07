import type { ReactNode } from "react"
import {
  CheckCircle,
  Clock,
  InfoCircle,
  Refresh,
  ShieldCheck,
  WarningTriangle,
} from "iconoir-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type StatusTone = "neutral" | "progress" | "verified" | "warning" | "critical" | "financial"

function toneFor(value: string): StatusTone {
  const normalized = value.toLowerCase()
  if (
    ["analyzed", "approved", "ready", "pass", "passed", "active", "published", "succeeded", "accepted", "remediated"].includes(
      normalized,
    )
  ) {
    return "verified"
  }
  if (
    ["processing", "pending", "queued", "running", "review", "in_review", "partial", "draft"].includes(
      normalized,
    )
  ) {
    return "progress"
  }
  if (["medium", "warning", "needs review", "degraded", "changes_requested"].includes(normalized)) {
    return "warning"
  }
  if (
    ["error", "denied", "fail", "failed", "cancelled", "high", "critical", "not ready", "not_ready"].includes(normalized)
  ) {
    return "critical"
  }
  return "neutral"
}

export function StatusPill({
  value,
  label,
  tone,
  className,
}: {
  value: string
  label?: string
  tone?: StatusTone
  className?: string
}) {
  const resolvedTone = tone ?? toneFor(value)
  return (
    <span className={cn("ciq-status", `ciq-status--${resolvedTone}`, className)}>
      <span className="ciq-status__dot" aria-hidden="true" />
      {label ?? humanize(value)}
    </span>
  )
}

export function PageState({
  kind,
  title,
  description,
  actionLabel,
  onAction,
  children,
}: {
  kind: "loading" | "error" | "empty" | "unavailable"
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  children?: ReactNode
}) {
  const Icon =
    kind === "loading"
      ? Refresh
      : kind === "error"
        ? WarningTriangle
        : kind === "unavailable"
          ? InfoCircle
          : ShieldCheck

  return (
    <section
      className={cn("ciq-page-state", kind === "error" && "ciq-page-state--error")}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "loading" ? "polite" : undefined}
    >
      <span className={cn("ciq-page-state__icon", kind === "loading" && "animate-spin")}>
        <Icon width={22} height={22} aria-hidden="true" />
      </span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
      {actionLabel && onAction && (
        <Button variant="outline" onClick={onAction}>
          {kind === "error" && <Refresh aria-hidden="true" />}
          {actionLabel}
        </Button>
      )}
    </section>
  )
}

export function MetricTile({
  label,
  value,
  detail,
  tone = "neutral",
  icon,
}: {
  label: string
  value: ReactNode
  detail: string
  tone?: StatusTone
  icon?: ReactNode
}) {
  return (
    <article className={cn("ciq-metric", `ciq-metric--${tone}`)}>
      <div className="ciq-metric__top">
        <span>{label}</span>
        <span className="ciq-metric__icon" aria-hidden="true">
          {icon ??
            (tone === "verified" ? (
              <CheckCircle />
            ) : tone === "warning" ? (
              <WarningTriangle />
            ) : (
              <Clock />
            ))}
        </span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

export function humanize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function formatDate(value?: string | null, includeTime = false) {
  if (!value) return "Unavailable"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date)
}

export function formatScore(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "—"
}
