import { useCallback, useId, useState } from "react"
import { Lock, Mail, ShieldCheck } from "iconoir-react"
import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth-context"
import { SESSION_EXPIRED_EVENT } from "@/lib/api"
import { AuthShell } from "./auth-shell"

export default function LoginPage() {
  const { login } = useAuth()
  const emailId = useId()
  const passwordId = useId()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sessionExpired] = useState(
    () => window.sessionStorage.getItem(SESSION_EXPIRED_EVENT) === "true",
  )

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!email || !password) return
      setLoading(true)
      setError(null)
      const message = await login(email, password)
      if (message) {
        setError(message)
        setLoading(false)
      }
    },
    [email, password, login],
  )

  return (
    <AuthShell
      eyebrow="Secure sign in"
      title="Return to the audit ledger"
      description="Use your organization-issued credentials. Your session uses a protected, server-managed cookie."
      footer={
        <>
          Need access? Contact your Complete iQ tenant administrator.
        </>
      }
    >
      <form
        onSubmit={handleSubmit}
        className="ciq-panel space-y-5 border-t-[3px] border-t-[var(--ciq-brand)] p-6 sm:p-7"
        noValidate
      >
            <div className="ciq-field">
              <label htmlFor={emailId}>Work email</label>
              <div className="ciq-search">
                <Mail aria-hidden="true" />
                <Input
                  id={emailId}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={Boolean(error)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="ciq-field">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={passwordId}>Password</label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-semibold text-[var(--ciq-brand)] hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="ciq-search">
                <Lock aria-hidden="true" />
                <Input
                  id={passwordId}
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(error)}
                  required
                />
              </div>
            </div>

            {sessionExpired && !error && (
              <p
                className="rounded-md border border-[#e7c781] bg-[var(--ciq-warning-soft)] px-3 py-2.5 text-sm text-[var(--ciq-warning)]"
                role="status"
              >
                Your protected session expired. Sign in again to continue.
              </p>
            )}

            {error && (
              <p
                className="rounded-md border border-[#e5b3b3] bg-[var(--ciq-critical-soft)] px-3 py-2.5 text-sm text-[var(--ciq-critical)]"
                role="alert"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={loading || !email || !password}
            >
              {loading ? "Verifying session…" : "Sign in"}
            </Button>

            <div className="flex items-start gap-2 border-t border-[var(--ciq-border)] pt-4 text-xs leading-5 text-[var(--ciq-ink-muted)]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ciq-gold)]" aria-hidden="true" />
              Complete iQ never asks you to share credentials in a claim note, email, or
              uploaded document.
            </div>
      </form>
    </AuthShell>
  )
}
