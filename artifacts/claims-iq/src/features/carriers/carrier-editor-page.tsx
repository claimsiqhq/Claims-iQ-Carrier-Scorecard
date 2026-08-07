import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocation } from "wouter"
import {
  AlertTriangle,
  ArrowLeft,
  Braces,
  CheckCircle2,
  ChevronDown,
  FlaskConical,
  GitCompareArrows,
  Plus,
  Save,
  Trash2,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import type {
  CarrierCategory,
  CarrierProfile,
  CarrierQuestion,
  CarrierRuleset,
} from "@/lib/types"

function emptyRuleset(): CarrierRuleset {
  return {
    version: "1.0",
    da_questions: [],
    fa_questions: [],
    scorecard_categories: [],
  }
}

function emptyProfile(): CarrierProfile {
  return {
    carrierKey: "",
    displayName: "",
    logoUrl: null,
    active: false,
    ruleset: emptyRuleset(),
  }
}

function generateKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

interface ValidationSummary {
  errors: string[]
  warnings: string[]
}

function validateProfile(profile: CarrierProfile): ValidationSummary {
  const errors: string[] = []
  const warnings: string[] = []
  if (!profile.displayName.trim()) errors.push("Display name is required.")
  if (!profile.ruleset.da_questions.length) errors.push("Add at least one desk-adjuster question.")
  if (!profile.ruleset.fa_questions.length) errors.push("Add at least one field-adjuster question.")
  if (!profile.ruleset.scorecard_categories.length) errors.push("Add at least one scorecard category.")

  const categories = new Set(profile.ruleset.scorecard_categories.map((category) => category.id))
  const questionIds = new Set<string>()
  ;[...profile.ruleset.da_questions, ...profile.ruleset.fa_questions].forEach((question) => {
    if (!question.id.trim()) errors.push("Every question needs an ID.")
    if (!question.text.trim()) errors.push(`${question.id || "A question"} needs question text.`)
    if (!question.categoryKey.trim()) errors.push(`${question.id || "A question"} needs a category key.`)
    if (question.categoryKey && !categories.has(question.categoryKey)) {
      warnings.push(`${question.id || "A question"} references missing category “${question.categoryKey}”.`)
    }
    if (questionIds.has(question.id)) errors.push(`Question ID “${question.id}” is duplicated.`)
    questionIds.add(question.id)
  })
  profile.ruleset.scorecard_categories.forEach((category) => {
    if (!category.id.trim() || !category.label.trim()) errors.push("Every category needs an ID and label.")
  })
  if (!profile.ruleset.system_prompt_override) {
    warnings.push("System prompt uses the global default.")
  }
  if (!profile.active) warnings.push("Profile is in draft and unavailable to live intake.")
  return {
    errors: Array.from(new Set(errors)),
    warnings: Array.from(new Set(warnings)),
  }
}

export default function CarrierEditorPage({ carrierKey }: { carrierKey: string }) {
  const isNew = carrierKey === "new"
  const queryClient = useQueryClient()
  const [, setLocation] = useLocation()
  const initializedRef = useRef(false)
  const [profile, setProfile] = useState<CarrierProfile>(emptyProfile)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<"form" | "code">("form")
  const [code, setCode] = useState("")
  const [codeErrors, setCodeErrors] = useState<string[]>([])
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)

  const carrierQuery = useQuery({
    queryKey: queryKeys.carrier(carrierKey),
    queryFn: () => api.getCarrier(carrierKey),
    enabled: !isNew,
  })

  useEffect(() => {
    if (isNew || initializedRef.current || !carrierQuery.data) return
    initializedRef.current = true
    setProfile({
      ...carrierQuery.data,
      logoUrl: carrierQuery.data.logoUrl || null,
      ruleset: {
        ...emptyRuleset(),
        ...carrierQuery.data.ruleset,
        da_questions: carrierQuery.data.ruleset?.da_questions || [],
        fa_questions: carrierQuery.data.ruleset?.fa_questions || [],
        scorecard_categories: carrierQuery.data.ruleset?.scorecard_categories || [],
      },
    })
  }, [carrierQuery.data, isNew])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [dirty])

  const validation = useMemo(() => validateProfile(profile), [profile])

  const updateProfile = (patch: Partial<CarrierProfile>) => {
    setProfile((current) => ({ ...current, ...patch }))
    setDirty(true)
    setMessage(null)
    setError(null)
  }

  const updateRuleset = (updater: (ruleset: CarrierRuleset) => CarrierRuleset) => {
    setProfile((current) => ({ ...current, ruleset: updater(current.ruleset) }))
    setDirty(true)
    setMessage(null)
    setError(null)
  }

  const saveProfile = async () => {
    if (validation.errors.length) {
      setError("Resolve validation errors before saving.")
      return
    }
    const key = isNew ? generateKey(profile.displayName) : profile.carrierKey
    if (!key) {
      setError("A stable carrier key could not be generated.")
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await api.saveCarrier(key, {
        displayName: profile.displayName.trim(),
        logoUrl: profile.logoUrl || null,
        active: profile.active,
        ruleset: profile.ruleset,
      })
      setDirty(false)
      setMessage(profile.active ? "Published carrier profile saved." : "Draft carrier profile saved.")
      await queryClient.invalidateQueries({ queryKey: queryKeys.carriers })
      if (isNew) setLocation(`/carriers/${key}`, { replace: true })
    } catch (saveError) {
      setError(apiErrorMessage(saveError, "The carrier profile could not be saved."))
    } finally {
      setSaving(false)
    }
  }

  const deleteProfile = async () => {
    setDeleting(true)
    try {
      await api.deleteCarrier(profile.carrierKey)
      await queryClient.invalidateQueries({ queryKey: queryKeys.carriers })
      setLocation("/carriers")
    } catch (deleteError) {
      setError(apiErrorMessage(deleteError, "The carrier profile could not be deleted."))
      setDeleteOpen(false)
      setDeleting(false)
    }
  }

  const navigateBack = () => {
    if (dirty) setLeaveOpen(true)
    else setLocation("/carriers")
  }

  const switchMode = (next: string) => {
    const resolved = next as "form" | "code"
    if (resolved === "code" && mode !== "code") {
      setCode(JSON.stringify(profile.ruleset, null, 2))
      setCodeErrors([])
    }
    setMode(resolved)
  }

  const applyCode = () => {
    const parsed = parseRuleset(code)
    if (parsed.errors.length) {
      setCodeErrors(parsed.errors)
      return
    }
    updateRuleset(() => parsed.ruleset)
    setCodeErrors([])
    setMessage("Code parsed into the form. Save to persist it.")
  }

  if (!isNew && carrierQuery.isLoading) {
    return (
      <div className="ciq-page p-6">
        <PageState kind="loading" title="Loading carrier profile" />
      </div>
    )
  }

  if (!isNew && carrierQuery.isError) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="error"
          title="Carrier profile unavailable"
          description={apiErrorMessage(carrierQuery.error)}
          actionLabel="Return to carriers"
          onAction={() => setLocation("/carriers")}
        />
      </div>
    )
  }

  const daWeight = profile.ruleset.da_questions.reduce((sum, question) => sum + question.weight, 0)
  const faWeight = profile.ruleset.fa_questions.reduce((sum, question) => sum + question.weight, 0)

  return (
    <div className="ciq-page">
      <PageHeader
        compact
        eyebrow={isNew ? "New carrier draft" : `Carrier profile · ${profile.carrierKey}`}
        title={profile.displayName || "Untitled carrier"}
        description="Validate the ruleset, review prompt policy, and explicitly choose draft or published availability."
        meta={
          <>
            <StatusPill
              value={profile.active ? "published" : "draft"}
              label={profile.active ? "Published" : "Draft"}
            />
            <StatusPill
              value={validation.errors.length ? "critical" : "verified"}
              label={
                validation.errors.length
                  ? `${validation.errors.length} validation error${validation.errors.length === 1 ? "" : "s"}`
                  : "Validation passed"
              }
            />
            {dirty && <StatusPill value="warning" label="Unsaved changes" tone="warning" />}
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              className="border-white/20 bg-transparent text-white hover:bg-white/10"
              onClick={navigateBack}
            >
              <ArrowLeft aria-hidden="true" />
              Carriers
            </Button>
            {!isNew && (
              <Button
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            )}
            <Button
              className="border-white/15 bg-white text-[var(--ciq-aubergine)] hover:bg-[#f7f3ed]"
              onClick={() => void saveProfile()}
              disabled={!dirty || saving || Boolean(validation.errors.length)}
            >
              <Save aria-hidden="true" />
              {saving ? "Saving…" : profile.active ? "Save published" : "Save draft"}
            </Button>
          </>
        }
      />

      <PageBody className="!max-w-[92rem]">
        {(error || message) && (
          <div
            className={`mb-4 flex items-start gap-2 rounded-md border p-3 text-sm ${
              error
                ? "border-[#e5b3b3] bg-[var(--ciq-critical-soft)] text-[var(--ciq-critical)]"
                : "border-[#aedbd5] bg-[var(--ciq-verified-soft)] text-[var(--ciq-verified-strong)]"
            }`}
            role={error ? "alert" : "status"}
          >
            {error ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            {error || message}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <section className="min-w-0 space-y-4">
            <section className="ciq-panel p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <EditorField label="Display name" htmlFor="carrier-display-name">
                  <input
                    id="carrier-display-name"
                    className="ciq-control"
                    value={profile.displayName}
                    onChange={(event) => updateProfile({ displayName: event.target.value })}
                    placeholder="e.g. Allstate"
                  />
                </EditorField>
                <EditorField label="Logo URL" htmlFor="carrier-logo-url" hint="Optional; a lettermark is used when blank.">
                  <input
                    id="carrier-logo-url"
                    className="ciq-control"
                    type="url"
                    value={profile.logoUrl || ""}
                    onChange={(event) => updateProfile({ logoUrl: event.target.value || null })}
                    placeholder="https://…"
                  />
                </EditorField>
              </div>
              <div className="mt-4 flex items-center justify-between gap-4 rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-4">
                <div>
                  <label htmlFor="carrier-published" className="text-sm font-semibold">
                    Publish to live audit workflow
                  </label>
                  <p className="mt-1 text-xs leading-5 text-[var(--ciq-ink-muted)]">
                    Off saves a draft. On makes this profile selectable for intake and reprocessing.
                  </p>
                </div>
                <Switch
                  id="carrier-published"
                  checked={profile.active}
                  onCheckedChange={(active) => updateProfile({ active })}
                />
              </div>
            </section>

            <Tabs value={mode} onValueChange={switchMode}>
              <TabsList className="grid h-auto w-full grid-cols-2 border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-1">
                <TabsTrigger value="form">
                  <ChevronDown aria-hidden="true" />
                  Structured form
                </TabsTrigger>
                <TabsTrigger value="code">
                  <Braces aria-hidden="true" />
                  Ruleset code
                </TabsTrigger>
              </TabsList>

              <TabsContent value="form" className="mt-4 space-y-4">
                <EditorSection
                  title="Prompt policy"
                  description="Carrier overrides; blank fields inherit current global settings."
                >
                  <div className="grid gap-4">
                    <EditorField label="System prompt override" htmlFor="carrier-system-prompt">
                      <textarea
                        id="carrier-system-prompt"
                        className="ciq-control font-[var(--ciq-font-mono)] text-xs leading-6"
                        value={profile.ruleset.system_prompt_override || ""}
                        onChange={(event) =>
                          updateRuleset((ruleset) => ({
                            ...ruleset,
                            system_prompt_override: event.target.value || undefined,
                          }))
                        }
                        placeholder="Inherit global system prompt"
                      />
                    </EditorField>
                    <EditorField label="Scorecard prompt override" htmlFor="carrier-scorecard-prompt">
                      <textarea
                        id="carrier-scorecard-prompt"
                        className="ciq-control font-[var(--ciq-font-mono)] text-xs leading-6"
                        value={profile.ruleset.carrier_scorecard_prompt_override || ""}
                        onChange={(event) =>
                          updateRuleset((ruleset) => ({
                            ...ruleset,
                            carrier_scorecard_prompt_override: event.target.value || undefined,
                          }))
                        }
                        placeholder="Inherit default scorecard prompt"
                      />
                    </EditorField>
                  </div>
                </EditorSection>

                <EditorSection
                  title="Scorecard categories"
                  description={`${profile.ruleset.scorecard_categories.length} categories define the question groupings.`}
                >
                  <CategoryEditor
                    categories={profile.ruleset.scorecard_categories}
                    onChange={(categories) =>
                      updateRuleset((ruleset) => ({
                        ...ruleset,
                        scorecard_categories: categories,
                      }))
                    }
                  />
                </EditorSection>

                <EditorSection
                  title="Desk-adjuster questions"
                  description={`${profile.ruleset.da_questions.length} questions · ${daWeight} configured points`}
                >
                  <QuestionEditor
                    scorecard="DA"
                    questions={profile.ruleset.da_questions}
                    categories={profile.ruleset.scorecard_categories}
                    onChange={(questions) =>
                      updateRuleset((ruleset) => ({ ...ruleset, da_questions: questions }))
                    }
                  />
                </EditorSection>

                <EditorSection
                  title="Field-adjuster questions"
                  description={`${profile.ruleset.fa_questions.length} questions · ${faWeight} configured points`}
                >
                  <QuestionEditor
                    scorecard="FA"
                    questions={profile.ruleset.fa_questions}
                    categories={profile.ruleset.scorecard_categories}
                    onChange={(questions) =>
                      updateRuleset((ruleset) => ({ ...ruleset, fa_questions: questions }))
                    }
                  />
                </EditorSection>
              </TabsContent>

              <TabsContent value="code" className="mt-4">
                <section className="ciq-panel">
                  <div className="ciq-panel__header">
                    <div>
                      <h2>Ruleset source</h2>
                      <p>Accepts JSON or a simple TypeScript/JavaScript object literal</p>
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    {codeErrors.length > 0 && (
                      <div className="rounded-md bg-[var(--ciq-critical-soft)] p-3" role="alert">
                        <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--ciq-critical)]">
                          {codeErrors.map((codeError) => (
                            <li key={codeError}>{codeError}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <textarea
                      className="ciq-control min-h-[34rem] font-[var(--ciq-font-mono)] text-xs leading-6"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      spellCheck={false}
                      aria-label="Carrier ruleset JSON or object literal"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={applyCode}>
                        <Braces aria-hidden="true" />
                        Parse and apply
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setCode(JSON.stringify(profile.ruleset, null, 2))
                          setCodeErrors([])
                        }}
                      >
                        Reset from form
                      </Button>
                    </div>
                  </div>
                </section>
              </TabsContent>
            </Tabs>
          </section>

          <aside className="space-y-4 xl:sticky xl:top-0 xl:self-start">
            <ValidationPanel validation={validation} />
            <PlaceholderPanel
              icon={<GitCompareArrows />}
              title="Version diff"
              description="A compare endpoint is not available. Save history and published-vs-draft diffs are not simulated."
            />
            <PlaceholderPanel
              icon={<FlaskConical />}
              title="Ruleset test console"
              description="A dry-run audit endpoint is not available. No synthetic claim results are generated."
            />
          </aside>
        </div>
      </PageBody>

      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved carrier changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current edits have not been saved to the carrier profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--ciq-critical)] text-white"
              onClick={() => {
                setDirty(false)
                setLocation("/carriers")
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {profile.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the carrier profile and its ruleset. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep carrier</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--ciq-critical)] text-white"
              onClick={(event) => {
                event.preventDefault()
                void deleteProfile()
              }}
              disabled={deleting}
            >
              <Trash2 aria-hidden="true" />
              {deleting ? "Deleting…" : "Delete carrier"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EditorField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="ciq-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="text-xs text-[var(--ciq-ink-muted)]">{hint}</span>}
    </div>
  )
}

function EditorSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <details className="ciq-panel ciq-panel--flush group" open>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 border-b border-[var(--ciq-border)] px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span>
          <strong className="ciq-section-title block">{title}</strong>
          <span className="mt-1 block text-xs text-[var(--ciq-ink-muted)]">{description}</span>
        </span>
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="p-4">{children}</div>
    </details>
  )
}

function CategoryEditor({
  categories,
  onChange,
}: {
  categories: CarrierCategory[]
  onChange: (categories: CarrierCategory[]) => void
}) {
  const update = (index: number, patch: Partial<CarrierCategory>) =>
    onChange(categories.map((category, itemIndex) => (itemIndex === index ? { ...category, ...patch } : category)))
  return (
    <div className="space-y-2">
      {categories.map((category, index) => (
        <div
          key={`${category.id}-${index}`}
          className="grid gap-2 rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-3 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(10rem,1fr)_6rem_2.75rem]"
        >
          <input
            className="ciq-control ciq-mono"
            value={category.id}
            onChange={(event) => update(index, { id: event.target.value })}
            aria-label={`Category ${index + 1} ID`}
            placeholder="category_id"
          />
          <input
            className="ciq-control"
            value={category.label}
            onChange={(event) => update(index, { label: event.target.value })}
            aria-label={`Category ${index + 1} label`}
            placeholder="Category label"
          />
          <input
            type="number"
            className="ciq-control ciq-mono"
            value={category.max_score}
            min={1}
            onChange={(event) => update(index, { max_score: Number(event.target.value) || 1 })}
            aria-label={`Category ${index + 1} maximum score`}
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-[var(--ciq-critical)]"
            onClick={() => onChange(categories.filter((_, itemIndex) => itemIndex !== index))}
            aria-label={`Remove category ${category.label || index + 1}`}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        className="w-full border-dashed"
        onClick={() =>
          onChange([
            ...categories,
            { id: `category_${Date.now()}`, label: "", max_score: 5 },
          ])
        }
      >
        <Plus aria-hidden="true" />
        Add category
      </Button>
    </div>
  )
}

function QuestionEditor({
  questions,
  scorecard,
  categories,
  onChange,
}: {
  questions: CarrierQuestion[]
  scorecard: "DA" | "FA"
  categories: CarrierCategory[]
  onChange: (questions: CarrierQuestion[]) => void
}) {
  const update = (index: number, patch: Partial<CarrierQuestion>) =>
    onChange(questions.map((question, itemIndex) => (itemIndex === index ? { ...question, ...patch } : question)))
  return (
    <div className="space-y-3">
      {questions.map((question, index) => (
        <article
          key={`${question.id}-${index}`}
          className="rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-3"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="ciq-status">{scorecard} · {String(index + 1).padStart(2, "0")}</span>
            <Button
              variant="ghost"
              size="icon"
              className="text-[var(--ciq-critical)]"
              onClick={() => onChange(questions.filter((_, itemIndex) => itemIndex !== index))}
              aria-label={`Remove question ${question.id || index + 1}`}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <EditorField label="Question ID" htmlFor={`${scorecard}-${index}-id`}>
              <input
                id={`${scorecard}-${index}-id`}
                className="ciq-control ciq-mono"
                value={question.id}
                onChange={(event) => update(index, { id: event.target.value })}
              />
            </EditorField>
            <EditorField label="Category" htmlFor={`${scorecard}-${index}-category`}>
              <select
                id={`${scorecard}-${index}-category`}
                className="ciq-control"
                value={question.categoryKey}
                onChange={(event) => {
                  const selected = categories.find((category) => category.id === event.target.value)
                  update(index, {
                    categoryKey: event.target.value,
                    categoryName: selected?.label || "",
                  })
                }}
              >
                <option value="">Select category…</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label || category.id}
                  </option>
                ))}
              </select>
            </EditorField>
            <div className="md:col-span-2">
              <EditorField label="Question text" htmlFor={`${scorecard}-${index}-text`}>
                <textarea
                  id={`${scorecard}-${index}-text`}
                  className="ciq-control min-h-24"
                  value={question.text}
                  onChange={(event) => update(index, { text: event.target.value })}
                />
              </EditorField>
            </div>
            <EditorField label="Weight" htmlFor={`${scorecard}-${index}-weight`}>
              <input
                id={`${scorecard}-${index}-weight`}
                type="number"
                className="ciq-control ciq-mono"
                value={question.weight}
                min={0}
                onChange={(event) => update(index, { weight: Number(event.target.value) || 0 })}
              />
            </EditorField>
            <EditorField label="Weight if no denial" htmlFor={`${scorecard}-${index}-no-denial`}>
              <input
                id={`${scorecard}-${index}-no-denial`}
                type="number"
                className="ciq-control ciq-mono"
                value={question.weightIfNoDenial ?? ""}
                min={0}
                onChange={(event) =>
                  update(index, {
                    weightIfNoDenial:
                      event.target.value === "" ? undefined : Number(event.target.value) || 0,
                  })
                }
              />
            </EditorField>
          </div>
        </article>
      ))}
      <Button
        variant="outline"
        className="w-full border-dashed"
        onClick={() =>
          onChange([
            ...questions,
            {
              id: `${scorecard.toLowerCase()}_question_${Date.now()}`,
              text: "",
              weight: 5,
              section: scorecard.toLowerCase(),
              scorecard,
              categoryKey: "",
              categoryName: "",
            },
          ])
        }
      >
        <Plus aria-hidden="true" />
        Add {scorecard} question
      </Button>
    </div>
  )
}

function ValidationPanel({ validation }: { validation: ValidationSummary }) {
  return (
    <section className="ciq-panel ciq-panel--flush">
      <div className="ciq-panel__header">
        <div>
          <h2>Validation summary</h2>
          <p>Client-side preflight</p>
        </div>
        <StatusPill
          value={validation.errors.length ? "critical" : "verified"}
          label={validation.errors.length ? `${validation.errors.length} errors` : "Valid"}
        />
      </div>
      <div className="space-y-4 p-4">
        {validation.errors.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-[var(--ciq-critical)]">Must resolve</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--ciq-ink-muted)]">
              {validation.errors.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}
        {validation.warnings.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-[var(--ciq-warning)]">Review</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--ciq-ink-muted)]">
              {validation.warnings.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}
        {!validation.errors.length && !validation.warnings.length && (
          <p className="text-xs leading-5 text-[var(--ciq-ink-muted)]">No validation issues detected.</p>
        )}
      </div>
    </section>
  )
}

function PlaceholderPanel({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <section className="ciq-panel border-dashed p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--ciq-info-soft)] text-[var(--ciq-info)] [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <h2 className="mt-3 text-sm font-semibold">{title}</h2>
      <StatusPill value="unavailable" label="Endpoint unavailable" className="mt-2" />
      <p className="mt-3 text-xs leading-5 text-[var(--ciq-ink-muted)]">{description}</p>
    </section>
  )
}

function parseRuleset(source: string): { ruleset: CarrierRuleset; errors: string[] } {
  if (!source.trim()) return { ruleset: emptyRuleset(), errors: ["Ruleset source is empty."] }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    try {
      let normalized = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/^export\s+default\s+/m, "")
        .replace(/^export\s+(const|let|var)\s+\w+\s*(?::[^=]+)?=\s*/m, "")
        .replace(/^(const|let|var)\s+\w+\s*(?::[^=]+)?=\s*/m, "")
        .replace(/\bas\s+const\b/g, "")
        .replace(/`([^`]*)`/g, (_, content: string) => JSON.stringify(content))
        .replace(/:\s*'([^']*?)'/g, ': "$1"')
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/;\s*$/, "")
      parsed = JSON.parse(normalized)
    } catch (error) {
      return {
        ruleset: emptyRuleset(),
        errors: [
          `Unable to parse ruleset: ${error instanceof Error ? error.message : "invalid syntax"}.`,
        ],
      }
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ruleset: emptyRuleset(), errors: ["Ruleset must be an object."] }
  }
  const value = parsed as Record<string, unknown>
  const ruleset: CarrierRuleset = {
    version: typeof value.version === "string" ? value.version : "1.0",
    da_questions: Array.isArray(value.da_questions)
      ? (value.da_questions as CarrierQuestion[])
      : [],
    fa_questions: Array.isArray(value.fa_questions)
      ? (value.fa_questions as CarrierQuestion[])
      : [],
    scorecard_categories: Array.isArray(value.scorecard_categories)
      ? (value.scorecard_categories as CarrierCategory[])
      : [],
    system_prompt_override:
      typeof value.system_prompt_override === "string"
        ? value.system_prompt_override
        : undefined,
    carrier_scorecard_prompt_override:
      typeof value.carrier_scorecard_prompt_override === "string"
        ? value.carrier_scorecard_prompt_override
        : undefined,
  }
  return { ruleset, errors: [] }
}
