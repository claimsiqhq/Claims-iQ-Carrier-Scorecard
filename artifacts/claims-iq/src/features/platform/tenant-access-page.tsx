import { useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Building2, LogOut, ShieldCheck } from "lucide-react"
import { Link, useLocation } from "wouter"
import { BrandMark } from "@/components/complete-iq/brand-mark"
import { PageState } from "@/components/complete-iq/status"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import type { PlatformTenantSummary } from "@/lib/types"

export function PlatformAdminShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-[100dvh] bg-[var(--ciq-canvas)]">
      <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-4 border-b border-[var(--ciq-border)] bg-[var(--ciq-surface)] px-4 shadow-[var(--ciq-shadow-1)] sm:px-6">
        <div className="flex min-w-0 items-center gap-5">
          <BrandMark />
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Platform administration">
            <Link
              href="/tenant-access"
              className="rounded-md px-3 py-2 text-sm font-semibold text-[var(--ciq-ink-muted)] hover:bg-[var(--ciq-surface-subtle)] hover:text-[var(--ciq-ink)]"
            >
              Tenant access
            </Link>
            <Link
              href="/platform/carriers"
              className="rounded-md px-3 py-2 text-sm font-semibold text-[var(--ciq-ink-muted)] hover:bg-[var(--ciq-surface-subtle)] hover:text-[var(--ciq-ink)]"
            >
              Carrier rulesets
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-right text-xs text-[var(--ciq-ink-muted)] md:block">
            <strong className="block text-[var(--ciq-ink)]">Platform administration</strong>
            {user?.email || "Signed-in administrator"}
          </span>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}

export default function TenantAccessPage() {
  const { enterTenant } = useAuth()
  const [, setLocation] = useLocation()
  const [selectedTenant, setSelectedTenant] = useState<PlatformTenantSummary | null>(null)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tenants = useQuery({
    queryKey: queryKeys.platformTenants,
    queryFn: api.getPlatformTenants,
  })

  const closeDialog = () => {
    if (submitting) return
    setSelectedTenant(null)
    setReason("")
    setError(null)
  }

  const requestAccess = async () => {
    if (!selectedTenant || !reason.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await enterTenant(selectedTenant.id, reason)
      setLocation("/", { replace: true })
    } catch (accessError) {
      setError(apiErrorMessage(accessError, "Temporary tenant access could not be started."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="overflow-hidden rounded-xl border border-[var(--ciq-border)] bg-[var(--ciq-surface)] shadow-[var(--ciq-shadow-2)]">
        <div className="bg-[var(--ciq-aubergine)] px-5 py-7 text-white sm:px-8">
          <span className="text-xs font-bold uppercase tracking-[0.13em] text-[#d7cbe0]">
            Platform administration
          </span>
          <h1 className="mt-2 font-[var(--ciq-font-serif)] text-3xl font-semibold">
            Request tenant access
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#e5dce9]">
            Choose one organization and record the operational reason for temporary, audited access.
            Tenant metrics remain unavailable until access is granted.
          </p>
        </div>

        <div className="p-5 sm:p-8">
          <div className="mb-5 flex items-start gap-3 rounded-md border border-[#e7c781] bg-[var(--ciq-warning-soft)] p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ciq-warning)]" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--ciq-ink)]">Audited access boundary</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--ciq-ink-muted)]">
                A reason is required for every access lease. Complete iQ shows only organization
                identity here—never claims, financial exposure, or cross-tenant aggregates.
              </p>
            </div>
          </div>

          {tenants.isLoading && (
            <PageState
              kind="loading"
              title="Loading available organizations"
              description="Retrieving platform-visible tenant identities."
            />
          )}
          {tenants.isError && (
            <PageState
              kind="error"
              title="Organizations are unavailable"
              description={apiErrorMessage(tenants.error)}
              actionLabel="Retry"
              onAction={() => void tenants.refetch()}
            />
          )}
          {tenants.data && tenants.data.length === 0 && (
            <PageState
              kind="empty"
              title="No organizations available"
              description="Your platform account does not currently have an organization available for temporary access."
            />
          )}
          {tenants.data && tenants.data.length > 0 && (
            <ul className="grid gap-3 md:grid-cols-2" aria-label="Organizations available for access">
              {tenants.data.map((tenant) => (
                <li
                  key={tenant.id}
                  className="flex items-center gap-4 rounded-lg border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-4"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--ciq-info-soft)] text-[var(--ciq-info)]">
                    <Building2 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm text-[var(--ciq-ink)]">
                      {tenant.name}
                    </strong>
                    {tenant.slug && (
                      <small className="ciq-mono mt-1 block truncate text-[var(--ciq-ink-muted)]">
                        {tenant.slug}
                      </small>
                    )}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedTenant(tenant)
                      setReason("")
                      setError(null)
                    }}
                    aria-label={`Access ${tenant.name}`}
                  >
                    Access
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <Dialog open={Boolean(selectedTenant)} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Access {selectedTenant?.name}?</DialogTitle>
            <DialogDescription>
              Enter a specific operational reason. It will be attached to this temporary platform
              access lease.
            </DialogDescription>
          </DialogHeader>
          <div className="ciq-field">
            <label htmlFor="tenant-access-reason">Reason for access</label>
            <textarea
              id="tenant-access-reason"
              className="ciq-control min-h-28"
              value={reason}
              maxLength={500}
              disabled={submitting}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Example: Investigate support case CIQ-1842"
              autoFocus
            />
            <span className="text-xs text-[var(--ciq-ink-muted)]">
              Required · visible in the platform audit trail
            </span>
          </div>
          {error && (
            <p className="rounded-md bg-[var(--ciq-critical-soft)] p-3 text-sm text-[var(--ciq-critical)]" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={() => void requestAccess()}
              disabled={!reason.trim() || submitting}
            >
              <ShieldCheck aria-hidden="true" />
              {submitting ? "Starting access…" : "Start temporary access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function NoTenantAccessPage() {
  const { logout } = useAuth()

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--ciq-canvas)] p-5">
      <section className="w-full max-w-lg rounded-xl border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-7 text-center shadow-[var(--ciq-shadow-2)]">
        <BrandMark className="mx-auto mb-6" />
        <h1 className="font-[var(--ciq-font-serif)] text-2xl font-semibold">No tenant workspace assigned</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">
          Your account is authenticated, but the session does not include an organization
          membership. Contact a Complete iQ administrator for access.
        </p>
        <Button variant="outline" className="mt-6" onClick={() => void logout()}>
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </section>
    </div>
  )
}
