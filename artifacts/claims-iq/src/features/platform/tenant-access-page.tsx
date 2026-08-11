import type { ReactNode } from "react"
import { Building2, LogOut, ShieldCheck } from "lucide-react"
import { Link } from "wouter"
import { BrandMark } from "@/components/complete-iq/brand-mark"
import { TenantSwitcher } from "@/components/complete-iq/tenant-switcher"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"

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
              Tenant workspace
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
          <TenantSwitcher />
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
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-5xl items-center px-4 py-10 sm:px-6">
      <section className="grid w-full overflow-hidden rounded-xl border border-[var(--ciq-border)] bg-[var(--ciq-surface)] shadow-[var(--ciq-shadow-2)] md:grid-cols-[0.8fr_1.2fr]">
        <div className="flex min-h-72 items-center justify-center bg-[var(--ciq-aubergine)] p-8 text-white">
          <div className="relative flex h-36 w-36 items-center justify-center rounded-full border border-white/20 bg-white/10">
            <span className="absolute inset-4 rounded-full border border-dashed border-white/25" />
            <Building2 className="h-12 w-12" aria-hidden="true" />
          </div>
        </div>
        <div className="flex flex-col justify-center p-7 sm:p-10">
          <span className="text-xs font-bold uppercase tracking-[0.13em] text-[var(--ciq-ink-faint)]">
            Platform administration
          </span>
          <h1 className="mt-3 font-[var(--ciq-font-serif)] text-3xl font-semibold text-[var(--ciq-ink)]">
            Choose a tenant from the header
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--ciq-ink-muted)]">
            Use the tenant menu in the top-right corner to open a carrier workspace. Once inside,
            the same menu stays available so you can move between authorized tenants without leaving
            your workflow.
          </p>
          <div className="mt-6 flex items-start gap-3 rounded-md border border-[#e7c781] bg-[var(--ciq-warning-soft)] p-4">
            <ShieldCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ciq-warning)]"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-sm font-semibold text-[var(--ciq-ink)]">
                Isolation remains enforced
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--ciq-ink-muted)]">
                Platform administrators still provide a reason for each temporary session. The
                switcher changes the experience—not the audited tenant boundary.
              </p>
            </div>
          </div>
        </div>
      </section>
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
