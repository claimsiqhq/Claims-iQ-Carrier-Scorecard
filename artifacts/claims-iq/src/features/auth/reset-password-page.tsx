import { useEffect, useId, useState } from "react"
import { ArrowLeft, LockKeyhole } from "lucide-react"
import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, apiErrorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { validateNewPassword } from "@/lib/password-policy"
import { AuthShell } from "./auth-shell"
import { useAccountToken } from "./use-account-token"

export default function ResetPasswordPage() {
  const { token, clearToken } = useAccountToken()
  const { logout } = useAuth()
  const passwordId = useId()
  const confirmationId = useId()
  const [validating, setValidating] = useState(true)
  const [valid, setValid] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setValidating(false)
      setError("This password reset link is incomplete.")
      return
    }
    api.inspectPasswordReset(token)
      .then(() => setValid(true))
      .catch((requestError) => setError(apiErrorMessage(requestError)))
      .finally(() => setValidating(false))
  }, [token])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const passwordError = validateNewPassword(password)
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (password !== confirmation) {
      setError("Passwords do not match.")
      return
    }
    setSubmitting(true)
    try {
      await api.resetPassword(token, password)
      clearToken()
      await logout()
      setComplete(true)
      setValid(false)
    } catch (requestError) {
      setError(apiErrorMessage(requestError, "Password could not be reset."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Account security"
      title={complete ? "Password updated" : "Choose a new password"}
      description={
        complete
          ? "Your existing sessions were closed. Sign in again with your new password."
          : "Use at least 12 characters. This secure link can be used only once."
      }
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
        {validating && (
          <p className="text-sm text-[var(--ciq-ink-muted)]" role="status">
            Validating secure link…
          </p>
        )}
        {complete && (
          <p
            className="rounded-md border border-[#aedbd5] bg-[var(--ciq-verified-soft)] px-3 py-2.5 text-sm text-[var(--ciq-verified-strong)]"
            role="status"
          >
            Your password has been reset successfully.
          </p>
        )}
        {valid && !complete && (
          <>
            <div className="ciq-field">
              <label htmlFor={passwordId}>New password</label>
              <div className="ciq-search">
                <LockKeyhole aria-hidden="true" />
                <Input
                  id={passwordId}
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>
            <div className="ciq-field">
              <label htmlFor={confirmationId}>Confirm new password</label>
              <div className="ciq-search">
                <LockKeyhole aria-hidden="true" />
                <Input
                  id={confirmationId}
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                />
              </div>
            </div>
          </>
        )}
        {error && (
          <p
            className="rounded-md border border-[#e5b3b3] bg-[var(--ciq-critical-soft)] px-3 py-2.5 text-sm text-[var(--ciq-critical)]"
            role="alert"
          >
            {error}
          </p>
        )}
        {valid && !complete && (
          <Button
            type="submit"
            className="w-full"
            disabled={
              submitting
              || Boolean(validateNewPassword(password))
              || password !== confirmation
            }
          >
            {submitting ? "Securing account…" : "Set new password"}
          </Button>
        )}
      </form>
    </AuthShell>
  )
}
