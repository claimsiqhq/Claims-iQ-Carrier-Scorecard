import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useLocation } from "wouter"
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  ClipboardCheck,
  ClockRotateRight,
  Download,
  Mail,
  Page,
  Refresh,
  ShieldCheck,
  Trash,
  UserBadgeCheck,
  WarningTriangle,
} from "iconoir-react"
import {
  PageState,
  StatusPill,
  formatDate,
  formatScore,
  humanize,
} from "@/components/complete-iq/status"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import type {
  AuditResult,
  ClaimActivity,
  ClaimAssignee,
  ClaimDetail,
  ClaimDocument,
  ClaimSummary,
  FindingDisposition,
  HumanReviewStatus,
  RootIssueGroup,
  ScorecardQuestion,
  ValidationCheck,
  VisionAnalysis,
} from "@/lib/types"

type WorkbenchTab = "summary" | "findings" | "estimate" | "files" | "timeline"

export interface WorkFinding {
  key: string
  title: string
  severity: string
  source?: string
  issue?: string
  impact?: string
  fix?: string
  evidence: string[]
  confidence?: number
  answer?: string
  findingId?: string
  disposition?: FindingDisposition
  reviewNotes?: string | null
}

export default function ClaimWorkbench({ claimId }: { claimId: string }) {
  const queryClient = useQueryClient()
  const { user, organization } = useAuth()
  const canAssign = Boolean(organization?.permissions.includes("claims:assign"))
  const canReview = Boolean(organization?.permissions.includes("findings:review"))
  const canRunAudit = Boolean(organization?.permissions.includes("audits:run"))
  const canDelete = Boolean(organization?.permissions.includes("claims:delete"))
  const canSendEmail = Boolean(organization?.permissions.includes("email:send"))
  const [, setLocation] = useLocation()
  const [tab, setTab] = useState<WorkbenchTab>("summary")
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [selectedEvidencePage, setSelectedEvidencePage] = useState<number | null>(null)
  const [auditRunning, setAuditRunning] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reprocessOpen, setReprocessOpen] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailHtml, setEmailHtml] = useState<string | null>(null)
  const [emailTo, setEmailTo] = useState("")
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailSending, setEmailSending] = useState(false)
  const [emailMessage, setEmailMessage] = useState<string | null>(null)
  const [workflowSaving, setWorkflowSaving] = useState(false)
  const [reviewingFinding, setReviewingFinding] = useState<Record<string, boolean>>({})

  const claimQuery = useQuery({
    queryKey: queryKeys.claim(claimId),
    queryFn: () => api.getClaim(claimId),
    refetchInterval: (query) =>
      query.state.data?.claim.status === "processing" ? 6_000 : false,
  })
  const activityQuery = useQuery({
    queryKey: queryKeys.claimActivity(claimId),
    queryFn: () => api.getClaimActivity(claimId),
  })
  const assigneesQuery = useQuery({
    queryKey: queryKeys.claimAssignees,
    queryFn: api.getClaimAssignees,
  })
  const queueQuery = useQuery({
    queryKey: queryKeys.claims,
    queryFn: () => api.getClaims(100, 0),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!selectedDocumentId && claimQuery.data?.documents[0]) {
      setSelectedDocumentId(claimQuery.data.documents[0].id)
    }
  }, [claimQuery.data?.documents, selectedDocumentId])

  const findings = useMemo(
    () => collectFindings(claimQuery.data?.audit),
    [claimQuery.data?.audit],
  )
  const neighbors = useMemo(() => {
    const claims = queueQuery.data || []
    const index = claims.findIndex((candidate) => candidate.id === claimId)
    return {
      previous: index > 0 ? claims[index - 1] : undefined,
      next: index >= 0 && index < claims.length - 1 ? claims[index + 1] : undefined,
    }
  }, [claimId, queueQuery.data])

  useEffect(() => {
    const handleQueueNavigation = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return
      if (event.key === "ArrowLeft" && neighbors.previous) {
        event.preventDefault()
        setLocation(`/claims/${neighbors.previous.id}`)
      }
      if (event.key === "ArrowRight" && neighbors.next) {
        event.preventDefault()
        setLocation(`/claims/${neighbors.next.id}`)
      }
    }
    window.addEventListener("keydown", handleQueueNavigation)
    return () => window.removeEventListener("keydown", handleQueueNavigation)
  }, [neighbors.next, neighbors.previous, setLocation])

  if (claimQuery.isLoading) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="loading"
          title="Opening claim evidence"
          description="Loading source documents, scorecards, and audit findings."
        />
      </div>
    )
  }

  if (claimQuery.isError || !claimQuery.data) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="error"
          title="Claim evidence is unavailable"
          description={apiErrorMessage(claimQuery.error, "The claim could not be loaded.")}
          actionLabel="Retry"
          onAction={() => void claimQuery.refetch()}
        >
          <Link className="ciq-link mb-4" href="/claims">
            Return to claims
          </Link>
        </PageState>
      </div>
    )
  }

  const data = claimQuery.data
  const { claim, audit, documents } = data
  const isArchived = claim.status === "archived" || claim.systemStatus === "archived"
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) || documents[0]
  const readiness = audit?.readiness || audit?.approvalStatus
  const risk = audit?.technicalRisk || audit?.riskLevel
  const openEvidence = (location?: string) => {
    const match = location?.match(/\bpage\s+(\d+)\b/i)
    setSelectedEvidencePage(match ? Number.parseInt(match[1], 10) : null)
    setTab("files")
  }

  const refreshAll = async () => {
    await Promise.all([
      claimQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: queryKeys.claims }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ])
  }

  const runAudit = async () => {
    setAuditRunning(true)
    setActionError(null)
    try {
      await api.runAudit(claimId)
      await refreshAll()
    } catch (error) {
      setActionError(apiErrorMessage(error, "The audit could not be started."))
    } finally {
      setAuditRunning(false)
    }
  }

  const archiveClaim = async () => {
    setDeleting(true)
    setActionError(null)
    try {
      await api.archiveClaim(claimId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.claims }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ])
      setLocation("/claims")
    } catch (error) {
      setActionError(apiErrorMessage(error, "The claim could not be deleted from active work."))
      setDeleteOpen(false)
      setDeleting(false)
    }
  }

  const reprocess = async () => {
    setReprocessing(true)
    setActionError(null)
    try {
      await api.reprocessClaim(claimId)
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const status = await api.getProcessingStatus(claimId)
        if (
          status.systemStatus === "error" ||
          status.aiStatus === "failed" ||
          status.job?.status === "failed" ||
          status.job?.status === "cancelled"
        ) {
          throw new Error(status.job?.error?.message || "Reprocessing failed.")
        }
        if (
          status.systemStatus === "ready" ||
          status.job?.status === "succeeded" ||
          status.job?.status === "degraded"
        ) {
          const detail = await api.getClaim(claimId)
          if (detail.audit || detail.claim.aiStatus === "succeeded" || detail.claim.status === "analyzed") {
            break
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 3_000))
      }
      await refreshAll()
      setReprocessOpen(false)
    } catch (error) {
      setActionError(apiErrorMessage(error, "Reprocessing failed."))
    } finally {
      setReprocessing(false)
    }
  }

  const openEmail = async () => {
    setEmailOpen(true)
    setEmailLoading(true)
    setEmailMessage(null)
    setEmailHtml(null)
    try {
      const preview = await api.getEmailPreview(claimId)
      setEmailHtml(preview.html)
    } catch (error) {
      setEmailMessage(apiErrorMessage(error, "Email preview is unavailable."))
    } finally {
      setEmailLoading(false)
    }
  }

  const sendEmail = async () => {
    if (!emailTo) return
    setEmailSending(true)
    setEmailMessage(null)
    try {
      await api.sendEmail(claimId, emailTo)
      setEmailMessage("Scorecard email sent.")
    } catch (error) {
      setEmailMessage(apiErrorMessage(error, "The email could not be sent."))
    } finally {
      setEmailSending(false)
    }
  }

  const updateAssignment = async (assigneeUserId: string | null) => {
    setWorkflowSaving(true)
    setActionError(null)
    try {
      await api.updateAssignment(claimId, assigneeUserId)
      await refreshAll()
      await activityQuery.refetch()
    } catch (error) {
      setActionError(apiErrorMessage(error, "Assignment could not be updated."))
    } finally {
      setWorkflowSaving(false)
    }
  }

  const updateReviewStatus = async (status: HumanReviewStatus) => {
    setWorkflowSaving(true)
    setActionError(null)
    try {
      await api.updateReviewStatus(claimId, status)
      await refreshAll()
      await activityQuery.refetch()
    } catch (error) {
      setActionError(apiErrorMessage(error, "Human review status could not be updated."))
    } finally {
      setWorkflowSaving(false)
    }
  }

  const updateFindingDisposition = async (
    findingId: string,
    disposition: FindingDisposition,
    notes?: string,
  ) => {
    setReviewingFinding((current) => ({ ...current, [findingId]: true }))
    setActionError(null)
    try {
      await api.updateFinding(claimId, findingId, {
        disposition,
        notes: notes || null,
        overrideReason: disposition === "overridden" ? notes || null : null,
      })
      await Promise.all([claimQuery.refetch(), activityQuery.refetch()])
    } catch (error) {
      setActionError(apiErrorMessage(error, "Finding review could not be saved."))
    } finally {
      setReviewingFinding((current) => ({ ...current, [findingId]: false }))
    }
  }

  const downloadCsv = () => {
    if (!findings.length) return
    const rows = [
      ["claim_number", "finding", "severity", "source", "issue", "impact", "required_action", "evidence", "confidence"],
      ...findings.map((finding) => [
        claim.claimNumber,
        finding.title,
        finding.severity,
        finding.source || "",
        finding.issue || "",
        finding.impact || "",
        finding.fix || "",
        finding.evidence.join(" | "),
        finding.confidence === undefined ? "" : String(finding.confidence),
      ]),
    ]
    const csv = rows.map((row) => row.map(csvValue).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${claim.claimNumber || "claim"}-findings.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="ciq-page">
      <PageHeader
        compact
        eyebrow={`${claim.carrier || "Carrier unavailable"} · Evidence workbench`}
        title={claim.claimNumber}
        description={`${claim.insuredName}${claim.lossType ? ` · ${claim.lossType}` : ""}`}
        meta={
          <>
            <StatusPill
              value={claim.systemStatus || claim.status}
              label={`System: ${humanize(claim.systemStatus || claim.status)}`}
            />
            {claim.aiStatus && (
              <StatusPill value={claim.aiStatus} label={`AI: ${humanize(claim.aiStatus)}`} />
            )}
            {claim.humanReviewStatus && (
              <StatusPill
                value={claim.humanReviewStatus}
                label={`Human: ${humanize(claim.humanReviewStatus)}`}
              />
            )}
            {readiness && (
              <StatusPill value={readiness} label={`AI readiness: ${humanize(readiness)}`} />
            )}
            {risk && <StatusPill value={risk} label={`${humanize(risk)} technical risk`} />}
          </>
        }
        actions={
          <>
            {neighbors.previous && (
              <Button
                asChild
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
              >
                <Link
                  href={`/claims/${neighbors.previous.id}`}
                  title={`Previous claim: ${neighbors.previous.claimNumber}`}
                >
                  <ArrowLeft aria-hidden="true" />
                  <span className="hidden 2xl:inline">Previous</span>
                </Link>
              </Button>
            )}
            {neighbors.next && (
              <Button
                asChild
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
              >
                <Link
                  href={`/claims/${neighbors.next.id}`}
                  title={`Next claim: ${neighbors.next.claimNumber}`}
                >
                  <span className="hidden 2xl:inline">Next</span>
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            )}
            {audit && (
              <Button
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                onClick={() => window.open(api.reportUrl(claimId), "_blank", "noopener,noreferrer")}
              >
                <Download aria-hidden="true" />
                PDF
              </Button>
            )}
            <Button
              variant="outline"
              className="border-white/20 bg-transparent text-white hover:bg-white/10"
              onClick={downloadCsv}
              disabled={!findings.length}
            >
              <Download aria-hidden="true" />
              CSV
            </Button>
            {audit && (
              <Button
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                onClick={() => void openEmail()}
              >
                <Mail aria-hidden="true" />
                Email preview
              </Button>
            )}
            {canRunAudit && !isArchived && (
              <Button
                className="border-white/15 bg-white text-[var(--ciq-aubergine)] hover:bg-[#f7f3ed]"
                onClick={() => setReprocessOpen(true)}
              >
                <Refresh aria-hidden="true" />
                Reprocess
              </Button>
            )}
          </>
        }
      />

      <PageBody className="!max-w-none">
        {isArchived && (
          <div className="mb-4 flex items-start gap-3 rounded-md border border-[var(--ciq-border-strong)] bg-[var(--ciq-surface-subtle)] p-4">
            <Archive className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ciq-financial)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-[var(--ciq-ink)]">Archived claim · read only</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ciq-ink-muted)]">
                This record is excluded from active dashboards and processing. Source evidence and
                audit provenance remain available for compliance review.
              </p>
            </div>
          </div>
        )}
        {actionError && (
          <div
            className="mb-4 flex items-start gap-2 rounded-md border border-[#e5b3b3] bg-[var(--ciq-critical-soft)] p-3 text-sm text-[var(--ciq-critical)]"
            role="alert"
          >
            <WarningTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{actionError}</span>
            <button type="button" className="font-semibold underline" onClick={() => setActionError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <div className="grid min-w-0 gap-4 xl:grid-cols-[14rem_minmax(0,1fr)_18rem]">
          <ClaimLedger
            data={data}
            className="hidden xl:block"
            onDelete={canDelete && !isArchived ? () => setDeleteOpen(true) : undefined}
          />

          <section className="min-w-0">
            <Tabs value={tab} onValueChange={(value) => setTab(value as WorkbenchTab)}>
              <TabsList className="grid h-auto w-full grid-cols-5 border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-1">
                <WorkbenchTabTrigger value="summary" icon={<ClipboardCheck />}>
                  Summary
                </WorkbenchTabTrigger>
                <WorkbenchTabTrigger value="findings" icon={<ShieldCheck />}>
                  Findings
                </WorkbenchTabTrigger>
                <WorkbenchTabTrigger value="estimate" icon={<Page />}>
                  Estimate
                </WorkbenchTabTrigger>
                <WorkbenchTabTrigger value="files" icon={<Page />}>
                  Files
                </WorkbenchTabTrigger>
                <WorkbenchTabTrigger value="timeline" icon={<ClockRotateRight />}>
                  Timeline
                </WorkbenchTabTrigger>
              </TabsList>

              <TabsContent value="summary" className="mt-4 space-y-4">
                <ClaimLedger
                  data={data}
                  className="xl:hidden"
                  onDelete={canDelete && !isArchived ? () => setDeleteOpen(true) : undefined}
                />
                {audit ? (
                  <>
                    <ScoreBridge audit={audit} claimAmount={claim.totalClaimAmount} />
                    <WorkflowSeparation
                      claimStatus={claim.systemStatus || claim.status}
                      aiStatus={claim.aiStatus}
                      humanReviewStatus={claim.humanReviewStatus}
                      readiness={readiness}
                    />
                    <WorkflowActions
                      assigneeUserId={claim.assigneeUserId}
                      currentUserId={user?.id}
                      assignees={assigneesQuery.data?.assignees || []}
                      canAssign={canAssign && !isArchived}
                      canReview={canReview && !isArchived}
                      humanReviewStatus={claim.humanReviewStatus || "unassigned"}
                      saving={workflowSaving}
                      onAssignment={updateAssignment}
                      onStatus={updateReviewStatus}
                    />
                    {audit.executiveSummary && (
                      <section className="ciq-panel">
                        <div className="ciq-panel__header">
                          <div>
                            <h2>Audit synopsis</h2>
                            <p>Generated analysis · reviewer verification required</p>
                          </div>
                          <ClipboardCheck className="h-4 w-4 text-[var(--ciq-financial)]" aria-hidden="true" />
                        </div>
                        <p className="p-4 text-sm leading-7 text-[var(--ciq-ink-muted)]">
                          {audit.executiveSummary}
                        </p>
                      </section>
                    )}
                    <RequiredActions
                      groups={audit.rootIssueGroups || []}
                      findings={findings}
                      onEvidence={openEvidence}
                    />
                  </>
                ) : claim.status === "processing" || claim.status === "pending" ? (
                  <PageState
                    kind="loading"
                    title="Automatic audit is in progress"
                    description="The backend owns post-ingestion auditing. This view will refresh as the workflow advances."
                  />
                ) : (
                  <PageState
                    kind="unavailable"
                    title="No audit result is available"
                    description="The automatic workflow did not produce an audit result. A reviewer may start the existing manual audit endpoint."
                    actionLabel={
                      canRunAudit && !isArchived
                        ? auditRunning
                          ? "Running audit…"
                          : "Run carrier audit"
                        : undefined
                    }
                    onAction={canRunAudit && !isArchived ? () => void runAudit() : undefined}
                  />
                )}
              </TabsContent>

              <TabsContent value="findings" className="mt-4 space-y-4">
                {!audit ? (
                  <PageState
                    kind="unavailable"
                    title="Findings are not available"
                    description="Findings will appear after the carrier audit completes."
                  />
                ) : (
                  <>
                    <FindingLedger
                      findings={findings}
                      onEvidence={openEvidence}
                      reviewing={reviewingFinding}
                      canReview={canReview && !isArchived}
                      onDisposition={updateFindingDisposition}
                    />
                    <ValidationLedger checks={audit.validationChecks || []} />
                    {audit.visionAnalysis && <VisionLedger vision={audit.visionAnalysis} />}
                  </>
                )}
              </TabsContent>

              <TabsContent value="estimate" className="mt-4">
                <EstimateLedger
                  claim={claim}
                  document={selectedDocument}
                  documents={documents}
                  onSelectDocument={setSelectedDocumentId}
                />
              </TabsContent>

              <TabsContent value="files" className="mt-4">
                <FilesLedger
                  data={data}
                  selectedId={selectedDocument?.id}
                  onSelect={(documentId) => {
                    setSelectedDocumentId(documentId)
                    setSelectedEvidencePage(null)
                  }}
                  selectedPage={selectedEvidencePage}
                />
              </TabsContent>

              <TabsContent value="timeline" className="mt-4">
                <TimelineLedger
                  data={data}
                  activity={activityQuery.data?.activity || []}
                  loading={activityQuery.isLoading}
                  error={activityQuery.isError ? apiErrorMessage(activityQuery.error) : undefined}
                  onRetry={() => void activityQuery.refetch()}
                />
              </TabsContent>
            </Tabs>
          </section>

          <SourcePane
            document={selectedDocument}
            documents={documents}
            selectedId={selectedDocument?.id}
            onSelect={(documentId) => {
              setSelectedDocumentId(documentId)
              setSelectedEvidencePage(null)
            }}
            selectedPage={selectedEvidencePage}
            className="hidden xl:block"
          />
        </div>
      </PageBody>

      <Dialog open={reprocessOpen} onOpenChange={(open) => !reprocessing && setReprocessOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-[var(--ciq-font-serif)] text-2xl">
              Reprocess source package
            </DialogTitle>
            <DialogDescription>
              This replaces the current audit with a new run using this tenant's assigned prompt
              and ruleset. The source file is retained and processing status is polled safely.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] px-3 py-2 text-xs leading-5 text-[var(--ciq-ink-muted)]">
            Reprocessing keeps this claim's current writing-company label unless the source names
            another {organization?.name || "tenant"} entity. It uses the {organization?.name || "tenant"} assigned prompt and ruleset.
          </p>
          {reprocessing && (
            <p className="flex items-center gap-2 text-sm text-[var(--ciq-ink-muted)]" role="status">
              <Refresh className="h-4 w-4 animate-spin" aria-hidden="true" />
              Reprocessing and waiting for the automatic audit…
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReprocessOpen(false)} disabled={reprocessing}>
              Cancel
            </Button>
            <Button
              onClick={() => void reprocess()}
              disabled={reprocessing}
            >
              <Refresh className={reprocessing ? "animate-spin" : ""} aria-hidden="true" />
              {reprocessing ? "Reprocessing" : "Reprocess claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="flex max-h-[92dvh] max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto] flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-[var(--ciq-border)] px-5 pb-4 pt-5 text-left">
            <DialogTitle className="font-[var(--ciq-font-serif)] text-2xl">
              Review scorecard email
            </DialogTitle>
            <DialogDescription>
              {canSendEmail
                ? "Preview first. Sending requires a separate, explicit reviewer action."
                : "This is a read-only preview. Your organization role cannot send scorecards."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-64 flex-1 overflow-hidden bg-[var(--ciq-canvas)]">
            {emailLoading ? (
              <PageState kind="loading" title="Generating email preview" />
            ) : emailHtml ? (
              <iframe
                title="Scorecard email preview"
                srcDoc={emailHtml}
                sandbox="allow-same-origin"
                className="h-full min-h-[45dvh] w-full border-0 bg-white"
              />
            ) : (
              <PageState
                kind="error"
                title="Preview unavailable"
                description={emailMessage || "The email endpoint returned no preview."}
              />
            )}
          </div>
          <div className="space-y-3 border-t border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-4">
            <div className="ciq-field">
              <label htmlFor="scorecard-recipient">Recipient email</label>
              <input
                id="scorecard-recipient"
                type="email"
                className="ciq-control"
                value={emailTo}
                onChange={(event) => setEmailTo(event.target.value)}
                placeholder={canSendEmail ? "reviewer@example.com" : "Sending permission required"}
                disabled={!canSendEmail}
              />
            </div>
            {emailMessage && !emailLoading && (
              <p className="text-sm text-[var(--ciq-ink-muted)]" role="status">
                {emailMessage}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEmailOpen(false)}>
                Close
              </Button>
              {canSendEmail && (
                <Button
                  onClick={() => void sendEmail()}
                  disabled={!emailTo || emailSending || emailLoading || !emailHtml}
                >
                  <Mail aria-hidden="true" />
                  {emailSending ? "Sending…" : "Send scorecard"}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {claim.claimNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the claim from active dashboards and queue views. Complete iQ retains
              the source record and immutable audit provenance under Archived for compliance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep active</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--ciq-critical)] text-white"
              onClick={(event) => {
                event.preventDefault()
                void archiveClaim()
              }}
              disabled={deleting}
            >
              <Trash aria-hidden="true" />
              {deleting ? "Deleting…" : "Delete claim"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function WorkbenchTabTrigger({
  value,
  icon,
  children,
}: {
  value: WorkbenchTab
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <TabsTrigger value={value} className="min-w-0 gap-1.5 px-2 text-xs sm:text-sm">
      <span className="hidden [&_svg]:h-3.5 [&_svg]:w-3.5 sm:inline-flex" aria-hidden="true">
        {icon}
      </span>
      {children}
    </TabsTrigger>
  )
}

function EstimateLedger({
  claim,
  document,
  documents,
  onSelectDocument,
}: {
  claim: ClaimSummary
  document?: ClaimDocument
  documents: ClaimDocument[]
  onSelectDocument: (documentId: string) => void
}) {
  const indexedLines = useMemo(() => {
    const matches: Array<{ page: number | null; text: string }> = []
    let page: number | null = null
    for (const rawLine of (document?.extractedText || "").split(/\r?\n/)) {
      const marker = rawLine.match(/={3,}\s*page\s+(\d+)\s*={3,}/i)
      if (marker) {
        page = Number.parseInt(marker[1], 10)
        continue
      }
      const line = rawLine.trim()
      if (
        line
        && /(estimate|replacement cost|actual cash|deductible|subtotal|grand total|tax|depreciation|rcv|acv)/i.test(
          line,
        )
      ) {
        matches.push({ page, text: line })
      }
      if (matches.length >= 48) break
    }
    return matches
  }, [document?.extractedText])
  const extractedDocumentCount = documents.filter((item) => item.extractedText).length

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <article className="ciq-panel border-t-[3px] border-t-[var(--ciq-financial)] p-4">
          <span className="ciq-section-title">Claim exposure</span>
          <strong className="ciq-mono mt-3 block text-xl text-[var(--ciq-financial-strong)]">
            {claim.totalClaimAmount || "—"}
          </strong>
          <p className="mt-1 text-xs text-[var(--ciq-ink-muted)]">
            Supplied claim total; verify against source.
          </p>
        </article>
        <article className="ciq-panel p-4">
          <span className="ciq-section-title">Deductible</span>
          <strong className="ciq-mono mt-3 block text-xl">
            {claim.deductible || "—"}
          </strong>
          <p className="mt-1 text-xs text-[var(--ciq-ink-muted)]">
            Structured intake value when available.
          </p>
        </article>
        <article className="ciq-panel border-t-[3px] border-t-[var(--ciq-verified)] p-4">
          <span className="ciq-section-title">Evidence completeness</span>
          <strong className="ciq-mono mt-3 block text-xl">
            {documents.length ? `${extractedDocumentCount}/${documents.length}` : "0/0"}
          </strong>
          <p className="mt-1 text-xs text-[var(--ciq-ink-muted)]">
            Source documents with extracted text.
          </p>
        </article>
      </div>

      <section className="ciq-panel ciq-panel--flush">
        <div className="ciq-panel__header">
          <div>
            <h2>Estimate evidence index</h2>
            <p>Financial and estimate terms located in the selected source</p>
          </div>
          {documents.length > 1 && (
            <select
              className="ciq-control !w-auto min-w-44"
              aria-label="Estimate source document"
              value={document?.id || ""}
              onChange={(event) => onSelectDocument(event.target.value)}
            >
              {documents.map((item) => (
                <option key={item.id} value={item.id}>
                  {documentName(item)}
                </option>
              ))}
            </select>
          )}
        </div>
        {indexedLines.length ? (
          <ol className="divide-y divide-[var(--ciq-border)]">
            {indexedLines.map((entry, index) => (
              <li
                key={`${entry.page ?? "unknown"}-${index}-${entry.text}`}
                className="grid gap-2 p-4 text-sm sm:grid-cols-[5.5rem_minmax(0,1fr)]"
              >
                <span className="ciq-status ciq-mono">
                  {entry.page ? `Page ${entry.page}` : "Page n/a"}
                </span>
                <span className="font-[var(--ciq-font-mono)] text-xs leading-6 text-[var(--ciq-ink)]">
                  {entry.text}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="p-4">
            <PageState
              kind="unavailable"
              title="No estimate index is available"
              description="The selected source has no extracted estimate or financial terms. Review the Files tab before making a decision."
            />
          </div>
        )}
      </section>
      <p className="text-xs leading-5 text-[var(--ciq-ink-muted)]">
        This index is a navigation aid, not a recalculation. Monetary decisions must be
        verified against the authorized source package.
      </p>
    </section>
  )
}

function ClaimLedger({
  data,
  className,
  onDelete,
}: {
  data: ClaimDetail
  className?: string
  onDelete?: () => void
}) {
  const { claim, audit, documents } = data
  return (
    <aside className={`ciq-panel h-fit ${className || ""}`}>
      <div className="ciq-panel__header">
        <div>
          <h2>Claim ledger</h2>
          <p>Source record</p>
        </div>
      </div>
      <dl className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-1">
        <LedgerField label="Claim number" value={claim.claimNumber} mono />
        <LedgerField label="Insured" value={claim.insuredName} />
        <LedgerField label="Carrier" value={claim.carrier || "Unavailable"} />
        <LedgerField label="Date of loss" value={formatDate(claim.dateOfLoss)} />
        {claim.policyNumber && <LedgerField label="Policy number" value={claim.policyNumber} mono />}
        {claim.propertyAddress && <LedgerField label="Property" value={claim.propertyAddress} />}
        {claim.adjuster && <LedgerField label="Adjuster" value={claim.adjuster} />}
      </dl>
      <div className="border-t border-[var(--ciq-border)] p-4">
        <h3 className="ciq-section-title">Financial bridge</h3>
        {claim.totalClaimAmount ? (
          <strong className="ciq-mono mt-2 block text-xl text-[var(--ciq-financial-strong)]">
            {claim.totalClaimAmount}
          </strong>
        ) : (
          <p className="mt-2 text-sm text-[var(--ciq-ink-muted)]">Claim amount unavailable</p>
        )}
        {claim.deductible && (
          <p className="ciq-mono mt-1 text-xs text-[var(--ciq-ink-muted)]">
            Deductible {claim.deductible}
          </p>
        )}
        <p className="mt-2 text-[0.68rem] leading-5 text-[var(--ciq-ink-muted)]">
          Recoverable-dollar opportunity is not supplied by the API and is not estimated.
        </p>
      </div>
      <div className="space-y-2 border-t border-[var(--ciq-border)] p-4">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-[var(--ciq-ink-muted)]">Documents</span>
          <strong className="ciq-mono">{documents.length}</strong>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-[var(--ciq-ink-muted)]">Required actions</span>
          <strong className="ciq-mono">{audit?.actionRequiredCount ?? "—"}</strong>
        </div>
      </div>
      {onDelete && (
        <div className="space-y-2 border-t border-[var(--ciq-border)] p-4">
          <Button
            variant="ghost"
            className="w-full justify-start text-[var(--ciq-critical)]"
            onClick={onDelete}
          >
            <Trash aria-hidden="true" />
            Delete claim
          </Button>
        </div>
      )}
    </aside>
  )
}

function LedgerField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[0.64rem] font-bold uppercase tracking-[0.08em] text-[var(--ciq-ink-muted)]">
        {label}
      </dt>
      <dd className={`mt-1 text-sm font-semibold leading-5 ${mono ? "ciq-mono" : ""}`}>{value}</dd>
    </div>
  )
}

function ScoreBridge({ audit, claimAmount }: { audit: AuditResult; claimAmount?: string }) {
  const metrics = [
    {
      label: "Overall audit",
      score: audit.overallScore,
      detail: "Carrier score",
      tone: "var(--ciq-aubergine)",
    },
    {
      label: "Desk adjuster",
      score: audit.daScore ?? audit.technicalScore,
      detail:
        audit.daPointsPossible !== undefined
          ? `${audit.daPointsAwarded ?? 0}/${audit.daPointsPossible} points`
          : "DA score",
      tone: "var(--ciq-verified)",
    },
    {
      label: "Field adjuster",
      score: audit.faScore ?? audit.presentationScore,
      detail:
        audit.faPointsPossible !== undefined
          ? `${audit.faPointsAwarded ?? 0}/${audit.faPointsPossible} points`
          : "FA score",
      tone: "var(--ciq-financial)",
    },
  ]
  return (
    <section className="ciq-panel">
      <div className="ciq-panel__header">
        <div>
          <h2>Score and financial bridge</h2>
          <p>Audit quality beside supplied claim exposure</p>
        </div>
        {claimAmount && (
          <span className="ciq-status ciq-status--financial ciq-mono">Exposure {claimAmount}</span>
        )}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        {metrics.map((metric) => (
          <article
            key={metric.label}
            className="rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-4"
          >
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--ciq-ink-muted)]">
              {metric.label}
            </span>
            <strong className="ciq-mono mt-2 block text-2xl">{formatScore(metric.score)}</strong>
            <div className="ciq-bar mt-3">
              <span
                style={{
                  width: `${Math.max(0, Math.min(100, metric.score || 0))}%`,
                  background: metric.tone,
                }}
              />
            </div>
            <small className="mt-2 block text-xs text-[var(--ciq-ink-muted)]">{metric.detail}</small>
          </article>
        ))}
      </div>
    </section>
  )
}

function WorkflowSeparation({
  claimStatus,
  aiStatus,
  humanReviewStatus,
  readiness,
}: {
  claimStatus: string
  aiStatus?: string
  humanReviewStatus?: string
  readiness?: string
}) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article className="ciq-panel p-4">
        <span className="ciq-section-title">System workflow</span>
        <div className="mt-3">
          <StatusPill value={claimStatus} />
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--ciq-ink-muted)]">
          Source package availability and processing state.
        </p>
      </article>
      <article className="ciq-panel p-4">
        <span className="ciq-section-title">AI processing</span>
        <div className="mt-3">
          {aiStatus ? <StatusPill value={aiStatus} /> : <span className="text-sm">Unavailable</span>}
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--ciq-ink-muted)]">
          Automatic extraction and carrier-audit execution.
        </p>
      </article>
      <article className="ciq-panel p-4">
        <span className="ciq-section-title">AI evidence readiness</span>
        <div className="mt-3">
          {readiness ? (
            <StatusPill value={readiness} />
          ) : (
            <span className="text-sm text-[var(--ciq-ink-muted)]">Unavailable</span>
          )}
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--ciq-ink-muted)]">
          Readiness indicates analysis completeness; it is not a human approval or claim decision.
        </p>
      </article>
      <article className="ciq-panel p-4">
        <span className="ciq-section-title">Human review</span>
        <div className="mt-3">
          {humanReviewStatus ? (
            <StatusPill value={humanReviewStatus} />
          ) : (
            <span className="text-sm">Unavailable</span>
          )}
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--ciq-ink-muted)]">
          Reviewer-owned disposition, independent from AI readiness.
        </p>
      </article>
    </section>
  )
}

function WorkflowActions({
  assigneeUserId,
  currentUserId,
  assignees,
  canAssign,
  canReview,
  humanReviewStatus,
  saving,
  onAssignment,
  onStatus,
}: {
  assigneeUserId?: string | null
  currentUserId?: string
  assignees: ClaimAssignee[]
  canAssign: boolean
  canReview: boolean
  humanReviewStatus: HumanReviewStatus
  saving: boolean
  onAssignment: (assigneeUserId: string | null) => Promise<void>
  onStatus: (status: HumanReviewStatus) => Promise<void>
}) {
  const [nextStatus, setNextStatus] = useState<HumanReviewStatus>(humanReviewStatus)
  const assignedName = assignees.find((assignee) => assignee.userId === assigneeUserId)?.name

  useEffect(() => setNextStatus(humanReviewStatus), [humanReviewStatus])

  return (
    <section className="ciq-panel">
      <div className="ciq-panel__header">
        <div>
          <h2>Reviewer workflow</h2>
          <p>Live assignment and human disposition controls</p>
        </div>
        <StatusPill
          value={assigneeUserId ? "assigned" : "unassigned"}
          label={assigneeUserId === currentUserId ? "Assigned to you" : assigneeUserId ? "Assigned" : "Unassigned"}
        />
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h3 className="ciq-section-title">Assignment</h3>
          {canAssign ? (
            <>
              <select
                className="ciq-control mt-2"
                value={assigneeUserId || ""}
                disabled={saving}
                onChange={(event) => void onAssignment(event.target.value || null)}
                aria-label="Claim assignee"
              >
                <option value="">Unassigned</option>
                {assignees.map((assignee) => (
                  <option key={assignee.userId} value={assignee.userId}>
                    {assignee.name} · {humanize(assignee.role)}
                  </option>
                ))}
              </select>
              <div className="mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!currentUserId || saving || assigneeUserId === currentUserId}
                  onClick={() => currentUserId && void onAssignment(currentUserId)}
                >
                  <UserBadgeCheck aria-hidden="true" />
                  Assign to me
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--ciq-ink-muted)]">
              {assignedName || (assigneeUserId ? "Assigned organization member" : "Unassigned")}
            </p>
          )}
        </div>
        <div className="ciq-field">
          <label htmlFor="human-review-status">Human review status</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              id="human-review-status"
              className="ciq-control flex-1"
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value as HumanReviewStatus)}
              disabled={saving || !canReview}
            >
              <option value="unassigned">Unassigned</option>
              <option value="pending">Pending review</option>
              <option value="in_review">In review</option>
              <option value="approved">Approved</option>
              <option value="changes_requested">Changes requested</option>
            </select>
            {canReview && (
              <Button
                disabled={saving || nextStatus === humanReviewStatus}
                onClick={() => void onStatus(nextStatus)}
              >
                {saving ? "Saving…" : "Save status"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function RequiredActions({
  groups,
  findings,
  onEvidence,
}: {
  groups: RootIssueGroup[]
  findings: WorkFinding[]
  onEvidence: (location?: string) => void
}) {
  const priorityFindings = findings.filter((finding) =>
    ["fail", "critical", "high", "partial"].includes(finding.severity.toLowerCase()),
  )
  return (
    <section className="ciq-panel ciq-panel--flush">
      <div className="ciq-panel__header">
        <div>
          <h2>Root issues and required actions</h2>
          <p>Failures and partial findings are prioritized before score detail</p>
        </div>
        <StatusPill
          value={groups.length || priorityFindings.length ? "critical" : "ready"}
          label={`${groups.length || priorityFindings.length} prioritized`}
        />
      </div>
      {groups.length || priorityFindings.length ? (
        <div className="divide-y divide-[var(--ciq-border)]">
          {groups.slice(0, 4).map((group, index) => (
            <ActionRow
              key={`${group.root_issue}-${index}`}
              title={humanize(group.root_issue)}
              issue={group.issue}
              impact={group.impact}
              fix={group.fix}
              evidence={group.evidence_locations || []}
              onEvidence={onEvidence}
            />
          ))}
          {!groups.length &&
            priorityFindings.slice(0, 5).map((finding) => (
              <ActionRow
                key={finding.key}
                title={finding.title}
                issue={finding.issue}
                impact={finding.impact}
                fix={finding.fix}
                evidence={finding.evidence}
                onEvidence={onEvidence}
              />
            ))}
        </div>
      ) : (
        <div className="flex items-start gap-3 p-4 text-sm text-[var(--ciq-ink-muted)]">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ciq-verified)]" aria-hidden="true" />
          No root issues or required actions were returned by this audit.
        </div>
      )}
    </section>
  )
}

function ActionRow({
  title,
  issue,
  impact,
  fix,
  evidence,
  onEvidence,
}: {
  title: string
  issue?: string
  impact?: string
  fix?: string
  evidence: string[]
  onEvidence: (location?: string) => void
}) {
  return (
    <article className="border-l-[3px] border-l-[var(--ciq-critical)] p-4">
      <h3 className="text-sm font-bold text-[var(--ciq-ink)]">{title}</h3>
      {issue && <p className="mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">{issue}</p>}
      {impact && (
        <p className="mt-2 text-xs leading-5 text-[var(--ciq-critical)]">
          <strong>Impact:</strong> {impact}
        </p>
      )}
      {fix && (
        <p className="mt-2 text-xs leading-5 text-[var(--ciq-verified-strong)]">
          <strong>Required action:</strong> {fix}
        </p>
      )}
      {evidence.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {evidence.map((location) => (
            <span key={location} className="ciq-status ciq-mono">
              {location}
            </span>
          ))}
          <Button variant="ghost" size="sm" onClick={() => onEvidence(evidence[0])}>
            Open source
          </Button>
        </div>
      )}
    </article>
  )
}

function FindingLedger({
  findings,
  onEvidence,
  reviewing,
  canReview,
  onDisposition,
}: {
  findings: WorkFinding[]
  onEvidence: (location?: string) => void
  reviewing: Record<string, boolean>
  canReview: boolean
  onDisposition: (
    findingId: string,
    disposition: FindingDisposition,
    notes?: string,
  ) => Promise<void>
}) {
  return (
    <section className="ciq-panel ciq-panel--flush">
      <div className="ciq-panel__header">
        <div>
          <h2>Finding ledger</h2>
          <p>Issues, evidence locations, required action, and confidence</p>
        </div>
        <span className="ciq-mono text-sm font-semibold">{findings.length}</span>
      </div>
      {findings.length ? (
        <div className="divide-y divide-[var(--ciq-border)]">
          {findings.map((finding) => (
            <article key={finding.key} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill value={finding.answer || finding.severity} />
                    {finding.source && <span className="ciq-status">{finding.source}</span>}
                    {finding.confidence !== undefined && (
                      <span className="ciq-status">
                        Confidence {formatConfidence(finding.confidence)}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 text-sm font-bold">{finding.title}</h3>
                </div>
              </div>
              {finding.issue && (
                <p className="mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">{finding.issue}</p>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {finding.impact && (
                  <div className="rounded-md bg-[var(--ciq-critical-soft)] p-3 text-xs leading-5 text-[var(--ciq-critical)]">
                    <strong className="block">Impact</strong>
                    {finding.impact}
                  </div>
                )}
                {finding.fix && (
                  <div className="rounded-md bg-[var(--ciq-verified-soft)] p-3 text-xs leading-5 text-[var(--ciq-verified-strong)]">
                    <strong className="block">Required action</strong>
                    {finding.fix}
                  </div>
                )}
              </div>
              {finding.findingId && canReview && (
                <FindingReviewControl
                  finding={finding}
                  saving={Boolean(reviewing[finding.findingId])}
                  onSave={(disposition, notes) =>
                    onDisposition(finding.findingId!, disposition, notes)
                  }
                />
              )}
              {finding.evidence.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {finding.evidence.map((location) => (
                    <span key={location} className="ciq-status ciq-mono">
                      {location}
                    </span>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEvidence(finding.evidence[0])}
                  >
                    View extracted source
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="p-4">
          <PageState
            kind="empty"
            title="No exception findings returned"
            description="Passing scorecard questions remain represented in the score bridge and category totals."
          />
        </div>
      )}
    </section>
  )
}

export function FindingReviewControl({
  finding,
  saving,
  onSave,
}: {
  finding: WorkFinding
  saving: boolean
  onSave: (disposition: FindingDisposition, notes?: string) => Promise<void>
}) {
  const [disposition, setDisposition] = useState<FindingDisposition>(
    finding.disposition || "open",
  )
  const [notes, setNotes] = useState(finding.reviewNotes || "")

  useEffect(() => {
    setDisposition(finding.disposition || "open")
    setNotes(finding.reviewNotes || "")
  }, [finding.disposition, finding.reviewNotes])

  const dirty =
    disposition !== (finding.disposition || "open") || notes !== (finding.reviewNotes || "")

  return (
    <div className="mt-4 grid gap-2 rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
      <div className="ciq-field">
        <label htmlFor={`finding-${finding.findingId}-disposition`}>Disposition</label>
        <select
          id={`finding-${finding.findingId}-disposition`}
          className="ciq-control"
          value={disposition}
          onChange={(event) => setDisposition(event.target.value as FindingDisposition)}
          disabled={saving}
        >
          <option value="open">Defer — keep open</option>
          <option value="accepted">Accept as confirmed</option>
          <option value="dismissed">Reject finding</option>
          <option value="remediated">Mark resolved</option>
          <option value="overridden">Modify / override</option>
        </select>
      </div>
      <div className="ciq-field">
        <label htmlFor={`finding-${finding.findingId}-notes`}>Reviewer notes</label>
        <input
          id={`finding-${finding.findingId}-notes`}
          className="ciq-control"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional review context"
          disabled={saving}
        />
      </div>
      <Button
        disabled={!dirty || saving || (disposition === "overridden" && !notes.trim())}
        onClick={() => void onSave(disposition, notes)}
      >
        {saving ? "Saving…" : "Save review"}
      </Button>
    </div>
  )
}

function ValidationLedger({ checks }: { checks: ValidationCheck[] }) {
  if (!checks.length) return null
  return (
    <section className="ciq-panel ciq-panel--flush">
      <div className="ciq-panel__header">
        <div>
          <h2>Validation checks</h2>
          <p>Structured consistency checks returned by the audit</p>
        </div>
        <span className="ciq-mono text-sm">{checks.length}</span>
      </div>
      <div className="divide-y divide-[var(--ciq-border)]">
        {checks.map((check, index) => (
          <div key={`${check.key}-${index}`} className="flex items-start gap-3 p-4">
            <StatusPill value={check.severity} />
            <div>
              <strong className="ciq-mono text-xs">{check.key}</strong>
              <p className="mt-1 text-sm leading-6 text-[var(--ciq-ink-muted)]">{check.message}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function VisionLedger({ vision }: { vision: VisionAnalysis }) {
  const readings = vision.tool_readings || []
  const verifications = vision.damage_verifications || []
  const sequenceIssues = vision.sequence_issues || []
  if (!readings.length && !verifications.length && !sequenceIssues.length) return null
  return (
    <section className="ciq-panel ciq-panel--flush">
      <div className="ciq-panel__header">
        <div>
          <h2>Visual evidence validation</h2>
          <p>Only page references returned by the vision analysis are shown</p>
        </div>
      </div>
      <div className="divide-y divide-[var(--ciq-border)]">
        {readings.map((reading, index) => (
          <div key={`${reading.page_number}-${reading.tool_type}-${index}`} className="p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill value="verified" label={humanize(reading.tool_type)} tone="verified" />
              <strong className="ciq-mono">
                {reading.reading_value} {reading.reading_unit}
              </strong>
              <span className="ciq-status ciq-mono">Page {reading.page_number}</span>
              {reading.confidence !== undefined && (
                <span className="ciq-status">
                  Confidence {formatConfidence(reading.confidence)}
                </span>
              )}
            </div>
            <p className="mt-2 text-[var(--ciq-ink-muted)]">{reading.material_or_location}</p>
          </div>
        ))}
        {verifications.map((verification, index) => (
          <div key={`${verification.page_number}-${index}`} className="p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                value={verification.damage_visible ? "verified" : "critical"}
                label={verification.damage_visible ? "Damage confirmed" : "Visual mismatch"}
              />
              <span className="ciq-status ciq-mono">Page {verification.page_number}</span>
              {verification.confidence !== undefined && (
                <span className="ciq-status">
                  Confidence {formatConfidence(verification.confidence)}
                </span>
              )}
            </div>
            <p className="mt-2 text-[var(--ciq-ink)]">{verification.caption_claim}</p>
            {(verification.discrepancy || verification.damage_type) && (
              <p className="mt-1 text-[var(--ciq-ink-muted)]">
                {verification.discrepancy || verification.damage_type}
              </p>
            )}
          </div>
        ))}
        {sequenceIssues.map((issue, index) => (
          <div key={index} className="flex items-start gap-3 p-4 text-sm">
            <WarningTriangle className="mt-0.5 h-4 w-4 text-[var(--ciq-warning)]" aria-hidden="true" />
            <span>{issue}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function FilesLedger({
  data,
  selectedId,
  onSelect,
  selectedPage,
}: {
  data: ClaimDetail
  selectedId?: string
  onSelect: (id: string) => void
  selectedPage?: number | null
}) {
  const selected = data.documents.find((document) => document.id === selectedId) || data.documents[0]
  const displayedText = selectedPage
    ? extractPageText(selected?.extractedText, selectedPage)
    : selected?.extractedText
  return (
    <section className="ciq-panel ciq-panel--flush">
      <div className="ciq-panel__header">
        <div>
          <h2>Source documents</h2>
          <p>Original metadata and extracted text returned by the API</p>
        </div>
        <span className="ciq-mono text-sm">{data.documents.length}</span>
      </div>
      {data.documents.length ? (
        <div className="grid min-h-[34rem] lg:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="border-b border-[var(--ciq-border)] p-3 lg:border-b-0 lg:border-r">
            <div className="grid gap-2">
              {data.documents.map((document) => {
                const fileName = documentName(document)
                return (
                  <button
                    type="button"
                    key={document.id}
                    className={`min-h-11 rounded-md border p-3 text-left text-xs ${
                      selected?.id === document.id
                        ? "border-[var(--ciq-aubergine)] bg-[var(--ciq-info-soft)]"
                        : "border-[var(--ciq-border)] bg-[var(--ciq-surface)]"
                    }`}
                    onClick={() => onSelect(document.id)}
                  >
                    <strong className="block truncate">{fileName}</strong>
                    <span className="mt-1 block text-[var(--ciq-ink-muted)]">
                      {humanize(document.type)} · {formatDate(document.createdAt)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="min-w-0 bg-[var(--ciq-canvas)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold">{selected ? documentName(selected) : "Document"}</h3>
                <p className="text-xs text-[var(--ciq-ink-muted)]">Extracted text · read only</p>
              </div>
              <StatusPill
                value={selected?.extractedText ? "verified" : "warning"}
                label={
                  selectedPage
                    ? `Page ${selectedPage}`
                    : selected?.extractedText
                      ? "Text available"
                      : "Text unavailable"
                }
              />
            </div>
            <pre className="max-h-[45rem] min-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-4 font-[var(--ciq-font-mono)] text-[0.72rem] leading-6 text-[var(--ciq-ink)]">
              {displayedText ||
                "No extracted text was returned for this document. Page coordinates and estimate line data are not inferred."}
            </pre>
          </div>
        </div>
      ) : (
        <div className="p-4">
          <PageState
            kind="unavailable"
            title="No source documents returned"
            description="The claim detail endpoint did not include a document record."
          />
        </div>
      )}
    </section>
  )
}

function SourcePane({
  document,
  documents,
  selectedId,
  onSelect,
  selectedPage,
  className,
}: {
  document: ClaimDetail["documents"][number] | undefined
  documents: ClaimDetail["documents"]
  selectedId?: string
  onSelect: (id: string) => void
  selectedPage?: number | null
  className?: string
}) {
  const displayedText = selectedPage
    ? extractPageText(document?.extractedText, selectedPage)
    : document?.extractedText
  return (
    <aside className={`ciq-panel ciq-panel--flush sticky top-0 h-[calc(100dvh-7.5rem)] ${className || ""}`}>
      <div className="ciq-panel__header">
        <div className="min-w-0">
          <h2>Evidence source</h2>
          <p className="truncate">
            {document ? documentName(document) : "No document"}
            {selectedPage ? ` · Page ${selectedPage}` : ""}
          </p>
        </div>
      </div>
      {documents.length > 1 && (
        <div className="border-b border-[var(--ciq-border)] p-3">
          <label htmlFor="source-document" className="ciq-label">
            Document
          </label>
          <select
            id="source-document"
            className="ciq-control mt-1"
            value={selectedId}
            onChange={(event) => onSelect(event.target.value)}
          >
            {documents.map((item) => (
              <option key={item.id} value={item.id}>
                {documentName(item)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="h-[calc(100%-7rem)] overflow-auto bg-[var(--ciq-canvas)] p-3">
        <pre className="min-h-full whitespace-pre-wrap rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-3 font-[var(--ciq-font-mono)] text-[0.64rem] leading-5 text-[var(--ciq-ink)]">
          {displayedText ||
            "Extracted source text is unavailable. No page coordinates are generated by the client."}
        </pre>
      </div>
    </aside>
  )
}

function TimelineLedger({
  data,
  activity,
  loading,
  error,
  onRetry,
}: {
  data: ClaimDetail
  activity: ClaimActivity[]
  loading: boolean
  error?: string
  onRetry: () => void
}) {
  const fallbackEvents = [
    data.claim.createdAt
      ? {
          key: "claim-created",
          title: "Claim entered the ledger",
          detail: `${data.claim.claimNumber} received`,
          at: data.claim.createdAt,
          verified: true,
        }
      : null,
    ...data.documents
      .filter((document) => document.createdAt)
      .map((document) => ({
        key: document.id,
        title: "Source document recorded",
        detail: documentName(document),
        at: document.createdAt!,
        verified: true,
      })),
  ].filter(Boolean) as Array<{
    key: string
    title: string
    detail: string
    at: string
    verified: boolean
  }>

  const events = activity.length
    ? activity.map((item) => ({
        key: item.id,
        title: humanize(item.type),
        detail: activityDetail(item),
        at: item.createdAt,
        verified: true,
      }))
    : fallbackEvents

  return (
    <section className="ciq-panel">
      <div className="ciq-panel__header">
        <div>
          <h2>Activity timeline</h2>
          <p>Server-recorded claim and reviewer activity</p>
        </div>
      </div>
      <div className="p-4">
        {loading ? (
          <PageState kind="loading" title="Loading claim activity" />
        ) : error ? (
          <PageState
            kind="error"
            title="Activity could not be loaded"
            description={error}
            actionLabel="Retry"
            onAction={onRetry}
          />
        ) : events.length ? (
          <ol className="relative ml-3 border-l border-[var(--ciq-border-strong)] pl-6">
            {events.map((event) => (
              <li key={event.key} className="relative pb-7 last:pb-0">
                <span className="absolute -left-[1.84rem] top-0.5 h-3 w-3 rounded-full border-2 border-[var(--ciq-surface)] bg-[var(--ciq-verified)]" />
                <strong className="text-sm">{event.title}</strong>
                <p className="mt-1 text-xs text-[var(--ciq-ink-muted)]">{event.detail}</p>
                <time className="ciq-mono mt-1 block text-[0.68rem] text-[var(--ciq-ink-faint)]">
                  {formatDate(event.at, true)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-[var(--ciq-ink-muted)]">No timestamped activity was returned.</p>
        )}
        {!activity.length && !loading && !error && fallbackEvents.length > 0 && (
          <p className="mt-6 rounded-md border border-dashed border-[var(--ciq-border-strong)] bg-[var(--ciq-surface-subtle)] p-3 text-xs leading-5 text-[var(--ciq-ink-muted)]">
            The activity endpoint returned no rows; source timestamps are shown as a clearly limited
            fallback.
          </p>
        )}
      </div>
    </section>
  )
}

function activityDetail(activity: ClaimActivity) {
  const metadata = activity.metadata || {}
  const status = typeof metadata.status === "string" ? humanize(metadata.status) : null
  const findingId = typeof metadata.findingId === "string" ? metadata.findingId : null
  if (status) return `Status changed to ${status}.`
  if (findingId) return `Finding ${findingId.slice(0, 8)} reviewed.`
  return activity.actorUserId ? "Recorded by an authenticated reviewer." : "Recorded by the system."
}

function collectFindings(audit?: AuditResult): WorkFinding[] {
  if (!audit) return []
  const findings: WorkFinding[] = []
  const seen = new Set<string>()
  ;(audit.issues || []).forEach((issue, index) => {
    const key = `${issue.source_scorecard}-${issue.question_key}-${index}`
    seen.add(`${issue.source_scorecard}-${issue.question_key}`)
    findings.push({
      key,
      title: humanize(issue.question_key || issue.root_issue || "Audit issue"),
      severity: issue.severity || "fail",
      source: issue.source_scorecard,
      issue: issue.issue,
      impact: issue.impact,
      fix: issue.fix,
      evidence: issue.evidence_locations || [],
    })
  })

  const appendQuestion = (question: ScorecardQuestion, source: string, category: string) => {
    if (["PASS", "NOT_APPLICABLE"].includes(question.answer.toUpperCase())) return
    const seenKey = `${source}-${question.id}`
    if (seen.has(seenKey)) return
    findings.push({
      key: `${source}-${category}-${question.id}`,
      title: humanize(question.id),
      severity: question.answer.toLowerCase(),
      answer: question.answer,
      source,
      issue: question.issue,
      impact: question.impact,
      fix: question.fix,
      evidence: question.evidence_locations || [],
      confidence: question.confidence,
    })
  }

  ;(audit.daCategories || []).forEach((category) =>
    category.questions.forEach((question) =>
      appendQuestion(question, "DA", category.category_name || category.category_key),
    ),
  )
  ;(audit.faCategories || []).forEach((category) =>
    category.questions.forEach((question) =>
      appendQuestion(question, "FA", category.category_name || category.category_key),
    ),
  )

  ;(audit.findings || []).forEach((finding) => {
    const key = `legacy-${finding.id}`
    const existing = findings.find(
      (item) => item.title === finding.title && item.issue === (finding.issue || finding.description),
    )
    if (existing) {
      existing.findingId = finding.id
      existing.disposition = finding.disposition
      existing.reviewNotes = finding.reviewNotes
      return
    }
    findings.push({
      key,
      findingId: finding.id,
      title: finding.title || humanize(finding.category || finding.type),
      severity: finding.severity,
      answer: finding.answer,
      source: finding.scorecard,
      issue: finding.issue || finding.description,
      impact: finding.impact,
      fix: finding.fix,
      evidence: finding.evidence_locations || [],
      confidence: finding.confidence,
      disposition: finding.disposition,
      reviewNotes: finding.reviewNotes,
    })
  })

  const rank = (severity: string) => {
    const order = ["critical", "fail", "high", "partial", "warning", "medium", "low", "info"]
    const index = order.indexOf(severity.toLowerCase())
    return index < 0 ? 99 : index
  }
  return findings.sort((left, right) => rank(left.severity) - rank(right.severity))
}

function formatConfidence(value: number) {
  const percent = value <= 1 ? value * 100 : value
  return `${Math.round(percent)}%`
}

function extractPageText(text: string | undefined, pageNumber: number) {
  if (!text) return undefined
  const markerPattern = /^={3,}\s*page\s+(\d+)\s*={3,}\s*$/gim
  const markers = Array.from(text.matchAll(markerPattern))
  const markerIndex = markers.findIndex(
    (match) => Number.parseInt(match[1], 10) === pageNumber,
  )
  if (markerIndex < 0) {
    return `Page ${pageNumber} is cited, but the extracted source does not contain a matching page marker. Verify the original PDF before relying on this citation.`
  }
  const start = markers[markerIndex].index ?? 0
  const end = markers[markerIndex + 1]?.index ?? text.length
  return text.slice(start, end).trim()
}

function documentName(document: ClaimDetail["documents"][number]) {
  const metadataName = document.metadata?.fileName
  return typeof metadataName === "string" && metadataName ? metadataName : humanize(document.type)
}

function csvValue(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}
