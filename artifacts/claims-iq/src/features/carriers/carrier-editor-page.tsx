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
  History,
  Play,
  Plus,
  RotateCcw,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import type {
  CarrierCategory,
  CarrierPreflightResult,
  CarrierProfile,
  CarrierQuestion,
  CarrierRuleset,
  CarrierRulesetVersion,
  CarrierSourceReference,
  ClaimSummary,
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
    sourceReferences: [],
    changeSummary: "",
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
  if (!profile.changeSummary?.trim()) errors.push("Add a change summary for this version.")

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
  const allQuestions = [...profile.ruleset.da_questions, ...profile.ruleset.fa_questions]
  const missingApplicability = allQuestions.filter((question) => !question.applicability?.trim()).length
  const missingSeverity = allQuestions.filter((question) => !question.severity).length
  const missingSources = allQuestions.filter((question) => !question.sourceReference?.trim()).length
  if (missingApplicability) warnings.push(`${missingApplicability} questions do not define applicability guidance.`)
  if (missingSeverity) warnings.push(`${missingSeverity} questions do not define failure severity.`)
  if (missingSources) warnings.push(`${missingSources} questions do not include a source reference.`)
  profile.ruleset.scorecard_categories.forEach((category) => {
    if (!category.id.trim() || !category.label.trim()) errors.push("Every category needs an ID and label.")
  })
  if (!profile.ruleset.system_prompt_override) {
    warnings.push("System prompt uses the global default.")
  }
  if (!profile.active) warnings.push("Profile is in draft and unavailable to live intake.")
  if (!profile.sourceReferences?.length) warnings.push("No carrier policy source references are attached.")
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
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<CarrierRulesetVersion | null>(null)
  const [rollingBack, setRollingBack] = useState(false)
  const [selectedClaimId, setSelectedClaimId] = useState("")
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<CarrierPreflightResult | null>(null)

  const carrierQuery = useQuery({
    queryKey: queryKeys.carrier(carrierKey),
    queryFn: () => api.getCarrier(carrierKey),
    enabled: !isNew,
  })
  const versionsQuery = useQuery({
    queryKey: queryKeys.carrierVersions(carrierKey),
    queryFn: () => api.getCarrierVersions(carrierKey),
    enabled: !isNew,
  })
  const claimsQuery = useQuery({
    queryKey: [...queryKeys.claims, "carrier-test"],
    queryFn: () => api.getClaims(100, 0),
  })

  useEffect(() => {
    if (isNew || initializedRef.current || !carrierQuery.data) return
    initializedRef.current = true
    setProfile({
      ...carrierQuery.data,
      logoUrl: carrierQuery.data.logoUrl || null,
      sourceReferences: carrierQuery.data.sourceReferences || [],
      changeSummary: carrierQuery.data.changeSummary || "",
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
        active: false,
        ruleset: profile.ruleset,
        sourceReferences: profile.sourceReferences || [],
        changeSummary: profile.changeSummary || "",
      })
      setProfile((current) => ({ ...current, active: false }))
      setDirty(false)
      setMessage("Draft carrier version saved. Publish it explicitly after review.")
      await queryClient.invalidateQueries({ queryKey: queryKeys.carriers })
      await queryClient.invalidateQueries({ queryKey: queryKeys.carrierVersions(key) })
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
      setError(apiErrorMessage(deleteError, "The carrier profile could not be deactivated."))
      setDeleteOpen(false)
      setDeleting(false)
    }
  }

  const publishVersion = async (versionId: string) => {
    setPublishingId(versionId)
    setMessage(null)
    setError(null)
    try {
      const result = await api.publishCarrierVersion(profile.carrierKey, versionId)
      setProfile((current) => ({
        ...current,
        active: true,
        ruleset: result.version.ruleset,
        displayName: result.version.displayName,
        logoUrl: result.version.logoUrl,
        sourceReferences: result.version.sourceReferences,
        changeSummary: result.version.changeSummary,
      }))
      setMessage(`Version ${result.version.versionNumber} published after explicit approval.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.carriers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.carrier(profile.carrierKey) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.carrierVersions(profile.carrierKey) }),
      ])
    } catch (publishError) {
      setError(apiErrorMessage(publishError, "The carrier version could not be published."))
    } finally {
      setPublishingId(null)
    }
  }

  const rollbackVersion = async () => {
    if (!rollbackTarget) return
    setRollingBack(true)
    setMessage(null)
    setError(null)
    try {
      const result = await api.rollbackCarrierVersion(profile.carrierKey, rollbackTarget.id)
      setProfile((current) => ({
        ...current,
        active: true,
        ruleset: result.version.ruleset,
        displayName: result.version.displayName,
        logoUrl: result.version.logoUrl,
        sourceReferences: result.version.sourceReferences,
        changeSummary: result.version.changeSummary,
      }))
      setDirty(false)
      setMessage(
        `Restored historical version ${rollbackTarget.versionNumber} as new published version ${result.version.versionNumber}.`,
      )
      setRollbackTarget(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.carriers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.carrier(profile.carrierKey) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.carrierVersions(profile.carrierKey) }),
      ])
    } catch (rollbackError) {
      setError(apiErrorMessage(rollbackError, "The historical version could not be restored."))
    } finally {
      setRollingBack(false)
    }
  }

  const runRepresentativeTest = async (versionId?: string) => {
    if (!selectedClaimId) {
      setError("Select a representative claim first.")
      return
    }
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      setTestResult(
        await api.testCarrierVersion(profile.carrierKey, selectedClaimId, versionId),
      )
    } catch (testError) {
      setError(apiErrorMessage(testError, "The representative-claim preflight could not run."))
    } finally {
      setTesting(false)
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
  const versions = versionsQuery.data?.versions || []
  const draftVersion = versions.find((version) => version.status === "draft")
  const publishedVersion = versions.find((version) => version.status === "published")
  const versionDiff = compareRulesets(profile.ruleset, publishedVersion?.ruleset)
  const testVersion = draftVersion || publishedVersion

  return (
    <div className="ciq-page">
      <PageHeader
        compact
        eyebrow={isNew ? "New carrier draft" : `Carrier profile · ${profile.carrierKey}`}
        title={profile.displayName || "Untitled carrier"}
        description="Author a validated draft, inspect policy impact, test representative claim coverage, and publish through an explicit approval step."
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
            {testVersion && (
              <StatusPill
                value={testVersion.status}
                label={`Version ${testVersion.versionNumber} · ${testVersion.versionLabel}`}
              />
            )}
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
                Deactivate
              </Button>
            )}
            {draftVersion && !dirty && (
              <Button
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                onClick={() => void publishVersion(draftVersion.id)}
                disabled={Boolean(publishingId) || Boolean(validation.errors.length)}
              >
                <CheckCircle2 aria-hidden="true" />
                {publishingId === draftVersion.id ? "Publishing…" : "Approve & publish"}
              </Button>
            )}
            <Button
              className="border-white/15 bg-white text-[var(--ciq-aubergine)] hover:bg-[#f7f3ed]"
              onClick={() => void saveProfile()}
              disabled={!dirty || saving || Boolean(validation.errors.length)}
            >
              <Save aria-hidden="true" />
              {saving ? "Saving…" : "Save new draft"}
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
              <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
                <EditorField
                  label="Change summary"
                  htmlFor="carrier-change-summary"
                  hint="Required reviewer context for this new immutable version."
                >
                  <textarea
                    id="carrier-change-summary"
                    className="ciq-control min-h-24"
                    value={profile.changeSummary || ""}
                    onChange={(event) => updateProfile({ changeSummary: event.target.value })}
                    placeholder="Explain why this ruleset is changing and the expected review impact."
                  />
                </EditorField>
                <div className="rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-4">
                  <span className="ciq-section-title">Publication gate</span>
                  <p className="mt-2 text-xs leading-5 text-[var(--ciq-ink-muted)]">
                    Saving always creates a draft. A validated saved draft must be approved
                    separately before it becomes the live ruleset.
                  </p>
                </div>
              </div>
              <div className="mt-4 border-t border-[var(--ciq-border)] pt-4">
                <h2 className="text-sm font-semibold">Carrier policy sources</h2>
                <p className="mt-1 text-xs text-[var(--ciq-ink-muted)]">
                  Attach minimum-necessary policy references used to govern applicability and scoring.
                </p>
                <SourceReferenceEditor
                  references={profile.sourceReferences || []}
                  onChange={(sourceReferences) => updateProfile({ sourceReferences })}
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
            <VersionDiffPanel
              diff={versionDiff}
              affectedClaimCount={versionsQuery.data?.affectedClaimCount ?? 0}
            />
            <RulesetTestPanel
              claims={claimsQuery.data || []}
              selectedClaimId={selectedClaimId}
              onClaimChange={setSelectedClaimId}
              onRun={() => void runRepresentativeTest(testVersion?.id)}
              testing={testing}
              result={testResult}
              disabled={!testVersion || dirty}
            />
            <VersionHistoryPanel
              versions={versions}
              publishingId={publishingId}
              onPublish={(versionId) => void publishVersion(versionId)}
              onRollback={setRollbackTarget}
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
            <AlertDialogTitle>Deactivate {profile.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the carrier from new intake while preserving immutable publication
              history and existing audit provenance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep active</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--ciq-critical)] text-white"
              onClick={(event) => {
                event.preventDefault()
                void deleteProfile()
              }}
              disabled={deleting}
            >
              <Trash2 aria-hidden="true" />
              {deleting ? "Deactivating…" : "Deactivate carrier"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(rollbackTarget)}
        onOpenChange={(open) => {
          if (!open && !rollingBack) setRollbackTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore version {rollbackTarget?.versionNumber}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The current publication remains immutable and will be archived. A new published
              version is created from this historical policy so the complete lineage is retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollingBack}>Keep current version</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void rollbackVersion()
              }}
              disabled={rollingBack}
            >
              <RotateCcw aria-hidden="true" />
              {rollingBack ? "Restoring…" : "Create rollback publication"}
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
            <EditorField label="Failure severity" htmlFor={`${scorecard}-${index}-severity`}>
              <select
                id={`${scorecard}-${index}-severity`}
                className="ciq-control"
                value={question.severity || ""}
                onChange={(event) =>
                  update(index, {
                    severity:
                      (event.target.value as CarrierQuestion["severity"]) || undefined,
                  })
                }
              >
                <option value="">Select severity…</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="info">Informational</option>
              </select>
            </EditorField>
            <EditorField label="Policy source reference" htmlFor={`${scorecard}-${index}-source`}>
              <input
                id={`${scorecard}-${index}-source`}
                className="ciq-control"
                value={question.sourceReference || ""}
                onChange={(event) =>
                  update(index, { sourceReference: event.target.value || undefined })
                }
                placeholder="Policy §4.2 or source title"
              />
            </EditorField>
            <div className="md:col-span-2">
              <EditorField
                label="Applicability guidance"
                htmlFor={`${scorecard}-${index}-applicability`}
              >
                <textarea
                  id={`${scorecard}-${index}-applicability`}
                  className="ciq-control min-h-20"
                  value={question.applicability || ""}
                  onChange={(event) =>
                    update(index, { applicability: event.target.value || undefined })
                  }
                  placeholder="Describe when this question applies and when NOT_APPLICABLE is valid."
                />
              </EditorField>
            </div>
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

function SourceReferenceEditor({
  references,
  onChange,
}: {
  references: CarrierSourceReference[]
  onChange: (references: CarrierSourceReference[]) => void
}) {
  const update = (index: number, patch: Partial<CarrierSourceReference>) =>
    onChange(
      references.map((reference, itemIndex) =>
        itemIndex === index ? { ...reference, ...patch } : reference,
      ),
    )
  return (
    <div className="mt-3 space-y-2">
      {references.map((reference, index) => (
        <div
          key={`${reference.label}-${index}`}
          className="grid gap-2 rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-3 md:grid-cols-[1fr_1fr_1fr_2.75rem]"
        >
          <input
            className="ciq-control"
            value={reference.label}
            onChange={(event) => update(index, { label: event.target.value })}
            aria-label={`Source ${index + 1} label`}
            placeholder="Policy title"
          />
          <input
            className="ciq-control"
            value={reference.reference || ""}
            onChange={(event) => update(index, { reference: event.target.value || undefined })}
            aria-label={`Source ${index + 1} reference`}
            placeholder="Section, edition, or date"
          />
          <input
            className="ciq-control"
            type="url"
            value={reference.url || ""}
            onChange={(event) => update(index, { url: event.target.value || undefined })}
            aria-label={`Source ${index + 1} URL`}
            placeholder="Optional source URL"
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-[var(--ciq-critical)]"
            aria-label={`Remove source ${reference.label || index + 1}`}
            onClick={() => onChange(references.filter((_, itemIndex) => itemIndex !== index))}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        className="w-full border-dashed"
        onClick={() => onChange([...references, { label: "" }])}
      >
        <Plus aria-hidden="true" />
        Add policy source
      </Button>
    </div>
  )
}

interface RulesetDiff {
  added: number
  removed: number
  changed: number
  categoryDelta: number
  pointsDelta: number
  baselineAvailable: boolean
}

function compareRulesets(current: CarrierRuleset, published?: CarrierRuleset): RulesetDiff {
  const currentQuestions = [...current.da_questions, ...current.fa_questions]
  if (!published) {
    return {
      added: currentQuestions.length,
      removed: 0,
      changed: 0,
      categoryDelta: current.scorecard_categories.length,
      pointsDelta: currentQuestions.reduce((sum, question) => sum + question.weight, 0),
      baselineAvailable: false,
    }
  }
  const publishedQuestions = [...published.da_questions, ...published.fa_questions]
  const previous = new Map(publishedQuestions.map((question) => [question.id, question]))
  const currentMap = new Map(currentQuestions.map((question) => [question.id, question]))
  const added = currentQuestions.filter((question) => !previous.has(question.id)).length
  const removed = publishedQuestions.filter((question) => !currentMap.has(question.id)).length
  const changed = currentQuestions.filter((question) => {
    const prior = previous.get(question.id)
    return prior
      ? JSON.stringify(prior) !== JSON.stringify(question)
      : false
  }).length
  const currentPoints = currentQuestions.reduce((sum, question) => sum + question.weight, 0)
  const publishedPoints = publishedQuestions.reduce((sum, question) => sum + question.weight, 0)
  return {
    added,
    removed,
    changed,
    categoryDelta:
      current.scorecard_categories.length - published.scorecard_categories.length,
    pointsDelta: currentPoints - publishedPoints,
    baselineAvailable: true,
  }
}

function VersionDiffPanel({
  diff,
  affectedClaimCount,
}: {
  diff: RulesetDiff
  affectedClaimCount: number
}) {
  return (
    <section className="ciq-panel ciq-panel--flush">
      <div className="ciq-panel__header">
        <div>
          <h2>Version impact</h2>
          <p>{diff.baselineAvailable ? "Draft vs live publication" : "No published baseline"}</p>
        </div>
        <GitCompareArrows className="h-4 w-4 text-[var(--ciq-aubergine)]" aria-hidden="true" />
      </div>
      <dl className="grid grid-cols-2 gap-px bg-[var(--ciq-border)]">
        {[
          ["Questions added", diff.added],
          ["Questions removed", diff.removed],
          ["Questions changed", diff.changed],
          ["Point delta", diff.pointsDelta > 0 ? `+${diff.pointsDelta}` : diff.pointsDelta],
          ["Category delta", diff.categoryDelta > 0 ? `+${diff.categoryDelta}` : diff.categoryDelta],
          ["Claims in scope", affectedClaimCount],
        ].map(([label, value]) => (
          <div key={label} className="bg-[var(--ciq-surface)] p-3">
            <dt className="text-[0.65rem] font-bold uppercase tracking-wide text-[var(--ciq-ink-muted)]">
              {label}
            </dt>
            <dd className="ciq-mono mt-1 text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function RulesetTestPanel({
  claims,
  selectedClaimId,
  onClaimChange,
  onRun,
  testing,
  result,
  disabled,
}: {
  claims: ClaimSummary[]
  selectedClaimId: string
  onClaimChange: (value: string) => void
  onRun: () => void
  testing: boolean
  result: CarrierPreflightResult | null
  disabled: boolean
}) {
  return (
    <section className="ciq-panel">
      <div className="ciq-panel__header">
        <div>
          <h2>Representative claim test</h2>
          <p>Deterministic, zero-provider-cost preflight</p>
        </div>
        <FlaskConical className="h-4 w-4 text-[var(--ciq-info)]" aria-hidden="true" />
      </div>
      <div className="space-y-3 p-4">
        <label className="ciq-label" htmlFor="carrier-test-claim">
          Representative claim
        </label>
        <select
          id="carrier-test-claim"
          className="ciq-control"
          value={selectedClaimId}
          onChange={(event) => onClaimChange(event.target.value)}
        >
          <option value="">Select claim…</option>
          {claims.map((claim) => (
            <option key={claim.id} value={claim.id}>
              {claim.claimNumber} · {claim.carrier || "Carrier unknown"}
            </option>
          ))}
        </select>
        <Button className="w-full" onClick={onRun} disabled={disabled || testing || !selectedClaimId}>
          <Play aria-hidden="true" />
          {testing ? "Running preflight…" : "Run compatibility preflight"}
        </Button>
        {disabled && (
          <p className="text-xs text-[var(--ciq-ink-muted)]">
            Save the current draft before testing its persisted version.
          </p>
        )}
        {result && (
          <div className="rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-3">
            <StatusPill
              value={result.compatible ? "verified" : "critical"}
              label={result.compatible ? "Preflight compatible" : "Preflight failed"}
              tone={result.compatible ? "verified" : "critical"}
            />
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-[var(--ciq-ink-muted)]">Questions</dt>
                <dd className="ciq-mono font-semibold">
                  {result.coverage.deskAdjusterQuestions + result.coverage.fieldAdjusterQuestions}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--ciq-ink-muted)]">Configured points</dt>
                <dd className="ciq-mono font-semibold">{result.coverage.configuredPoints}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-5 text-[var(--ciq-ink-muted)]">{result.note}</p>
          </div>
        )}
      </div>
    </section>
  )
}

function VersionHistoryPanel({
  versions,
  publishingId,
  onPublish,
  onRollback,
}: {
  versions: CarrierRulesetVersion[]
  publishingId: string | null
  onPublish: (versionId: string) => void
  onRollback: (version: CarrierRulesetVersion) => void
}) {
  return (
    <section className="ciq-panel ciq-panel--flush">
      <div className="ciq-panel__header">
        <div>
          <h2>Publication history</h2>
          <p>Immutable versions and approval actions</p>
        </div>
        <History className="h-4 w-4 text-[var(--ciq-aubergine)]" aria-hidden="true" />
      </div>
      {versions.length ? (
        <div className="max-h-80 divide-y divide-[var(--ciq-border)] overflow-y-auto">
          {versions.map((version) => (
            <article key={version.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <strong className="ciq-mono text-xs">
                    v{version.versionNumber} · {version.versionLabel}
                  </strong>
                  <p className="mt-1 text-[0.68rem] text-[var(--ciq-ink-muted)]">
                    {new Date(version.createdAt).toLocaleString()}
                  </p>
                </div>
                <StatusPill value={version.status} />
              </div>
              {version.changeSummary && (
                <p className="mt-2 text-xs leading-5 text-[var(--ciq-ink-muted)]">
                  {version.changeSummary}
                </p>
              )}
              {version.status === "draft" && (
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => onPublish(version.id)}
                  disabled={Boolean(publishingId)}
                >
                  <CheckCircle2 aria-hidden="true" />
                  {publishingId === version.id ? "Publishing…" : "Approve & publish"}
                </Button>
              )}
              {version.status === "archived" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full"
                  onClick={() => onRollback(version)}
                >
                  <RotateCcw aria-hidden="true" />
                  Restore as new version
                </Button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="p-4 text-xs text-[var(--ciq-ink-muted)]">
          Save the first draft to establish version history.
        </p>
      )}
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
