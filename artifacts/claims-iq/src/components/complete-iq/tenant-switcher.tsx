import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Building2, Check, ChevronDown, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react"
import { useLocation } from "wouter"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import type { PlatformTenantSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

export function TenantSwitcher({ className }: { className?: string }) {
  const [, setLocation] = useLocation()
  const { organization, isPlatformAdmin, enterTenant } = useAuth()
  const [selectedTenant, setSelectedTenant] = useState<PlatformTenantSummary | null>(null)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tenants = useQuery({
    queryKey: queryKeys.platformTenants,
    queryFn: api.getPlatformTenants,
    enabled: isPlatformAdmin,
    staleTime: 60_000,
  })

  const fallbackTenant: PlatformTenantSummary | null = organization
    ? { id: organization.id, name: organization.name }
    : null
  const availableTenants = isPlatformAdmin
    ? uniqueTenants(tenants.data ?? (fallbackTenant ? [fallbackTenant] : []))
    : fallbackTenant
      ? [fallbackTenant]
      : []
  const currentTenantId = organization?.id ?? null
  const currentTenantName = organization?.name ?? "Select tenant"
  const accessIsTemporary = organization?.accessMode === "platform_lease"

  const closeDialog = () => {
    if (submitting) return
    setSelectedTenant(null)
    setReason("")
    setError(null)
  }

  const chooseTenant = (tenant: PlatformTenantSummary) => {
    if (tenant.id === currentTenantId || !isPlatformAdmin) return
    setSelectedTenant(tenant)
    setReason("")
    setError(null)
  }

  const requestAccess = async () => {
    if (!selectedTenant || !reason.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await enterTenant(selectedTenant.id, reason)
      setSelectedTenant(null)
      setReason("")
      setLocation("/", { replace: true })
    } catch (accessError) {
      setError(apiErrorMessage(accessError, "Temporary tenant access could not be started."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn("ciq-tenant-switcher", className)}
            aria-label={
              organization
                ? `Tenant menu. Current tenant: ${organization.name}`
                : "Tenant menu. Select a tenant"
            }
          >
            <span className="ciq-tenant-switcher__icon" aria-hidden="true">
              <Building2 />
            </span>
            <span className="ciq-tenant-switcher__copy">
              <small>{accessIsTemporary ? "Temporary access" : "Tenant workspace"}</small>
              <strong>{currentTenantName}</strong>
            </span>
            <ChevronDown className="ciq-tenant-switcher__chevron" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm">Tenant workspace</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                {isPlatformAdmin
                  ? "Choose a tenant to open an audited session."
                  : "Your assigned tenant."}
              </span>
            </span>
            {availableTenants.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
                {availableTenants.length}
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {isPlatformAdmin && tenants.isLoading && availableTenants.length === 0 && (
            <DropdownMenuItem disabled>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Loading tenants…
            </DropdownMenuItem>
          )}
          {isPlatformAdmin && tenants.isError && availableTenants.length === 0 && (
            <DropdownMenuItem onSelect={() => void tenants.refetch()}>
              <RefreshCw aria-hidden="true" />
              Retry tenant list
            </DropdownMenuItem>
          )}
          {availableTenants.map((tenant) => {
            const current = tenant.id === currentTenantId
            return (
              <DropdownMenuItem
                key={tenant.id}
                className="min-h-12 gap-3"
                onSelect={() => chooseTenant(tenant)}
                aria-label={
                  current
                    ? `${tenant.name}, current tenant`
                    : organization
                      ? `Switch to ${tenant.name}`
                      : `Open ${tenant.name}`
                }
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                    current
                      ? "bg-[var(--ciq-verified-soft)] text-[var(--ciq-verified-strong)]"
                      : "bg-[var(--ciq-surface-subtle)] text-[var(--ciq-ink-muted)]",
                  )}
                >
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm font-semibold">{tenant.name}</strong>
                  {tenant.slug && (
                    <small className="ciq-mono mt-0.5 block truncate text-[0.65rem] text-muted-foreground">
                      {tenant.slug}
                    </small>
                  )}
                </span>
                {current && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-[var(--ciq-verified-strong)]">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Current
                  </span>
                )}
              </DropdownMenuItem>
            )
          })}
          {availableTenants.length === 0 && !tenants.isLoading && !tenants.isError && (
            <DropdownMenuItem disabled>No tenant is assigned</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={Boolean(selectedTenant)} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{organization ? "Switch tenant" : "Open tenant workspace"}</DialogTitle>
            <DialogDescription>
              Enter the operational reason for accessing {selectedTenant?.name}. Complete iQ records
              every platform tenant session.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-md border border-[#e7c781] bg-[var(--ciq-warning-soft)] p-3">
            <ShieldCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ciq-warning)]"
              aria-hidden="true"
            />
            <p className="text-xs leading-5 text-[var(--ciq-ink-muted)]">
              {organization
                ? "The current tenant session ends when the new audited session begins. Data and cached workspace state remain isolated."
                : "Access is time-limited, reason-bound, and isolated to the tenant you select."}
            </p>
          </div>
          <div className="ciq-field">
            <label htmlFor="tenant-switch-reason">Reason for access</label>
            <textarea
              id="tenant-switch-reason"
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
            <p
              className="rounded-md bg-[var(--ciq-critical-soft)] p-3 text-sm text-[var(--ciq-critical)]"
              role="alert"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void requestAccess()} disabled={!reason.trim() || submitting}>
              <ShieldCheck aria-hidden="true" />
              {submitting
                ? "Opening tenant…"
                : organization
                  ? `Switch to ${selectedTenant?.name ?? "tenant"}`
                  : `Open ${selectedTenant?.name ?? "tenant"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function uniqueTenants(tenants: PlatformTenantSummary[]) {
  return Array.from(new Map(tenants.map((tenant) => [tenant.id, tenant])).values())
}
