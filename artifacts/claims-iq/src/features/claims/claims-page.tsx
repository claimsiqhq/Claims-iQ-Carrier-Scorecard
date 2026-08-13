import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useLocation } from "wouter"
import {
  ArrowDownUp,
  ArrowRight,
  Columns3,
  Eye,
  Files,
  Filter,
  LayoutList,
  RotateCcw,
  Save,
  Search,
  Trash2,
  UserRoundCheck,
} from "lucide-react"
import { useIntakeDialog } from "@/components/complete-iq/intake-dialog-context"
import {
  ArchiveClaimsDialog,
  type ArchiveClaimTarget,
} from "@/features/claims/archive-claims-dialog"
import {
  PageState,
  StatusPill,
  formatDate,
  formatScore,
  humanize,
} from "@/components/complete-iq/status"
import { PageBody, PageHeader } from "@/components/layout/app-shell"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import type { ClaimSummary, SavedView } from "@/lib/types"

type SortKey = "received" | "claim" | "carrier" | "score"
type Density = "comfortable" | "compact"
type Preset = "all" | "mine" | "review" | "processing" | "risk" | "exceptions" | "custom"
type OptionalColumn = "carrier" | "ai" | "human" | "risk" | "score"

const DEFAULT_COLUMNS: OptionalColumn[] = ["carrier", "ai", "human", "risk", "score"]

const PER_PAGE = 20

function nextAction(claim: ClaimSummary, canRetry = true) {
  if (claim.systemStatus === "error" || claim.aiStatus === "failed" || claim.status === "error") {
    return canRetry ? "Retry processing" : "Review processing exception"
  }
  if (
    claim.systemStatus === "processing" ||
    ["queued", "running"].includes(claim.aiStatus || "") ||
    claim.status === "processing" ||
    claim.status === "pending"
  ) {
    return "Monitor intake"
  }
  if (claim.humanReviewStatus === "changes_requested") return "Resolve requested changes"
  if (claim.humanReviewStatus === "pending" || claim.humanReviewStatus === "in_review") {
    return "Continue human review"
  }
  if (claim.approvalStatus?.toUpperCase() === "REVIEW") return "Resolve required actions"
  if ((claim.riskLevel || "").toUpperCase() === "HIGH") return "Review high-risk evidence"
  return "Open evidence workbench"
}

export default function ClaimsPage() {
  const queryClient = useQueryClient()
  const { user, organization } = useAuth()
  const { openIntake } = useIntakeDialog()
  const [, setLocation] = useLocation()
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: api.getDashboard })
  const canAssign = Boolean(organization?.permissions.includes("claims:assign"))
  const canCreate = Boolean(organization?.permissions.includes("claims:create"))
  const canDelete = Boolean(organization?.permissions.includes("claims:delete"))
  const canSelect = canAssign || canDelete
  const canRetry = Boolean(organization?.permissions.includes("jobs:retry"))
  const assigneesQuery = useQuery({
    queryKey: queryKeys.claimAssignees,
    queryFn: api.getClaimAssignees,
  })
  const savedViewsQuery = useQuery({
    queryKey: queryKeys.savedViews("claims"),
    queryFn: () => api.getSavedViews("claims"),
  })
  const [search, setSearch] = useState("")
  const [carrier, setCarrier] = useState(
    () => new URLSearchParams(window.location.search).get("carrier") || "all",
  )
  const [status, setStatus] = useState(
    () => new URLSearchParams(window.location.search).get("status") || "all",
  )
  const [risk, setRisk] = useState(
    () => new URLSearchParams(window.location.search).get("risk") || "all",
  )
  const [readiness, setReadiness] = useState(
    () => new URLSearchParams(window.location.search).get("readiness") || "all",
  )
  const [sort, setSort] = useState<SortKey>("received")
  const [density, setDensity] = useState<Density>("comfortable")
  const [visibleColumns, setVisibleColumns] = useState<OptionalColumn[]>(DEFAULT_COLUMNS)
  const [preset, setPreset] = useState<Preset>(() => {
    const params = new URLSearchParams(window.location.search)
    return ["carrier", "status", "risk", "readiness"].some((key) => params.has(key))
      ? "custom"
      : "all"
  })
  const [page, setPage] = useState(1)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [viewName, setViewName] = useState("")
  const [savingView, setSavingView] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [queueMessage, setQueueMessage] = useState<string | null>(null)
  const [archiveTargets, setArchiveTargets] = useState<ArchiveClaimTarget[]>([])

  const deferredSearch = useDeferredValue(search)
  const queueFilters = useMemo(
    () => ({
      page,
      pageSize: PER_PAGE,
      search: deferredSearch,
      carrier,
      status,
      risk,
      readiness,
      preset,
      sort,
    }),
    [carrier, deferredSearch, page, preset, readiness, risk, sort, status],
  )
  const claimsQuery = useQuery({
    queryKey: queryKeys.claimsQueue(queueFilters),
    queryFn: () => api.getClaimsQueue(queueFilters),
    placeholderData: (previous) => previous,
  })
  const allClaims = claimsQuery.data?.items || []
  const carriers = claimsQuery.data?.facets.carriers || []
  const totalMatches = claimsQuery.data?.total || 0
  const totalPages = Math.max(1, Math.ceil(totalMatches / PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const visibleClaims = allClaims
  const selectableClaims = visibleClaims.filter(
    (claim) => claim.status !== "archived" && claim.systemStatus !== "archived",
  )
  const organizationHasClaims = (dashboard.data?.stats.totalClaims || totalMatches) > 0
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])
  const allVisibleSelected =
    selectableClaims.length > 0
    && selectableClaims.every((claim) => selectedIds.includes(claim.id))

  const applyPreset = (next: Preset) => {
    setPreset(next)
    setCarrier("all")
    setStatus("all")
    setRisk("all")
    setReadiness("all")
    setPage(1)
  }

  const setCustom = (setter: (value: string) => void, value: string) => {
    setter(value)
    setPreset("custom")
    setPage(1)
  }

  const applySavedView = (view: SavedView) => {
    const filters = view.filters || {}
    const readFilter = (key: string, fallback: string) =>
      typeof filters[key] === "string" ? String(filters[key]) : fallback
    setSearch(readFilter("search", ""))
    setCarrier(readFilter("carrier", "all"))
    setStatus(readFilter("status", "all"))
    setRisk(readFilter("risk", "all"))
    setReadiness(readFilter("readiness", "all"))
    const savedSort = typeof view.sort?.key === "string" ? view.sort.key : "received"
    setSort(
      ["received", "claim", "carrier", "score"].includes(savedSort)
        ? (savedSort as SortKey)
        : "received",
    )
    const savedColumns = (view.columns || []).filter((column): column is OptionalColumn =>
      DEFAULT_COLUMNS.includes(column as OptionalColumn),
    )
    setVisibleColumns(view.columns ? savedColumns : DEFAULT_COLUMNS)
    setPreset("custom")
    setPage(1)
    setQueueMessage(`Applied saved view “${view.name}”.`)
  }

  const saveCurrentView = async () => {
    const name = viewName.trim()
    if (!name) return
    setSavingView(true)
    setQueueMessage(null)
    try {
      await api.createSavedView({
        name,
        resourceType: "claims",
        filters: { search, carrier, status, risk, readiness },
        sort: { key: sort, direction: sort === "received" || sort === "score" ? "desc" : "asc" },
        columns: visibleColumns,
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.savedViews("claims") })
      setViewName("")
      setSaveViewOpen(false)
      setQueueMessage(`Saved view “${name}”.`)
    } catch (error) {
      setQueueMessage(apiErrorMessage(error, "The view could not be saved."))
    } finally {
      setSavingView(false)
    }
  }

  const removeSavedView = async (view: SavedView) => {
    setQueueMessage(null)
    try {
      await api.deleteSavedView(view.id)
      await queryClient.invalidateQueries({ queryKey: queryKeys.savedViews("claims") })
      setQueueMessage(`Deleted saved view “${view.name}”.`)
    } catch (error) {
      setQueueMessage(apiErrorMessage(error, "The saved view could not be deleted."))
    }
  }

  const bulkAssign = async (assigneeUserId: string | null) => {
    if (!selectedIds.length) return
    setBulkSaving(true)
    setQueueMessage(null)
    const results = await Promise.allSettled(
      selectedIds.map((claimId) => api.updateAssignment(claimId, assigneeUserId)),
    )
    const failed = results.filter((result) => result.status === "rejected").length
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.claims }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ])
    setBulkSaving(false)
    if (!failed) setSelectedIds([])
    const assigneeName = assigneesQuery.data?.assignees.find(
      (assignee) => assignee.userId === assigneeUserId,
    )?.name
    setQueueMessage(
      failed
        ? `${selectedIds.length - failed} assignments updated; ${failed} failed.`
        : `${selectedIds.length} claim${selectedIds.length === 1 ? "" : "s"} ${
            assigneeUserId ? `assigned to ${assigneeName || "an organization member"}` : "unassigned"
          }.`,
    )
  }

  const openBulkArchive = () => {
    if (selectedIds.length > 100) {
      setQueueMessage("Delete up to 100 claims at a time.")
      return
    }
    setQueueMessage(null)
    setArchiveTargets(
      selectedIds.map((claimId) => {
        const claim = visibleClaims.find((candidate) => candidate.id === claimId)
        return (
          claim || {
            id: claimId,
            claimNumber: claimId,
            insuredName: "Selected on another queue page",
          }
        )
      }),
    )
  }

  const toggleSelected = (claimId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? Array.from(new Set([...current, claimId]))
        : current.filter((id) => id !== claimId),
    )
  }

  const retryClaim = async (claimId: string) => {
    setRetrying((current) => ({ ...current, [claimId]: true }))
    try {
      await api.retryClaim(claimId)
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const result = await api.getProcessingStatus(claimId)
        if (
          result.systemStatus !== "processing" &&
          !["queued", "running"].includes(result.job?.status || "")
        ) {
          break
        }
        await new Promise((resolve) => window.setTimeout(resolve, 3_000))
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.claims }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.claim(claimId) }),
      ])
    } finally {
      setRetrying((current) => ({ ...current, [claimId]: false }))
    }
  }

  const isLoading = claimsQuery.isLoading
  const isError = claimsQuery.isError

  if (isLoading) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="loading"
          title="Opening the operational queue"
          description="Reconciling claim records with current audit readiness."
        />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="ciq-page p-6">
        <PageState
          kind="error"
          title="The claim queue is unavailable"
          description={apiErrorMessage(claimsQuery.error)}
          actionLabel="Retry"
          onAction={() => {
            void dashboard.refetch()
            void claimsQuery.refetch()
          }}
        />
      </div>
    )
  }

  return (
    <div className="ciq-page">
      <PageHeader
        compact
        eyebrow="Operational queue"
        title="Claims"
        description="Triage every intake by workflow state, carrier risk, and evidence readiness."
        meta={
          <>
            <StatusPill
              value="neutral"
              label={`${dashboard.data?.stats.totalClaims ?? totalMatches} current records`}
            />
            <StatusPill
              value="review"
              label={`${dashboard.data?.stats.backlogCount ?? 0} need review`}
              tone="warning"
            />
          </>
        }
      />

      <PageBody>
        <section className="ciq-panel ciq-panel--flush">
          <div className="border-b border-[var(--ciq-border)] px-4 py-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="Queue presets">
              {(
                [
                  ["all", "All claims"],
                  ["mine", "My work"],
                  ["review", "Needs review"],
                  ["processing", "Processing"],
                  ["risk", "High risk"],
                  ["exceptions", "Exceptions"],
                ] as Array<[Preset, string]>
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={`min-h-11 shrink-0 rounded-full border px-4 text-xs font-semibold transition-colors ${
                    preset === value
                      ? "border-[var(--ciq-aubergine)] bg-[var(--ciq-aubergine)] text-white"
                      : "border-[var(--ciq-border)] bg-[var(--ciq-surface)] text-[var(--ciq-ink-muted)] hover:border-[var(--ciq-border-strong)]"
                  }`}
                  onClick={() => applyPreset(value)}
                  aria-pressed={preset === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2 border-b border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] px-4 py-3">
            <div className="ciq-field min-w-52">
              <label htmlFor="saved-claim-view">Saved views</label>
              <select
                id="saved-claim-view"
                className="ciq-control"
                defaultValue=""
                onChange={(event) => {
                  const view = savedViewsQuery.data?.views.find(
                    (candidate) => candidate.id === event.target.value,
                  )
                  if (view) applySavedView(view)
                  event.target.value = ""
                }}
              >
                <option value="">
                  {savedViewsQuery.isLoading ? "Loading saved views…" : "Choose a saved view…"}
                </option>
                {(savedViewsQuery.data?.views || []).map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}{view.isDefault ? " · default" : ""}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={() => setSaveViewOpen(true)}>
              <Save aria-hidden="true" />
              Save current view
            </Button>
            {(savedViewsQuery.data?.views || []).map((view) => (
              <span
                className="inline-flex min-h-11 items-center overflow-hidden rounded-full border border-[var(--ciq-border)] bg-[var(--ciq-surface)]"
                key={view.id}
              >
                <button
                  type="button"
                  className="min-h-11 px-3 text-xs font-semibold text-[var(--ciq-ink)]"
                  onClick={() => applySavedView(view)}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center border-l border-[var(--ciq-border)] text-[var(--ciq-ink-muted)] hover:text-[var(--ciq-critical)]"
                  onClick={() => void removeSavedView(view)}
                  aria-label={`Delete saved view ${view.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>

          <div className="ciq-toolbar">
            <div className="ciq-field ciq-field--grow">
              <label htmlFor="claim-search">Search queue</label>
              <div className="ciq-search">
                <Search aria-hidden="true" />
                <input
                  id="claim-search"
                  type="search"
                  className="ciq-control"
                  placeholder="Claim, insured, carrier, policy…"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                />
              </div>
            </div>
            <QueueSelect
              id="carrier-filter"
              label="Carrier"
              value={carrier}
              onChange={(value) => setCustom(setCarrier, value)}
              options={[["all", "All carriers"], ...carriers.map((value) => [value, value] as [string, string])]}
            />
            <QueueSelect
              id="status-filter"
              label="Workflow"
              value={status}
              onChange={(value) => setCustom(setStatus, value)}
              options={[
                ["all", "All statuses"],
                ["uploaded", "Uploaded"],
                ["processing", "Processing"],
                ["ready", "Ready"],
                ["error", "Error"],
                ["archived", "Archived"],
              ]}
            />
            <QueueSelect
              id="risk-filter"
              label="Risk"
              value={risk}
              onChange={(value) => setCustom(setRisk, value)}
              options={[
                ["all", "All risk"],
                ["HIGH", "High"],
                ["MEDIUM", "Medium"],
                ["LOW", "Low"],
              ]}
            />
            <QueueSelect
              id="readiness-filter"
              label="Readiness"
              value={readiness}
              onChange={(value) => setCustom(setReadiness, value)}
              options={[
                ["all", "All readiness"],
                ["READY", "Ready"],
                ["REVIEW", "Review"],
                ["NOT_READY", "Not ready"],
              ]}
            />
            <QueueSelect
              id="sort-queue"
              label="Sort"
              value={sort}
              onChange={(value) => setSort(value as SortKey)}
              icon={<ArrowDownUp />}
              options={[
                ["received", "Newest received"],
                ["claim", "Claim number"],
                ["carrier", "Carrier"],
                ["score", "Highest score"],
              ]}
            />
            <QueueSelect
              id="density-queue"
              label="Density"
              value={density}
              onChange={(value) => setDensity(value as Density)}
              icon={<LayoutList />}
              options={[
                ["comfortable", "Comfortable"],
                ["compact", "Compact"],
              ]}
            />
            <div className="ciq-field">
              <span className="ciq-label">Columns</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="justify-between">
                    <Columns3 aria-hidden="true" />
                    Configure
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>Visible queue columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {DEFAULT_COLUMNS.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column}
                      checked={visibleColumns.includes(column)}
                      onCheckedChange={(checked) =>
                        setVisibleColumns((current) =>
                          checked
                            ? Array.from(new Set([...current, column]))
                            : current.filter((value) => value !== column),
                        )
                      }
                    >
                      {humanize(column)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-b border-[var(--ciq-border)] px-4 py-2 text-xs text-[var(--ciq-ink-muted)]">
            <span>
              {totalMatches.toLocaleString()} match{totalMatches === 1 ? "" : "es"}
              {preset === "custom" ? " · Custom view" : ` · ${humanize(preset)} view`}
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              Filters use current API values only
            </span>
          </div>

          {(selectedIds.length > 0 || queueMessage) && (
            <div
              className="flex flex-wrap items-center gap-2 border-b border-[var(--ciq-border)] bg-[var(--ciq-info-soft)] px-4 py-2"
              role="status"
              aria-live="polite"
            >
              {selectedIds.length > 0 && (
                <>
                  <strong className="ciq-mono mr-1 text-xs">
                    {selectedIds.length} selected
                  </strong>
                  {canAssign && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!user?.id || bulkSaving}
                        onClick={() => user?.id && void bulkAssign(user.id)}
                      >
                        <UserRoundCheck aria-hidden="true" />
                        Assign to me
                      </Button>
                      <select
                        className="ciq-control min-w-44"
                        defaultValue=""
                        disabled={bulkSaving || assigneesQuery.isLoading}
                        onChange={(event) => {
                          if (event.target.value) void bulkAssign(event.target.value)
                          event.target.value = ""
                        }}
                        aria-label="Assign selected claims to an organization member"
                      >
                        <option value="">Assign to team member…</option>
                        {(assigneesQuery.data?.assignees || []).map((assignee) => (
                          <option key={assignee.userId} value={assignee.userId}>
                            {assignee.name} · {humanize(assignee.role)}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={bulkSaving}
                        onClick={() => void bulkAssign(null)}
                      >
                        Clear assignment
                      </Button>
                    </>
                  )}
                  {canDelete && (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={bulkSaving}
                      onClick={openBulkArchive}
                    >
                      <Trash2 aria-hidden="true" />
                      Delete selected
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={bulkSaving}
                    onClick={() => setSelectedIds([])}
                  >
                    Clear selection
                  </Button>
                </>
              )}
              {queueMessage && (
                <span className="text-xs text-[var(--ciq-ink-muted)]">{queueMessage}</span>
              )}
            </div>
          )}

          {visibleClaims.length ? (
            <>
              <div className="ciq-desktop-table overflow-x-auto">
                <table
                  className={`ciq-table min-w-[1180px] ${density === "compact" ? "ciq-table--compact" : ""}`}
                >
                  <caption>Complete iQ operational claim queue</caption>
                  <thead>
                    <tr>
                      {canSelect && (
                        <th scope="col" className="w-14">
                          <Checkbox
                            checked={allVisibleSelected}
                            disabled={selectableClaims.length === 0}
                            onCheckedChange={(checked) =>
                              setSelectedIds((current) =>
                                checked
                                  ? Array.from(
                                      new Set([
                                        ...current,
                                        ...selectableClaims.map((claim) => claim.id),
                                      ]),
                                    )
                                  : current.filter(
                                      (id) => !selectableClaims.some((claim) => claim.id === id),
                                    ),
                              )
                            }
                            aria-label="Select all claims on this page"
                          />
                        </th>
                      )}
                      <th scope="col">Claim / received</th>
                      <th scope="col">Insured</th>
                      {visibleColumns.includes("carrier") && <th scope="col">Carrier</th>}
                      <th scope="col">System workflow</th>
                      {visibleColumns.includes("ai") && <th scope="col">AI processing</th>}
                      {visibleColumns.includes("human") && <th scope="col">Human review</th>}
                      {visibleColumns.includes("risk") && <th scope="col">Risk</th>}
                      {visibleColumns.includes("score") && <th scope="col">Score</th>}
                      <th scope="col">Next action</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleClaims.map((claim) => (
                      <tr
                        key={claim.id}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.currentTarget !== event.target) return
                          if (event.key === "Enter") {
                            setLocation(`/claims/${claim.id}`)
                          }
                          if (
                            event.key === " "
                            && canSelect
                            && claim.status !== "archived"
                            && claim.systemStatus !== "archived"
                          ) {
                            event.preventDefault()
                            toggleSelected(claim.id, !selectedIds.includes(claim.id))
                          }
                        }}
                        aria-label={`${claim.claimNumber}, ${claim.insuredName}`}
                      >
                        {canSelect && (
                          <td>
                            <Checkbox
                              checked={selectedIds.includes(claim.id)}
                              disabled={
                                claim.status === "archived" || claim.systemStatus === "archived"
                              }
                              onCheckedChange={(checked) => toggleSelected(claim.id, checked === true)}
                              aria-label={`Select claim ${claim.claimNumber}`}
                            />
                          </td>
                        )}
                        <td>
                          <Link className="ciq-link ciq-mono" href={`/claims/${claim.id}`}>
                            {claim.claimNumber}
                          </Link>
                          <span className="mt-0.5 block text-[0.65rem] text-[var(--ciq-ink-muted)]">
                            {formatDate(claim.createdAt)} · {formatAge(claim.createdAt)}
                          </span>
                        </td>
                        <td>
                          <strong className="font-medium">{claim.insuredName}</strong>
                          {claim.dateOfLoss && (
                            <span className="mt-0.5 block text-[0.65rem] text-[var(--ciq-ink-muted)]">
                              Loss {formatDate(claim.dateOfLoss)}
                            </span>
                          )}
                        </td>
                        {visibleColumns.includes("carrier") && (
                          <td>{claim.carrier || <span className="ciq-empty-dash">—</span>}</td>
                        )}
                        <td>
                          <StatusPill value={claim.systemStatus || claim.status} />
                        </td>
                        {visibleColumns.includes("ai") && (
                          <td>
                            {claim.aiStatus ? (
                              <StatusPill value={claim.aiStatus} />
                            ) : (
                              <span className="text-xs text-[var(--ciq-ink-faint)]">Unavailable</span>
                            )}
                          </td>
                        )}
                        {visibleColumns.includes("human") && (
                          <td>
                            {claim.humanReviewStatus ? (
                              <StatusPill value={claim.humanReviewStatus} />
                            ) : (
                              <span className="text-xs text-[var(--ciq-ink-faint)]">Unavailable</span>
                            )}
                          </td>
                        )}
                        {visibleColumns.includes("risk") && (
                          <td>
                            {claim.riskLevel ? (
                              <StatusPill value={claim.riskLevel} />
                            ) : (
                              <span className="ciq-empty-dash">—</span>
                            )}
                          </td>
                        )}
                        {visibleColumns.includes("score") && (
                          <td className="ciq-mono font-semibold">{formatScore(claim.overallScore)}</td>
                        )}
                        <td>
                          {(claim.systemStatus === "error" || claim.aiStatus === "failed" || claim.status === "error") && canRetry ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void retryClaim(claim.id)}
                              disabled={retrying[claim.id]}
                            >
                              <RotateCcw className={retrying[claim.id] ? "animate-spin" : ""} aria-hidden="true" />
                              {retrying[claim.id] ? "Retrying" : "Retry"}
                            </Button>
                          ) : (
                            <Link className="ciq-link text-xs" href={`/claims/${claim.id}`}>
                              {nextAction(claim, canRetry)}
                            </Link>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setPreviewId(claim.id)}
                              aria-label={`Preview ${claim.claimNumber}`}
                            >
                              <Eye aria-hidden="true" />
                            </Button>
                            {canDelete
                              && claim.status !== "archived"
                              && claim.systemStatus !== "archived" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-[var(--ciq-critical)] hover:bg-[var(--ciq-critical-soft)] hover:text-[var(--ciq-critical)]"
                                  onClick={() => setArchiveTargets([claim])}
                                  aria-label={`Delete claim ${claim.claimNumber}`}
                                >
                                  <Trash2 aria-hidden="true" />
                                </Button>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="ciq-mobile-card-list">
                {visibleClaims.map((claim) => (
                  <article
                    key={claim.id}
                    className="rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      {canSelect && (
                        <Checkbox
                          checked={selectedIds.includes(claim.id)}
                          disabled={claim.status === "archived" || claim.systemStatus === "archived"}
                          onCheckedChange={(checked) => toggleSelected(claim.id, checked === true)}
                          aria-label={`Select claim ${claim.claimNumber}`}
                          className="-ml-2 -mt-2"
                        />
                      )}
                      <div className="min-w-0">
                        <Link className="ciq-link ciq-mono text-sm" href={`/claims/${claim.id}`}>
                          {claim.claimNumber}
                        </Link>
                        <p className="mt-1 truncate text-sm font-semibold">{claim.insuredName}</p>
                        <p className="mt-0.5 text-xs text-[var(--ciq-ink-muted)]">
                          {claim.carrier || "Carrier unavailable"} · {formatAge(claim.createdAt)}
                        </p>
                      </div>
                      <span className="ciq-mono text-sm font-semibold">
                        {formatScore(claim.overallScore)}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <StatusPill value={claim.systemStatus || claim.status} />
                      {claim.aiStatus && <StatusPill value={claim.aiStatus} />}
                      {claim.humanReviewStatus && <StatusPill value={claim.humanReviewStatus} />}
                      {claim.riskLevel && <StatusPill value={claim.riskLevel} />}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => setPreviewId(claim.id)}>
                        <Eye aria-hidden="true" />
                        Preview
                      </Button>
                      <Button className="flex-1" asChild>
                        <Link href={`/claims/${claim.id}`}>
                          Review
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </Button>
                      {canDelete
                        && claim.status !== "archived"
                        && claim.systemStatus !== "archived" && (
                          <Button
                            variant="outline"
                            className="w-full border-[var(--ciq-critical)]/30 text-[var(--ciq-critical)] hover:bg-[var(--ciq-critical-soft)] hover:text-[var(--ciq-critical)]"
                            onClick={() => setArchiveTargets([claim])}
                          >
                            <Trash2 aria-hidden="true" />
                            Delete claim
                          </Button>
                        )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="p-4">
              <PageState
                kind={organizationHasClaims ? "empty" : "unavailable"}
                title={
                  organizationHasClaims
                    ? "No claims match this view"
                    : "No active claims in the queue"
                }
                description={
                  organizationHasClaims
                    ? "Adjust the current filters or return to the full queue."
                    : "Start an intake, or choose Archived in the Workflow filter to review retained records."
                }
                actionLabel={
                  organizationHasClaims
                    ? "Clear filters"
                    : canCreate
                      ? "Start intake"
                      : undefined
                }
                onAction={
                  organizationHasClaims
                    ? () => applyPreset("all")
                    : canCreate
                      ? openIntake
                      : undefined
                }
              />
            </div>
          )}

          {totalMatches > 0 && (
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] px-4 py-3 text-xs text-[var(--ciq-ink-muted)]">
              <span>
                {(currentPage - 1) * PER_PAGE + 1}–
                {Math.min(currentPage * PER_PAGE, totalMatches)} of {totalMatches}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <span className="ciq-mono px-1">
                  {currentPage}/{totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </footer>
          )}
        </section>
      </PageBody>

      <Dialog open={saveViewOpen} onOpenChange={(open) => !savingView && setSaveViewOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this queue view</DialogTitle>
            <DialogDescription>
              Save the current search, filters, and sort order to your account in this organization.
            </DialogDescription>
          </DialogHeader>
          <div className="ciq-field">
            <label htmlFor="saved-view-name">View name</label>
            <input
              id="saved-view-name"
              className="ciq-control"
              value={viewName}
              maxLength={100}
              onChange={(event) => setViewName(event.target.value)}
              placeholder="Example: High-risk review queue"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveViewOpen(false)} disabled={savingView}>
              Cancel
            </Button>
            <Button onClick={() => void saveCurrentView()} disabled={!viewName.trim() || savingView}>
              <Save aria-hidden="true" />
              {savingView ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClaimPreview claimId={previewId} onOpenChange={(open) => !open && setPreviewId(null)} />
      <ArchiveClaimsDialog
        open={archiveTargets.length > 0}
        claims={archiveTargets}
        onOpenChange={(open) => {
          if (!open) setArchiveTargets([])
        }}
        onArchived={(result) => {
          const archivedIds = new Set(archiveTargets.map((claim) => claim.id))
          setSelectedIds((current) => current.filter((claimId) => !archivedIds.has(claimId)))
          setQueueMessage(result.message)
        }}
      />
    </div>
  )
}

function QueueSelect({
  id,
  label,
  value,
  onChange,
  options,
  icon,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
  icon?: React.ReactNode
}) {
  return (
    <div className="ciq-field">
      <label htmlFor={id} className="flex items-center gap-1.5">
        {icon && <span className="[&_svg]:h-3 [&_svg]:w-3">{icon}</span>}
        {label}
      </label>
      <select
        id={id}
        className="ciq-control"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  )
}

function ClaimPreview({
  claimId,
  onOpenChange,
}: {
  claimId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const detail = useQuery({
    queryKey: queryKeys.claim(claimId || "preview"),
    queryFn: () => api.getClaim(claimId!),
    enabled: Boolean(claimId),
  })

  return (
    <Sheet open={Boolean(claimId)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-8 text-left">
          <span className="ciq-eyebrow !mb-1 !text-[var(--ciq-financial)]">Claim preview</span>
          <SheetTitle className="font-[var(--ciq-font-serif)] text-2xl">
            {detail.data?.claim.claimNumber || "Loading record…"}
          </SheetTitle>
          <SheetDescription>
            A concise view of the source record and current audit readiness.
          </SheetDescription>
        </SheetHeader>
        {detail.isLoading && (
          <div className="mt-6">
            <PageState kind="loading" title="Loading preview" />
          </div>
        )}
        {detail.isError && (
          <div className="mt-6">
            <PageState
              kind="error"
              title="Preview unavailable"
              description={apiErrorMessage(detail.error)}
              actionLabel="Retry"
              onAction={() => void detail.refetch()}
            />
          </div>
        )}
        {detail.data && (
          <div className="mt-6 space-y-5">
            <div className="flex flex-wrap gap-2">
              <StatusPill value={detail.data.claim.status} />
              {detail.data.claim.aiStatus && <StatusPill value={detail.data.claim.aiStatus} />}
              {detail.data.claim.humanReviewStatus && (
                <StatusPill value={detail.data.claim.humanReviewStatus} />
              )}
              {detail.data.audit?.technicalRisk && (
                <StatusPill value={detail.data.audit.technicalRisk} />
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface-subtle)] p-4">
              <PreviewField label="Insured" value={detail.data.claim.insuredName} />
              <PreviewField label="Carrier" value={detail.data.claim.carrier || "Unavailable"} />
              <PreviewField label="Date of loss" value={formatDate(detail.data.claim.dateOfLoss)} />
              <PreviewField
                label="Audit score"
                value={formatScore(detail.data.audit?.overallScore)}
                mono
              />
              <PreviewField
                label="Documents"
                value={String(detail.data.documents.length)}
                mono
              />
              <PreviewField
                label="Required actions"
                value={
                  detail.data.audit?.actionRequiredCount === undefined
                    ? "Unavailable"
                    : String(detail.data.audit.actionRequiredCount)
                }
                mono
              />
            </dl>
            {detail.data.audit?.executiveSummary && (
              <div>
                <h3 className="ciq-section-title">Audit summary</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">
                  {detail.data.audit.executiveSummary}
                </p>
              </div>
            )}
            <div className="border-t border-[var(--ciq-border)] pt-4">
              <Button className="w-full" asChild>
                <Link href={`/claims/${detail.data.claim.id}`}>
                  Open evidence workbench
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function PreviewField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--ciq-ink-muted)]">
        {label}
      </dt>
      <dd className={`mt-1 text-sm font-semibold ${mono ? "ciq-mono" : ""}`}>{value}</dd>
    </div>
  )
}

function formatAge(value?: string | null) {
  if (!value) return "age unavailable"
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return "age unavailable"
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000))
  if (days === 0) return "received today"
  return `${days}d old`
}
