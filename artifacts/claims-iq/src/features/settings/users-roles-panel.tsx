import { useId, useState } from "react"
import { Key, MailIn, Refresh, UserPlus, XmarkCircle } from "iconoir-react"
import { StatusPill } from "@/components/complete-iq/status"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import type { SettingsOverview } from "@/lib/types"

const roles = ["owner", "admin", "auditor", "reviewer", "member", "viewer"]

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function UsersRolesPanel({
  overview,
  currentRole,
  currentUserId,
  roleSavingId,
  onRoleChange,
  onRefresh,
  onMessage,
  onError,
}: {
  overview: SettingsOverview
  currentRole: string
  currentUserId: string
  roleSavingId: string | null
  onRoleChange: (membershipId: string, role: string) => Promise<void>
  onRefresh: () => Promise<void>
  onMessage: (message: string) => void
  onError: (message: string) => void
}) {
  const inviteEmailId = useId()
  const inviteRoleId = useId()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("viewer")
  const [inviting, setInviting] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] =
    useState<SettingsOverview["invitations"][number] | null>(null)
  const [resetTarget, setResetTarget] =
    useState<SettingsOverview["members"][number] | null>(null)

  const invite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setInviting(true)
    setDialogError(null)
    try {
      await api.inviteMember(inviteEmail, inviteRole)
      onMessage(`Invitation sent to ${inviteEmail.trim().toLowerCase()}.`)
      setInviteOpen(false)
      setInviteEmail("")
      setInviteRole("viewer")
      await onRefresh()
    } catch (requestError) {
      setDialogError(apiErrorMessage(requestError, "Invitation could not be sent."))
    } finally {
      setInviting(false)
    }
  }

  const resend = async (invitationId: string) => {
    setActionId(invitationId)
    try {
      await api.resendInvitation(invitationId)
      onMessage("Invitation resent with a new secure link.")
      await onRefresh()
    } catch (requestError) {
      onError(apiErrorMessage(requestError, "Invitation could not be resent."))
    } finally {
      setActionId(null)
    }
  }

  const revoke = async () => {
    if (!revokeTarget || actionId) return
    setActionId(revokeTarget.id)
    setDialogError(null)
    try {
      await api.revokeInvitation(revokeTarget.id)
      onMessage(`Invitation for ${revokeTarget.email} revoked.`)
      setRevokeTarget(null)
      await onRefresh()
    } catch (requestError) {
      setDialogError(apiErrorMessage(requestError, "Invitation could not be revoked."))
    } finally {
      setActionId(null)
    }
  }

  const sendReset = async () => {
    if (!resetTarget || actionId) return
    setActionId(resetTarget.membershipId)
    setDialogError(null)
    try {
      const result = await api.sendMemberPasswordReset(resetTarget.membershipId)
      onMessage(`${result.message} for ${resetTarget.email}.`)
      setResetTarget(null)
      await onRefresh()
    } catch (requestError) {
      setDialogError(apiErrorMessage(requestError, "Password reset could not be sent."))
    } finally {
      setActionId(null)
    }
  }

  const emailReady = overview.integrations.email.configured
  return (
    <>
      <div className="space-y-4">
        {!emailReady && (
          <div
            className="rounded-md border border-[#e7c781] bg-[var(--ciq-warning-soft)] p-3 text-sm text-[var(--ciq-warning)]"
            role="status"
          >
            Configure both SendGrid API key and sender address before sending invitations or
            password resets.
          </div>
        )}

        <section className="ciq-panel ciq-panel--flush">
          <div className="ciq-panel__header">
            <div>
              <h2>Users & roles</h2>
              <p>Invite verified members and govern least-privilege workflow access</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <StatusPill value="verified" label={`${overview.members.length} active`} />
              <StatusPill
                value="pending"
                label={`${overview.invitations.length} invited`}
                tone="progress"
              />
              <Button
                size="sm"
                onClick={() => {
                  setDialogError(null)
                  setInviteOpen(true)
                }}
                disabled={!emailReady}
              >
                <UserPlus aria-hidden="true" />
                Invite user
              </Button>
            </div>
          </div>

          {overview.invitations.length > 0 && (
            <div className="border-b border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-4">
              <h3 className="ciq-section-title mb-3">Pending invitations</h3>
              <div className="grid gap-2">
                {overview.invitations.map((invitation) => {
                  const privilegedInvitation = ["owner", "admin"].includes(invitation.role)
                  const actionDisabled =
                    actionId === invitation.id
                    || (currentRole !== "owner" && privilegedInvitation)
                  return (
                    <div
                      key={invitation.id}
                      className="flex flex-col gap-3 rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <strong className="block truncate text-sm">{invitation.email}</strong>
                        <p className="mt-1 text-xs text-[var(--ciq-ink-muted)]">
                          {humanize(invitation.role)} ·{" "}
                          {invitation.status === "expired"
                            ? "Expired"
                            : `Expires ${new Date(invitation.expiresAt).toLocaleString()}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          value={invitation.status}
                          label={humanize(invitation.status)}
                          tone={invitation.status === "expired" ? "warning" : "progress"}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void resend(invitation.id)}
                          disabled={actionDisabled}
                        >
                          <Refresh
                            className={actionId === invitation.id ? "animate-spin" : ""}
                            aria-hidden="true"
                          />
                          Resend
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDialogError(null)
                            setRevokeTarget(invitation)
                          }}
                          disabled={actionDisabled}
                          aria-label={`Revoke invitation for ${invitation.email}`}
                        >
                          <XmarkCircle aria-hidden="true" />
                          Revoke
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="ciq-table min-w-[760px]">
              <caption>Organization users and assigned roles</caption>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Email</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Role</th>
                  <th scope="col">Account action</th>
                </tr>
              </thead>
              <tbody>
                {overview.members.map((member) => {
                  const privilegedTarget = ["owner", "admin"].includes(member.role)
                  return (
                    <tr key={member.membershipId}>
                      <td className="font-semibold">
                        {[member.firstName, member.lastName].filter(Boolean).join(" ")
                          || "Unnamed user"}
                        {member.userId === currentUserId && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--ciq-ink-faint)]">
                            You
                          </span>
                        )}
                      </td>
                      <td>{member.email}</td>
                      <td className="ciq-mono text-xs">
                        {new Date(member.joinedAt).toLocaleDateString()}
                      </td>
                      <td>
                        <select
                          className="ciq-control min-w-36"
                          aria-label={`Role for ${member.email}`}
                          value={member.role}
                          disabled={
                            roleSavingId === member.membershipId
                            || (currentRole !== "owner" && privilegedTarget)
                          }
                          onChange={(event) =>
                            void onRoleChange(member.membershipId, event.target.value)
                          }
                        >
                          {roles.map((role) => (
                            <option
                              key={role}
                              value={role}
                              disabled={
                                currentRole !== "owner"
                                && (role === "owner" || role === "admin")
                              }
                            >
                              {humanize(role)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDialogError(null)
                            setResetTarget(member)
                          }}
                          disabled={
                            !emailReady
                            || actionId === member.membershipId
                            || (
                              currentRole !== "owner"
                              && privilegedTarget
                            )
                          }
                        >
                          <Key aria-hidden="true" />
                          Send reset
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-[var(--ciq-border)] p-4 text-xs text-[var(--ciq-ink-muted)]">
            Invitees establish their own password through a single-use link. Administrators never
            see or assign user passwords. The final owner cannot be demoted.
          </p>
        </section>
      </div>

      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          if (inviting) return
          setInviteOpen(open)
          if (!open) setDialogError(null)
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>
              Send a 48-hour, single-use invitation. Access begins only after acceptance.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={invite} className="space-y-4">
            <div className="ciq-field">
              <label htmlFor={inviteEmailId}>Work email</label>
              <div className="ciq-search">
                <MailIn aria-hidden="true" />
                <Input
                  id={inviteEmailId}
                  type="email"
                  autoComplete="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>
            <div className="ciq-field">
              <label htmlFor={inviteRoleId}>Organization role</label>
              <select
                id={inviteRoleId}
                className="ciq-control"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value)}
              >
                {roles.map((role) => (
                  <option
                    key={role}
                    value={role}
                    disabled={
                      currentRole !== "owner"
                      && (role === "owner" || role === "admin")
                    }
                  >
                    {humanize(role)}
                  </option>
                ))}
              </select>
            </div>
            {dialogError && (
              <p
                className="rounded-md border border-[#e5b3b3] bg-[var(--ciq-critical-soft)] px-3 py-2.5 text-sm text-[var(--ciq-critical)]"
                role="alert"
              >
                {dialogError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInviteOpen(false)}
                disabled={inviting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={inviting || !inviteEmail.trim()}>
                <UserPlus aria-hidden="true" />
                {inviting ? "Sending invitation…" : "Send invitation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (actionId) return
          if (!open) {
            setRevokeTarget(null)
            setDialogError(null)
          }
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              The current secure link for {revokeTarget?.email} will stop working immediately.
            </AlertDialogDescription>
            {dialogError && (
              <p className="text-sm text-[var(--ciq-critical)]" role="alert">
                {dialogError}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(actionId)}>Keep invitation</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void revoke()
              }}
              disabled={Boolean(actionId)}
            >
              {actionId ? "Revoking…" : "Revoke invitation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => {
          if (actionId) return
          if (!open) {
            setResetTarget(null)
            setDialogError(null)
          }
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Send password reset?</AlertDialogTitle>
            <AlertDialogDescription>
              Complete iQ will send {resetTarget?.email} a one-hour, single-use reset link. Their
              password remains unchanged until they complete it.
            </AlertDialogDescription>
            {dialogError && (
              <p className="text-sm text-[var(--ciq-critical)]" role="alert">
                {dialogError}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(actionId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void sendReset()
              }}
              disabled={Boolean(actionId)}
            >
              {actionId ? "Sending…" : "Send password reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
