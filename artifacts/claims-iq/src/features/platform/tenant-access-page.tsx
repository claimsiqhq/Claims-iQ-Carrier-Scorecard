import { LogOut } from "lucide-react"
import { BrandMark } from "@/components/complete-iq/brand-mark"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"

export function NoTenantAccessPage() {
  const { logout } = useAuth()

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--ciq-canvas)] p-5">
      <section className="w-full max-w-lg rounded-xl border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-7 text-center shadow-[var(--ciq-shadow-2)]">
        <BrandMark className="mx-auto mb-6" />
        <h1 className="font-[var(--ciq-font-serif)] text-2xl font-semibold">No tenant workspace assigned</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">
          Your account is authenticated, but no tenant workspace is available.
          Contact a Complete iQ administrator for access.
        </p>
        <Button variant="outline" className="mt-6" onClick={() => void logout()}>
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </section>
    </div>
  )
}
