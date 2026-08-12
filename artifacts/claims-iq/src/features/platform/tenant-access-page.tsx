import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Building2, LoaderCircle, LogOut } from "lucide-react"
import { BrandMark } from "@/components/complete-iq/brand-mark"
import { Button } from "@/components/ui/button"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import type { AccessibleOrganization } from "@/lib/types"

export function NoTenantAccessPage() {
  const { logout, switchTenant } = useAuth()
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const organizations = useQuery({
    queryKey: queryKeys.organizations,
    queryFn: api.getOrganizations,
  })
  const availableTenants = organizations.data ?? []

  const openTenant = async (tenant: AccessibleOrganization) => {
    if (opening) return
    setOpening(tenant.id)
    setError(null)
    try {
      await switchTenant(tenant.id)
    } catch (switchError) {
      setError(apiErrorMessage(switchError, `${tenant.name} could not be opened.`))
      setOpening(null)
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--ciq-canvas)] p-5">
      <section className="w-full max-w-lg rounded-xl border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-7 text-center shadow-[var(--ciq-shadow-2)]">
        <BrandMark className="mx-auto mb-6" />
        {availableTenants.length > 0 ? (
          <>
            <h1 className="font-[var(--ciq-font-serif)] text-2xl font-semibold">Open a tenant workspace</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">
              Choose one of the tenants you can access to continue.
            </p>
            <ul className="mt-5 space-y-2 text-left" aria-label="Available tenants">
              {availableTenants.map((tenant) => (
                <li key={tenant.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-3 text-left transition-colors hover:border-[var(--ciq-border-strong)]"
                    disabled={Boolean(opening)}
                    onClick={() => void openTenant(tenant)}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--ciq-info-soft)] text-[var(--ciq-aubergine)]">
                      {opening === tenant.id ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Building2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </span>
                    <strong className="min-w-0 flex-1 truncate text-sm">{tenant.name}</strong>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h1 className="font-[var(--ciq-font-serif)] text-2xl font-semibold">No tenant workspace assigned</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">
              Your account is authenticated, but no tenant workspace is available.
              Contact a Complete iQ administrator for access.
            </p>
          </>
        )}
        {error && (
          <p
            className="mt-4 rounded-md bg-[var(--ciq-critical-soft)] p-3 text-sm text-[var(--ciq-critical)]"
            role="alert"
          >
            {error}
          </p>
        )}
        <Button variant="outline" className="mt-6" onClick={() => void logout()}>
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </section>
    </div>
  )
}
