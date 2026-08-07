import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
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
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import type { PromptSettings } from "@/lib/types"
import { cn } from "@/lib/utils"

type SettingsSection =
  | "prompts"
  | "users"
  | "integrations"
  | "security"
  | "retention"
  | "history"

const sections = [
  { id: "prompts" as const, label: "Prompt Models", icon: FileCode2, available: true },
  { id: "users" as const, label: "Users & Roles", icon: Users },
  { id: "integrations" as const, label: "Integrations", icon: Link2 },
  { id: "security" as const, label: "Security", icon: ShieldCheck },
  { id: "retention" as const, label: "Retention", icon: Clock3 },
  { id: "history" as const, label: "Audit History", icon: FileClock },
]

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const initializedRef = useRef(false)
  const [section, setSection] = useState<SettingsSection>("prompts")
  const [draft, setDraft] = useState<PromptSettings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  const prompts = useQuery({ queryKey: queryKeys.prompts, queryFn: api.getPrompts })

  useEffect(() => {
    if (!prompts.data || initializedRef.current) return
    initializedRef.current = true
    setDraft(prompts.data)
  }, [prompts.data])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [dirty])

  const updatePrompt = (key: keyof PromptSettings, value: string) => {
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
    if (!draft.user_prompt_template.includes("{{REPORT}}")) {
      setError("The user prompt template must contain {{REPORT}}.")
      return
    }
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      await api.savePrompts(draft)
      setDirty(false)
      setMessage("Prompt settings saved.")
      await queryClient.invalidateQueries({ queryKey: queryKeys.prompts })
    } catch (saveError) {
      setError(apiErrorMessage(saveError, "Prompt settings could not be saved."))
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
      setMessage("Prompt settings reset to server defaults.")
      setResetOpen(false)
      await queryClient.invalidateQueries({ queryKey: queryKeys.prompts })
    } catch (resetError) {
      setError(apiErrorMessage(resetError, "Prompt settings could not be reset."))
    } finally {
      setResetting(false)
    }
  }

  if (prompts.isLoading) {
    return (
      <div className="ciq-page p-6">
        <PageState kind="loading" title="Loading tenant settings" />
      </div>
    )
  }

  if (prompts.isError) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="error"
          title="Settings are unavailable"
          description={apiErrorMessage(prompts.error)}
          actionLabel="Retry"
          onAction={() => void prompts.refetch()}
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
        description="Configure live prompt policy and review the boundaries of settings not yet exposed by backend contracts."
        meta={
          <>
            <StatusPill value="admin" label="Administrator scope" />
            {dirty && <StatusPill value="warning" label="Unsaved prompt changes" tone="warning" />}
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
                {saving ? "Saving…" : "Save prompts"}
              </Button>
            </>
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
                  {!item.available && (
                    <span className="ml-auto hidden text-[0.6rem] font-normal opacity-70 lg:inline">
                      Future
                    </span>
                  )}
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
                  title="Prompt settings returned no editable values"
                />
              )
            ) : (
              <UnavailableSettings section={section} />
            )}
          </section>
        </div>
      </PageBody>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset prompt settings?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces both editable prompt fields with the server defaults. Any unsaved edits
              will be lost.
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
  onChange: (key: keyof PromptSettings, value: string) => void
}) {
  return (
    <div className="space-y-4">
      <section className="ciq-panel p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--ciq-info-soft)] text-[var(--ciq-info)]">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Current prompt contract</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ciq-ink-muted)]">
              The backend currently exposes prompt text only. Model selection, temperature, token
              limits, provider routing, and version history are not editable through available
              endpoints.
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
            Required placeholder:{" "}
            <code className="ciq-mono rounded bg-[var(--ciq-surface)] px-1.5 py-0.5">
              {"{{REPORT}}"}
            </code>
            . The server replaces it with claim source content at runtime.
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

function UnavailableSettings({ section }: { section: Exclude<SettingsSection, "prompts"> }) {
  const content: Record<
    Exclude<SettingsSection, "prompts">,
    { title: string; description: string; available: string[]; pending: string[] }
  > = {
    users: {
      title: "Users & Roles",
      description: "User provisioning and role assignment require dedicated tenant-admin endpoints.",
      available: ["Current signed-in role is enforced by the existing admin guard."],
      pending: ["Invite users", "Change roles", "Suspend access", "Team assignment"],
    },
    integrations: {
      title: "Integrations",
      description: "Integration credentials and connection status are not exposed to this frontend.",
      available: ["Claim and email workflows use existing server-side integrations."],
      pending: ["Connection health", "Credential rotation", "Webhook configuration", "Storage destinations"],
    },
    security: {
      title: "Security",
      description: "Security policy remains server-managed until a scoped policy API is available.",
      available: ["Credentialed requests", "Server-managed session", "Admin route enforcement"],
      pending: ["Session timeout policy", "MFA policy", "IP restrictions", "Access review"],
    },
    retention: {
      title: "Retention",
      description: "Document and audit retention cannot be configured safely without backend enforcement.",
      available: ["Current server retention policy remains authoritative."],
      pending: ["Retention windows", "Legal holds", "Deletion schedules", "Archive destinations"],
    },
    history: {
      title: "Audit History",
      description: "A tenant-level audit log endpoint is not currently available.",
      available: ["Current claim and document timestamps remain visible in each workbench."],
      pending: ["Admin change history", "Prompt versions", "Sign-in events", "Exportable audit log"],
    },
  }
  const item = content[section]
  return (
    <section className="ciq-panel">
      <div className="ciq-panel__header">
        <div>
          <h2>{item.title}</h2>
          <p>Informational state · no fake controls</p>
        </div>
        <StatusPill value="unavailable" label="Backend contract pending" />
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Current boundary</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">{item.description}</p>
          <ul className="mt-4 space-y-2">
            {item.available.map((value) => (
              <li key={value} className="flex items-start gap-2 text-xs leading-5 text-[var(--ciq-ink-muted)]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ciq-verified)]" aria-hidden="true" />
                {value}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-dashed border-[var(--ciq-border-strong)] bg-[var(--ciq-surface-subtle)] p-4">
          <h3 className="text-sm font-semibold">Awaiting endpoints</h3>
          <ul className="mt-3 space-y-2">
            {item.pending.map((value) => (
              <li key={value} className="text-xs text-[var(--ciq-ink-muted)]">
                · {value}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
