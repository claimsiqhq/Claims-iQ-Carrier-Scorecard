import { useCallback, useId, useState } from "react"
import { CheckCircle2, LockKeyhole, Mail, ShieldCheck } from "lucide-react"
import { BrandMark } from "@/components/complete-iq/brand-mark"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth-context"

export default function LoginPage() {
  const { login } = useAuth()
  const emailId = useId()
  const passwordId = useId()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
    <main className="min-h-[100dvh] bg-[var(--ciq-canvas)] lg:grid lg:grid-cols-[1.08fr_0.92fr]">
      <section className="relative hidden min-h-[100dvh] overflow-hidden bg-[var(--ciq-midnight)] px-12 py-10 text-white lg:flex lg:flex-col">
        <BrandMark inverse />
        <div className="my-auto max-w-xl">
          <span className="ciq-eyebrow">Controlled evidence workspace</span>
          <h1 className="font-[var(--ciq-font-serif)] text-5xl font-semibold leading-[1.04] tracking-[-0.035em]">
            Every carrier decision, tied back to evidence.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-[#c8c0cc]">
            Complete iQ organizes claim files, audit findings, and reviewer actions into one
            accountable ledger—without obscuring the source record.
          </p>
          <ul className="mt-10 grid gap-4 text-sm text-[#ddd6e0]">
            {[
              "Source-aware findings and confidence visibility",
              "Carrier-specific quality controls and scorecards",
              "Human review remains distinct from AI readiness",
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 text-[#68c8bf]" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-[#8f8794]">
          Authorized enterprise access only · Activity may be audited
        </p>
        <div
          className="absolute -bottom-24 -right-16 h-80 w-64 rotate-[-8deg] border border-white/10"
          aria-hidden="true"
        />
      </section>

      <section className="flex min-h-[100dvh] items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <BrandMark />
          </div>
          <div className="mb-7">
            <span className="ciq-eyebrow !text-[var(--ciq-financial)]">Secure sign in</span>
            <h2 className="font-[var(--ciq-font-serif)] text-3xl font-semibold tracking-[-0.025em] text-[var(--ciq-ink)]">
              Return to the audit ledger
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">
              Use your organization-issued credentials. Your session uses a protected,
              server-managed cookie.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="ciq-panel space-y-5 border-t-[3px] border-t-[var(--ciq-aubergine)] p-6 sm:p-7"
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
              <label htmlFor={passwordId}>Password</label>
              <div className="ciq-search">
                <LockKeyhole aria-hidden="true" />
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
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ciq-verified)]" aria-hidden="true" />
              Complete iQ never asks you to share credentials in a claim note, email, or
              uploaded document.
            </div>
          </form>

          <p className="mt-6 text-center text-xs text-[var(--ciq-ink-faint)]">
            Need access? Contact your Complete iQ tenant administrator.
          </p>
        </div>
      </section>
    </main>
  )
}
