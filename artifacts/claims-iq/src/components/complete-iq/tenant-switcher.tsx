import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Building2, Check, ChevronDown, LoaderCircle, RefreshCw } from "lucide-react"
import { useLocation } from "wouter"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/hooks/use-toast"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import type { AccessibleOrganization } from "@/lib/types"
import { cn } from "@/lib/utils"

export function TenantSwitcher({ className }: { className?: string }) {
  const [, setLocation] = useLocation()
  const { toast } = useToast()
  const { organization, switchTenant } = useAuth()
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const organizations = useQuery({
    queryKey: queryKeys.organizations,
    queryFn: api.getOrganizations,
    staleTime: 60_000,
  })

  const fallbackTenant: AccessibleOrganization | null = organization
    ? { id: organization.id, name: organization.name, role: organization.role }
    : null
  const availableTenants = uniqueTenants(
    organizations.data ?? (fallbackTenant ? [fallbackTenant] : []),
  )
  const currentTenantId = organization?.id ?? null
  const currentTenantName = organization?.name ?? "Select tenant"
  const hasMultipleTenants = availableTenants.length > 1

  const chooseTenant = async (tenant: AccessibleOrganization) => {
    if (tenant.id === currentTenantId || switchingTo) return
    setSwitchingTo(tenant.id)
    try {
      await switchTenant(tenant.id)
      setLocation("/", { replace: true })
    } catch (switchError) {
      toast({
        title: "Tenant switch failed",
        description: apiErrorMessage(
          switchError,
          `${tenant.name} could not be opened.`,
        ),
        variant: "destructive",
      })
    } finally {
      setSwitchingTo(null)
    }
  }

  return (
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
            {switchingTo ? <LoaderCircle className="animate-spin" /> : <Building2 />}
          </span>
          <span className="ciq-tenant-switcher__copy">
            <small>Tenant workspace</small>
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
              {hasMultipleTenants
                ? "Switch between the tenants you can access."
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
        {organizations.isLoading && availableTenants.length === 0 && (
          <DropdownMenuItem disabled>
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            Loading tenants…
          </DropdownMenuItem>
        )}
        {organizations.isError && availableTenants.length === 0 && (
          <DropdownMenuItem onSelect={() => void organizations.refetch()}>
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
              disabled={Boolean(switchingTo) && switchingTo !== tenant.id}
              onSelect={(event) => {
                if (!current) event.preventDefault()
                void chooseTenant(tenant)
              }}
              aria-label={
                current
                  ? `${tenant.name}, current tenant`
                  : `Switch to ${tenant.name}`
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
                {switchingTo === tenant.id ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                )}
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
        {availableTenants.length === 0
          && !organizations.isLoading
          && !organizations.isError && (
          <DropdownMenuItem disabled>No tenant is assigned</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function uniqueTenants(tenants: AccessibleOrganization[]) {
  return Array.from(new Map(tenants.map((tenant) => [tenant.id, tenant])).values())
}
