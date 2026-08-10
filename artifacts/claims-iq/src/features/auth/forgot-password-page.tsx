import { useId, useState } from "react"
import { ArrowLeft, Mail } from "lucide-react"
import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, apiErrorMessage } from "@/lib/api"
import { AuthShell } from "./auth-shell"

export default function ForgotPasswordPage() {
  const emailId = useId()
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      const result = await api.forgotPassword(email)
      setMessage(result.message)
    } catch (requestError) {
      setError(apiErrorMessage(requestError, "The request could not be completed."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your access"
      description="Enter your work email. If it matches an account, Complete iQ will send a single-use recovery link."
      footer={
        <Link href="/" className="inline-flex items-center gap-1.5 font-semibold hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Return to sign in
        </Link>
      }
    >
      <form
        onSubmit={submit}
        className="ciq-panel space-y-5 border-t-[3px] border-t-[var(--ciq-aubergine)] p-6 sm:p-7"
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
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
              autoFocus
            />
          </div>
        </div>
        {message && (
          <p
            className="rounded-md border border-[#aedbd5] bg-[var(--ciq-verified-soft)] px-3 py-2.5 text-sm text-[var(--ciq-verified-strong)]"
            role="status"
          >
            {message}
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
        <Button type="submit" className="w-full" disabled={submitting || !email.trim()}>
          {submitting ? "Requesting link…" : "Send reset link"}
        </Button>
      </form>
    </AuthShell>
  )
}
