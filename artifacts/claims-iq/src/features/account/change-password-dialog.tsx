import { useId, useState } from "react"
import { LockKeyhole } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api, apiErrorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { validateNewPassword } from "@/lib/password-policy"

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const currentId = useId()
  const nextId = useId()
  const confirmId = useId()
  const { logout } = useAuth()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = (nextOpen: boolean) => {
    if (saving) return
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setCurrentPassword("")
      setNewPassword("")
      setConfirmation("")
      setError(null)
    }
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const passwordError = validateNewPassword(newPassword)
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (newPassword !== confirmation) {
      setError("Passwords do not match.")
      return
    }
    setSaving(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      onOpenChange(false)
      await logout()
    } catch (requestError) {
      setError(apiErrorMessage(requestError, "Password could not be changed."))
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Confirm your current password and choose at least 12 characters. All active sessions
            will be signed out.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="ciq-field">
            <label htmlFor={currentId}>Current password</label>
            <div className="ciq-search">
              <LockKeyhole aria-hidden="true" />
              <Input
                id={currentId}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                autoFocus
              />
            </div>
          </div>
          <div className="ciq-field">
            <label htmlFor={nextId}>New password</label>
            <Input
              id={nextId}
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </div>
          <div className="ciq-field">
            <label htmlFor={confirmId}>Confirm new password</label>
            <Input
              id={confirmId}
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </div>
          {error && (
            <p
              className="rounded-md border border-[#e5b3b3] bg-[var(--ciq-critical-soft)] px-3 py-2.5 text-sm text-[var(--ciq-critical)]"
              role="alert"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                saving
                || !currentPassword
                || Boolean(validateNewPassword(newPassword))
                || newPassword !== confirmation
              }
            >
              {saving ? "Changing password…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
