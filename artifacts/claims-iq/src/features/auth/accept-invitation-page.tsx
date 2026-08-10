import { useEffect, useId, useState } from "react"
import { ArrowLeft, LockKeyhole, UserRound } from "lucide-react"
import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, apiErrorMessage } from "@/lib/api"
import type { InvitationPreview } from "@/lib/types"
import { AuthShell } from "./auth-shell"
import { useAccountToken } from "./use-account-token"

export default function AcceptInvitationPage() {
  const token = useAccountToken()
  const firstNameId = useId()
  const lastNameId = useId()
  const passwordId = useId()
  const confirmationId = useId()
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [validating, setValidating] = useState(true)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setValidating(false)
      setError("This invitation link is incomplete.")
      return
    }
    api.inspectInvitation(token)
      .then(setPreview)
      .catch((requestError) => setError(apiErrorMessage(requestError)))
      .finally(() => setValidating(false))
  }, [token])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!preview) return
    setError(null)
    if (!preview.accountExists && password !== confirmation) {
      setError("Passwords do not match.")
      return
    }
    setSubmitting(true)
    try {
      await api.acceptInvitation(token, {
        password,
        firstName: preview.accountExists ? undefined : firstName,
        lastName: preview.accountExists ? undefined : lastName,
      })
      setComplete(true)
      setPreview(null)
    } catch (requestError) {
      setError(apiErrorMessage(requestError, "Invitation could not be accepted."))
    } finally {
      setSubmitting(false)
    }
  }

  const needsNewAccount = preview && !preview.accountExists
  return (
    <AuthShell
      eyebrow="Organization invitation"
      title={complete ? "Access established" : "Join the audit workspace"}
      description={
        complete
          ? "Your membership is active. Sign in to enter the protected workspace."
          : preview
            ? `${preview.organizationName} invited ${preview.email} with the ${preview.role} role.`
            : "Validate your secure invitation and establish organization access."
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
            Validating secure invitation…
          </p>
        )}
        {complete && (
          <p
            className="rounded-md border border-[#aedbd5] bg-[var(--ciq-verified-soft)] px-3 py-2.5 text-sm text-[var(--ciq-verified-strong)]"
            role="status"
          >
            Invitation accepted successfully.
          </p>
        )}
        {needsNewAccount && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="ciq-field">
              <label htmlFor={firstNameId}>First name</label>
              <div className="ciq-search">
                <UserRound aria-hidden="true" />
                <Input
                  id={firstNameId}
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>
            <div className="ciq-field">
              <label htmlFor={lastNameId}>Last name</label>
              <Input
                id={lastNameId}
                className="ciq-control"
                autoComplete="family-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </div>
          </div>
        )}
        {preview && (
          <>
            <div className="ciq-field">
              <label htmlFor={passwordId}>
                {preview.accountExists ? "Current password" : "Create password"}
              </label>
              <div className="ciq-search">
                <LockKeyhole aria-hidden="true" />
                <Input
                  id={passwordId}
                  type="password"
                  autoComplete={preview.accountExists ? "current-password" : "new-password"}
                  minLength={preview.accountExists ? undefined : 12}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoFocus={!needsNewAccount}
                />
              </div>
              <p>
                {preview.accountExists
                  ? "Confirm the password for the existing account before adding this organization."
                  : "Use at least 12 characters. You will use this password to sign in."}
              </p>
            </div>
            {!preview.accountExists && (
              <div className="ciq-field">
                <label htmlFor={confirmationId}>Confirm password</label>
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
            )}
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
        {preview && (
          <Button
            type="submit"
            className="w-full"
            disabled={
              submitting
              || !password
              || (Boolean(needsNewAccount) && (
                firstName.trim().length === 0
                || password.length < 12
                || confirmation.length < 12
              ))
            }
          >
            {submitting ? "Establishing access…" : "Accept invitation"}
          </Button>
        )}
      </form>
    </AuthShell>
  )
}
