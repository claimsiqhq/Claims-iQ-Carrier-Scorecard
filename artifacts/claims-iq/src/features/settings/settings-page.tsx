import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Bell,
  Clock3,
  FileCode2,
  FileClock,
  KeyRound,
  Link2,
  RefreshCw,
  Save,
  ShieldCheck,
  Users,
} from "lucide-react"
import { PageState, StatusPill } from "@/components/complete-iq/status"
import { PageBody, PageHeader } from "@/components/layout/app-shell"
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
import { Switch } from "@/components/ui/switch"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import type {
  OrganizationSettingsInput,
  PromptSettings,
  SettingsOverview,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { UsersRolesPanel } from "./users-roles-panel"

type SettingsSection =
  | "prompts"
  | "users"
  | "integrations"
  | "notifications"
  | "security"
  | "retention"
  | "history"

const sections = [
  { id: "prompts" as const, label: "Assigned prompt", icon: FileCode2 },
  { id: "users" as const, label: "Users & Roles", icon: Users },
  { id: "integrations" as const, label: "Integrations", icon: Link2 },
  { id: "notifications" as const, label: "Notifications", icon: Bell },
  { id: "security" as const, label: "Security", icon: ShieldCheck },
  { id: "retention" as const, label: "Retention", icon: Clock3 },
  { id: "history" as const, label: "Audit History", icon: FileClock },
]

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { organization, user } = useAuth()
  const initializedRef = useRef(false)
  const [section, setSection] = useState<SettingsSection>("prompts")
  const [draft, setDraft] = useState<PromptSettings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [organizationDraft, setOrganizationDraft] =
    useState<OrganizationSettingsInput | null>(null)
  const [organizationDirty, setOrganizationDirty] = useState(false)
  const [savingOrganization, setSavingOrganization] = useState(false)
  const [roleSavingId, setRoleSavingId] = useState<string | null>(null)

  const prompts = useQuery({ queryKey: queryKeys.prompts, queryFn: api.getPrompts })
  const overview = useQuery({
    queryKey: queryKeys.settingsOverview,
    queryFn: api.getSettingsOverview,
  })

  useEffect(() => {
    if (!prompts.data || initializedRef.current) return
    initializedRef.current = true
    setDraft(prompts.data)
  }, [prompts.data])

  useEffect(() => {
    if (!overview.data || organizationDraft) return
    const {
      inAppNotificationsEnabled,
      emailNotificationsEnabled,
      retentionDays,
      purgeMode,
    } = overview.data.organizationSettings
    setOrganizationDraft({
      inAppNotificationsEnabled,
      emailNotificationsEnabled,
      retentionDays,
      purgeMode,
    })
  }, [organizationDraft, overview.data])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty && !organizationDirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [dirty, organizationDirty])

  const updatePrompt = (
    key: "system_prompt" | "user_prompt_template",
    value: string,
  ) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
    setDirty(true)
    setMessage(null)
    setError(null)
  }

  const save = async () => {
    if (!draft) return
    if (!draft.system_prompt.trim() || !draft.user_prompt_template.trim()) {
      setError("Prompt fields cannot be empty.")
      return
    }
    const missingPlaceholders = ["{{DA_QUESTIONS}}", "{{FA_QUESTIONS}}", "{{REPORT}}"].filter(
      (placeholder) => !draft.user_prompt_template.includes(placeholder),
    )
    if (missingPlaceholders.length) {
      setError(`The user prompt template is missing: ${missingPlaceholders.join(", ")}.`)
      return
    }
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      await api.savePrompts(draft)
      setDirty(false)
      setMessage("Assigned prompt saved.")
      await queryClient.invalidateQueries({ queryKey: queryKeys.prompts })
    } catch (saveError) {
      setError(apiErrorMessage(saveError, "The assigned prompt could not be saved."))
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    setResetting(true)
    setMessage(null)
    setError(null)
    try {
      const defaults = await api.resetPrompts()
      setDraft({
        system_prompt: defaults.system_prompt,
        user_prompt_template: defaults.user_prompt_template,
      })
      setDirty(false)
      setMessage("Assigned prompt reset to server defaults.")
      setResetOpen(false)
      await queryClient.invalidateQueries({ queryKey: queryKeys.prompts })
    } catch (resetError) {
      setError(apiErrorMessage(resetError, "The assigned prompt could not be reset."))
    } finally {
      setResetting(false)
    }
  }

  const updateOrganizationDraft = (patch: Partial<OrganizationSettingsInput>) => {
    setOrganizationDraft((current) => (current ? { ...current, ...patch } : current))
    setOrganizationDirty(true)
    setMessage(null)
    setError(null)
  }

  const saveOrganization = async () => {
    if (!organizationDraft) return
    setSavingOrganization(true)
    setMessage(null)
    setError(null)
    try {
      await api.updateOrganizationSettings(organizationDraft)
      setOrganizationDirty(false)
      setMessage("Organization policy settings saved.")
      await queryClient.invalidateQueries({ queryKey: queryKeys.settingsOverview })
    } catch (saveError) {
      setError(apiErrorMessage(saveError, "Organization settings could not be saved."))
    } finally {
      setSavingOrganization(false)
    }
  }

  const updateMemberRole = async (membershipId: string, role: string) => {
    setRoleSavingId(membershipId)
    setMessage(null)
    setError(null)
    try {
      await api.updateMemberRole(membershipId, role)
      setMessage("Member role updated.")
      await queryClient.invalidateQueries({ queryKey: queryKeys.settingsOverview })
    } catch (roleError) {
      setError(apiErrorMessage(roleError, "The member role could not be updated."))
    } finally {
      setRoleSavingId(null)
    }
  }

  if (prompts.isLoading || overview.isLoading) {
    return (
      <div className="ciq-page p-6">
        <PageState kind="loading" title="Loading tenant settings" />
      </div>
    )
  }

  if (prompts.isError || overview.isError || !overview.data) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="error"
          title="Settings are unavailable"
          description={apiErrorMessage(prompts.error || overview.error)}
          actionLabel="Retry"
          onAction={() => {
            void prompts.refetch()
            void overview.refetch()
          }}
        />
      </div>
    )
  }

  return (
    <div className="ciq-page">
      <PageHeader
        compact
        eyebrow="Tenant administration"
        title="Settings"
        description="Govern the assigned prompt, members, integrations, notifications, security, retention, and immutable change history for this organization."
        meta={
          <>
            <StatusPill value="admin" label="Administrator scope" />
            {(dirty || organizationDirty) && (
              <StatusPill value="warning" label="Unsaved changes" tone="warning" />
            )}
          </>
        }
        actions={
          section === "prompts" ? (
            <>
              <Button
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                onClick={() => setResetOpen(true)}
                disabled={saving || resetting}
              >
                <RefreshCw aria-hidden="true" />
                Reset defaults
              </Button>
              <Button
                className="border-white/15 bg-white text-[var(--ciq-aubergine)] hover:bg-[#f7f3ed]"
                onClick={() => void save()}
                disabled={!dirty || saving}
              >
                <Save aria-hidden="true" />
                {saving ? "Saving…" : "Save assigned prompt"}
              </Button>
            </>
          ) : ["notifications", "retention"].includes(section) ? (
            <Button
              className="border-white/15 bg-white text-[var(--ciq-aubergine)] hover:bg-[#f7f3ed]"
              onClick={() => void saveOrganization()}
              disabled={!organizationDirty || savingOrganization}
            >
              <Save aria-hidden="true" />
              {savingOrganization ? "Saving…" : "Save policy"}
            </Button>
          ) : undefined
        }
      />

      <PageBody className="!max-w-[88rem]">
        {(error || message) && (
          <div
            className={`mb-4 rounded-md border p-3 text-sm ${
              error
                ? "border-[#e5b3b3] bg-[var(--ciq-critical-soft)] text-[var(--ciq-critical)]"
                : "border-[#aedbd5] bg-[var(--ciq-verified-soft)] text-[var(--ciq-verified-strong)]"
            }`}
            role={error ? "alert" : "status"}
          >
            {error || message}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <nav
            className="ciq-panel flex gap-1 overflow-x-auto p-2 lg:block lg:space-y-1 lg:overflow-visible"
            aria-label="Settings sections"
          >
            {sections.map((item) => {
              const Icon = item.icon
              const active = section === item.id
              return (
                <button
                  type="button"
                  key={item.id}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-left text-xs font-semibold transition-colors lg:w-full",
                    active
                      ? "bg-[var(--ciq-aubergine)] text-white"
                      : "text-[var(--ciq-ink-muted)] hover:bg-[var(--ciq-surface-subtle)]",
                  )}
                  onClick={() => setSection(item.id)}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>

          <section className="min-w-0">
            {section === "prompts" ? (
              draft ? (
                <PromptSettingsPanel draft={draft} onChange={updatePrompt} />
              ) : (
                <PageState
                  kind="unavailable"
                  title="Assigned prompt returned no editable values"
                />
              )
            ) : (
              <SettingsSectionPanel
                section={section}
                overview={overview.data}
                organizationDraft={organizationDraft}
                onOrganizationChange={updateOrganizationDraft}
                onRoleChange={updateMemberRole}
                roleSavingId={roleSavingId}
                currentRole={organization?.role || "viewer"}
                currentUserId={user?.id || ""}
                onRefresh={async () => {
                  await queryClient.invalidateQueries({ queryKey: queryKeys.settingsOverview })
                }}
                onMessage={(nextMessage) => {
                  setError(null)
                  setMessage(nextMessage)
                }}
                onError={(nextError) => {
                  setMessage(null)
                  setError(nextError)
                }}
              />
            )}
          </section>
        </div>
      </PageBody>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset assigned prompt?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces both editable prompt fields with the server defaults. Any unsaved edits
              will be lost. Every intake in this tenant will use the restored prompt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Keep current prompts</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void reset()
              }}
              disabled={resetting}
            >
              <RefreshCw className={resetting ? "animate-spin" : ""} aria-hidden="true" />
              {resetting ? "Resetting…" : "Reset to defaults"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PromptSettingsPanel({
  draft,
  onChange,
}: {
  draft: PromptSettings
  onChange: (key: "system_prompt" | "user_prompt_template", value: string) => void
}) {
  return (
    <div className="space-y-4">
      <section className="ciq-panel p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--ciq-info-soft)] text-[var(--ciq-info)]">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Assigned prompt for this tenant</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ciq-ink-muted)]">
              This tenant has exactly one prompt. Every intake in this workspace uses it.
              Writing companies are labels, not prompt choices. The text is snapshotted into
              every immutable audit run. Active model:{" "}
              <span className="ciq-mono font-semibold">
                {draft.model_identifier || "server-managed"}
              </span>
              {draft.updated_at ? ` · Last changed ${new Date(draft.updated_at).toLocaleString()}` : ""}
            </p>
          </div>
        </div>
      </section>

      <section className="ciq-panel">
        <div className="ciq-panel__header">
          <div>
            <h2>System prompt</h2>
            <p>Defines reviewer persona, evidence discipline, and response behavior</p>
          </div>
          <StatusPill value="active" label="Editable endpoint" tone="verified" />
        </div>
        <div className="p-4">
          <label htmlFor="settings-system-prompt" className="ciq-label">
            System prompt content
          </label>
          <textarea
            id="settings-system-prompt"
            className="ciq-control mt-2 min-h-[18rem] font-[var(--ciq-font-mono)] text-xs leading-6"
            value={draft.system_prompt}
            onChange={(event) => onChange("system_prompt", event.target.value)}
          />
        </div>
      </section>

      <section className="ciq-panel">
        <div className="ciq-panel__header">
          <div>
            <h2>User prompt template</h2>
            <p>Scoring rubric, document insertion point, and output contract</p>
          </div>
          <StatusPill value="active" label="Editable endpoint" tone="verified" />
        </div>
        <div className="p-4">
          <div className="mb-3 rounded-md border border-[#e7c781] bg-[var(--ciq-warning-soft)] p-3 text-xs leading-5 text-[var(--ciq-warning)]">
            Required placeholders:{" "}
            <code className="ciq-mono rounded bg-[var(--ciq-surface)] px-1.5 py-0.5">
              {"{{DA_QUESTIONS}}, {{FA_QUESTIONS}}, {{REPORT}}"}
            </code>
            . The server validates all three before saving.
          </div>
          <label htmlFor="settings-user-prompt" className="ciq-label">
            User prompt template
          </label>
          <textarea
            id="settings-user-prompt"
            className="ciq-control mt-2 min-h-[28rem] font-[var(--ciq-font-mono)] text-xs leading-6"
            value={draft.user_prompt_template}
            onChange={(event) => onChange("user_prompt_template", event.target.value)}
          />
        </div>
      </section>
    </div>
  )
}

function SettingsSectionPanel({
  section,
  overview,
  organizationDraft,
  onOrganizationChange,
  onRoleChange,
  roleSavingId,
  currentRole,
  currentUserId,
  onRefresh,
  onMessage,
  onError,
}: {
  section: Exclude<SettingsSection, "prompts">
  overview: SettingsOverview
  organizationDraft: OrganizationSettingsInput | null
  onOrganizationChange: (patch: Partial<OrganizationSettingsInput>) => void
  onRoleChange: (membershipId: string, role: string) => Promise<void>
  roleSavingId: string | null
  currentRole: string
  currentUserId: string
  onRefresh: () => Promise<void>
  onMessage: (message: string) => void
  onError: (message: string) => void
}) {
  if (section === "users") {
    return (
      <UsersRolesPanel
        overview={overview}
        currentRole={currentRole}
        currentUserId={currentUserId}
        roleSavingId={roleSavingId}
        onRoleChange={onRoleChange}
        onRefresh={onRefresh}
        onMessage={onMessage}
        onError={onError}
      />
    )
  }

  if (section === "integrations") {
    const integrations = [
      {
        label: "AI audit provider",
        configured: overview.integrations.ai.configured,
        detail: overview.integrations.ai.modelIdentifier,
      },
      {
        label: "Supabase database & storage",
        configured: overview.integrations.storage.configured,
        detail: "Server-managed credentials",
      },
      {
        label: "Outbound email",
        configured: overview.integrations.email.configured,
        detail: "SendGrid delivery",
      },
    ]
    return (
      <section className="ciq-panel">
        <div className="ciq-panel__header">
          <div>
            <h2>Integrations</h2>
            <p>Connection readiness without exposing credentials or secret values</p>
          </div>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {integrations.map((integration) => (
            <article
              key={integration.label}
              className="rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-4"
            >
              <StatusPill
                value={integration.configured ? "verified" : "unavailable"}
                label={integration.configured ? "Configured" : "Not configured"}
                tone={integration.configured ? "verified" : "critical"}
              />
              <h3 className="mt-3 text-sm font-semibold">{integration.label}</h3>
              <p className="mt-1 text-xs text-[var(--ciq-ink-muted)]">{integration.detail}</p>
            </article>
          ))}
        </div>
      </section>
    )
  }

  if (section === "notifications") {
    if (!organizationDraft) return <PageState kind="loading" title="Loading notification policy" />
    return (
      <section className="ciq-panel">
        <div className="ciq-panel__header">
          <div>
            <h2>Notifications</h2>
            <p>Organization-wide workflow alerts; delivery credentials remain server-managed</p>
          </div>
        </div>
        <div className="divide-y divide-[var(--ciq-border)] p-4">
          <SettingToggle
            id="in-app-notifications"
            label="In-app workflow notifications"
            description="Surface assignment, completion, and review-state changes inside the product."
            checked={organizationDraft.inAppNotificationsEnabled}
            onCheckedChange={(checked) =>
              onOrganizationChange({ inAppNotificationsEnabled: checked })
            }
          />
          <SettingToggle
            id="email-notifications"
            label="Email notifications"
            description={
              overview.integrations.email.configured
                ? "Permit server-side workflow emails for this organization."
                : "Unavailable until the outbound email integration is configured."
            }
            checked={organizationDraft.emailNotificationsEnabled}
            disabled={!overview.integrations.email.configured}
            onCheckedChange={(checked) =>
              onOrganizationChange({ emailNotificationsEnabled: checked })
            }
          />
        </div>
      </section>
    )
  }

  if (section === "security") {
    const policies = [
      ["Session lifetime", `${overview.security.sessionTtlDays} days`],
      ["Session cookie", overview.security.cookieHttpOnly ? "HttpOnly" : "Review required"],
      ["SameSite policy", overview.security.sameSite],
      ["Multi-factor authentication", overview.security.mfaReady ? "Available" : "Not configured"],
      ["Single sign-on", overview.security.ssoReady ? "Available" : "Not configured"],
    ]
    return (
      <section className="ciq-panel">
        <div className="ciq-panel__header">
          <div>
            <h2>Security posture</h2>
            <p>Effective server-enforced session and identity controls</p>
          </div>
          <StatusPill value="verified" label="Credentialed tenant scope" />
        </div>
        <dl className="grid gap-3 p-4 sm:grid-cols-2">
          {policies.map(([label, value]) => (
            <div key={label} className="rounded-md border border-[var(--ciq-border)] p-4">
              <dt className="ciq-section-title">{label}</dt>
              <dd className="mt-2 text-sm font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-[var(--ciq-border)] p-4 text-xs text-[var(--ciq-ink-muted)]">
          MFA and SSO controls are shown as unavailable, not simulated. Tenant authorization uses
          organization roles and granular server-side permissions.
        </p>
      </section>
    )
  }

  if (section === "retention") {
    if (!organizationDraft) return <PageState kind="loading" title="Loading retention policy" />
    return (
      <section className="ciq-panel">
        <div className="ciq-panel__header">
          <div>
            <h2>Retention policy</h2>
            <p>Declare the organization policy without triggering irreversible deletion</p>
          </div>
          <StatusPill value="warning" label="Enforcement requires release gate" tone="warning" />
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div>
            <label className="ciq-label" htmlFor="retention-days">
              Retention window in days
            </label>
            <input
              id="retention-days"
              className="ciq-control mt-2"
              type="number"
              min={30}
              max={3650}
              value={organizationDraft.retentionDays ?? ""}
              placeholder="Indefinite"
              onChange={(event) =>
                onOrganizationChange({
                  retentionDays: event.target.value ? Number(event.target.value) : null,
                })
              }
            />
            <p className="mt-2 text-xs text-[var(--ciq-ink-muted)]">
              Leave blank for indefinite retention. Allowed range: 30–3650 days.
            </p>
          </div>
          <div>
            <label className="ciq-label" htmlFor="purge-mode">
              Enforcement mode
            </label>
            <select
              id="purge-mode"
              className="ciq-control mt-2"
              value={organizationDraft.purgeMode}
              onChange={(event) =>
                onOrganizationChange({
                  purgeMode: event.target.value as "manual" | "scheduled",
                })
              }
            >
              <option value="manual">Manual approval required</option>
              <option value="scheduled">Scheduled after release approval</option>
            </select>
            <p className="mt-2 text-xs text-[var(--ciq-ink-muted)]">
              Saving records policy only. No claim, document, audit, or evidence is deleted here.
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="ciq-panel ciq-panel--flush">
      <div className="ciq-panel__header">
        <div>
          <h2>Audit history</h2>
          <p>Immutable tenant administration changes, newest first</p>
        </div>
        <StatusPill value="verified" label={`${overview.auditHistory.length} recent events`} />
      </div>
      {overview.auditHistory.length ? (
        <div className="divide-y divide-[var(--ciq-border)]">
          {overview.auditHistory.map((event) => (
            <article key={event.id} className="flex flex-wrap items-start gap-3 p-4">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ciq-info-soft)] text-[var(--ciq-info)]">
                <FileClock className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{humanizeSetting(event.eventType)}</h3>
                <p className="mt-1 text-xs text-[var(--ciq-ink-muted)]">
                  {event.actorName} · {new Date(event.createdAt).toLocaleString()} ·{" "}
                  {humanizeSetting(event.targetType)}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="p-4 text-sm text-[var(--ciq-ink-muted)]">
          No organization administration events have been recorded yet.
        </p>
      )}
    </section>
  )
}

function SettingToggle({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-16 cursor-pointer items-center justify-between gap-4 py-3"
    >
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--ciq-ink-muted)]">
          {description}
        </span>
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </label>
  )
}

function humanizeSetting(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
