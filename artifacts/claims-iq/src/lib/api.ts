import type {
  AuthSession,
  AuthUser,
  CarrierOption,
  CarrierPreflightResult,
  CarrierProfile,
  CarrierRulesetVersion,
  ClaimDetail,
  ClaimSummary,
  ClaimsQueueData,
  ClaimAssignee,
  DashboardData,
  DocumentRenditionManifest,
  IngestResponse,
  FindingDisposition,
  HumanReviewStatus,
  InsightsData,
  ClaimActivity,
  ProcessingJob,
  ProcessingStatus,
  PromptSettings,
  SavedView,
  SettingsOverview,
  OrganizationSettingsInput,
  InvitationPreview,
  AccessibleOrganization,
} from "@/lib/types"

export const API_BASE_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "")
export const SESSION_EXPIRED_EVENT = "complete-iq:session-expired"
let authenticatedQueryScope = {
  userId: "anonymous",
  organizationId: "no-organization",
}
let authenticatedQueryVersion = 0

export class ApiError extends Error {
  status: number
  details?: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.details = details
  }
}

function endpoint(path: string) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const requestQueryVersion = authenticatedQueryVersion
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  headers.delete("X-Organization-Id")

  let response: Response
  try {
    response = await fetch(endpoint(path), {
      ...init,
      headers,
      credentials: "include",
    })
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? error.message : "The service could not be reached.",
      0,
      error,
    )
  }

  if (requestQueryVersion !== authenticatedQueryVersion) {
    throw new ApiError("The tenant context changed before this request completed.", 409)
  }

  if (response.status === 204) return undefined as T

  const contentType = response.headers.get("content-type") || ""
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => undefined)
    : await response.text().catch(() => undefined)

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : typeof body === "string" && body
          ? body
          : `Request failed (${response.status})`
    if (
      response.status === 401
      && path !== "/auth/login"
      && path !== "/auth/user"
      && typeof window !== "undefined"
    ) {
      window.sessionStorage.setItem(SESSION_EXPIRED_EVENT, "true")
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    }
    throw new ApiError(message, response.status, body)
  }

  if (requestQueryVersion !== authenticatedQueryVersion) {
    throw new ApiError("The tenant context changed before this request completed.", 409)
  }

  return body as T
}

export function setAuthenticatedQueryScope(
  userId: string | null | undefined,
  organizationId: string | null | undefined,
): void {
  const nextScope = {
    userId: userId || "anonymous",
    organizationId: organizationId || "no-organization",
  }
  if (
    nextScope.userId !== authenticatedQueryScope.userId
    || nextScope.organizationId !== authenticatedQueryScope.organizationId
  ) {
    authenticatedQueryVersion += 1
  }
  authenticatedQueryScope = nextScope
}

function scopedQueryKey(...parts: unknown[]) {
  return [
    "complete-iq",
    "session",
    authenticatedQueryScope.userId,
    authenticatedQueryScope.organizationId,
    ...parts,
  ] as const
}

export const queryKeys = {
  get dashboard() {
    return scopedQueryKey("dashboard")
  },
  get insights() {
    return scopedQueryKey("insights")
  },
  get claims() {
    return scopedQueryKey("claims")
  },
  claimsQueue: (filters: Record<string, string | number>) =>
    scopedQueryKey("claims", "queue", filters),
  get claimAssignees() {
    return scopedQueryKey("claims", "assignees")
  },
  claim: (id: string) => scopedQueryKey("claim", id),
  claimActivity: (id: string) => scopedQueryKey("claim", id, "activity"),
  claimJobs: (id: string) => scopedQueryKey("claim", id, "jobs"),
  documentRenditions: (id: string) =>
    scopedQueryKey("document", id, "renditions"),
  savedViews: (resourceType = "claims") =>
    scopedQueryKey("saved-views", resourceType),
  get carriers() {
    return scopedQueryKey("carriers")
  },
  carrier: (key: string) => scopedQueryKey("carrier", key),
  carrierVersions: (key: string) => scopedQueryKey("carrier", key, "versions"),
  get prompts() {
    return scopedQueryKey("settings", "prompts")
  },
  get settingsOverview() {
    return scopedQueryKey("settings", "overview")
  },
  get organizations() {
    return scopedQueryKey("organizations")
  },
}

export const api = {
  getSession: () => apiRequest<AuthSession>("/auth/user"),
  login: (email: string, password: string) =>
    apiRequest<{ user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => apiRequest<void>("/auth/logout", { method: "POST" }),
  getOrganizations: () =>
    apiRequest<AccessibleOrganization[]>("/auth/organizations"),
  switchOrganization: (organizationId: string) =>
    apiRequest<AuthSession>("/auth/active-organization", {
      method: "POST",
      body: JSON.stringify({ organizationId }),
    }),
  forgotPassword: (email: string) =>
    apiRequest<{ message: string }>("/auth/password/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  inspectPasswordReset: (token: string) =>
    apiRequest<{ valid: true }>("/auth/password/reset/inspect", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  resetPassword: (token: string, password: string) =>
    apiRequest<{ success: true }>("/auth/password/reset", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest<{ success: true }>("/auth/password/change", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  inspectInvitation: (token: string) =>
    apiRequest<InvitationPreview>("/auth/invitations/inspect", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  acceptInvitation: (
    token: string,
    input: {
      password: string
      firstName?: string
      lastName?: string
    },
  ) =>
    apiRequest<{ success: true; organizationId: string }>("/auth/invitations/accept", {
      method: "POST",
      body: JSON.stringify({ token, ...input }),
    }),

  getDashboard: () => apiRequest<DashboardData>("/dashboard"),
  getInsights: () => apiRequest<InsightsData>("/insights"),
  getClaims: (limit = 100, offset = 0) =>
    apiRequest<ClaimSummary[]>(`/claims?limit=${limit}&offset=${offset}`),
  getClaimsQueue: (filters: {
    page: number
    pageSize: number
    search: string
    carrier: string
    status: string
    risk: string
    readiness: string
    preset: string
    sort: string
  }) => {
    const params = new URLSearchParams(
      Object.entries(filters).map(([key, value]) => [key, String(value)]),
    )
    return apiRequest<ClaimsQueueData>(`/claims/queue?${params.toString()}`)
  },
  getClaimAssignees: () =>
    apiRequest<{ assignees: ClaimAssignee[] }>("/claims/assignees"),
  getClaim: (id: string) => apiRequest<ClaimDetail>(`/claims/${encodeURIComponent(id)}`),
  archiveClaims: (claimIds: string[]) =>
    apiRequest<{
      success: boolean
      message: string
      archivedCount: number
      alreadyArchivedCount: number
      claimIds: string[]
    }>("/claims/archive", {
      method: "POST",
      body: JSON.stringify({ claimIds }),
    }),
  archiveClaim: (id: string) =>
    apiRequest<{ success: boolean; message?: string }>(`/claims/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  runAudit: (id: string) =>
    apiRequest<{ success: boolean; auditId: string; overallScore: number }>(
      `/claims/${encodeURIComponent(id)}/audit`,
      { method: "POST" },
    ),
  retryClaim: (id: string) =>
    apiRequest<{ job: ProcessingJob; duplicate?: boolean }>(`/claims/${encodeURIComponent(id)}/retry`, {
      method: "POST",
    }),
  reprocessClaim: (id: string, carrierEntityId?: string) =>
    apiRequest<{ job: ProcessingJob; duplicate?: boolean }>(
      `/claims/${encodeURIComponent(id)}/reprocess`,
      {
        method: "POST",
        body: JSON.stringify(carrierEntityId ? { carrierEntityId } : {}),
      },
    ),
  getProcessingStatus: (id: string) =>
    apiRequest<ProcessingStatus>(`/claims/${encodeURIComponent(id)}/processing-status`),
  getClaimJobs: (id: string) =>
    apiRequest<{ jobs: ProcessingJob[] }>(`/claims/${encodeURIComponent(id)}/processing-jobs`),
  cancelJob: (jobId: string) =>
    apiRequest<{ job: ProcessingJob }>(
      `/processing-jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: "POST" },
    ),
  getClaimActivity: (id: string, limit = 100) =>
    apiRequest<{ activity: ClaimActivity[] }>(
      `/claims/${encodeURIComponent(id)}/activity?limit=${limit}`,
    ),
  getSavedViews: (resourceType = "claims") =>
    apiRequest<{ views: SavedView[] }>(
      `/saved-views?resourceType=${encodeURIComponent(resourceType)}`,
    ),
  createSavedView: (input: {
    name: string
    resourceType?: string
    filters: Record<string, unknown>
    sort: Record<string, unknown>
    columns?: string[] | null
    isDefault?: boolean
  }) =>
    apiRequest<SavedView>("/saved-views", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteSavedView: (viewId: string) =>
    apiRequest<{ success: boolean }>(
      `/saved-views/${encodeURIComponent(viewId)}`,
      { method: "DELETE" },
    ),
  updateAssignment: (id: string, assigneeUserId: string | null) =>
    apiRequest<{ assigneeUserId: string | null; humanReviewStatus: HumanReviewStatus }>(
      `/claims/${encodeURIComponent(id)}/assignment`,
      {
        method: "PATCH",
        body: JSON.stringify({ assigneeUserId }),
      },
    ),
  updateReviewStatus: (id: string, status: HumanReviewStatus) =>
    apiRequest<{ humanReviewStatus: HumanReviewStatus }>(
      `/claims/${encodeURIComponent(id)}/review-status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status }),
      },
    ),
  updateFinding: (
    claimId: string,
    findingId: string,
    input: {
      disposition: FindingDisposition
      notes?: string | null
      overrideReason?: string | null
    },
  ) =>
    apiRequest<{
      id: string
      disposition: FindingDisposition
      reviewNotes?: string | null
      overrideReason?: string | null
      reviewedAt?: string | null
    }>(`/claims/${encodeURIComponent(claimId)}/findings/${encodeURIComponent(findingId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  ingest: (file: File, carrierEntityId?: string) => {
    const body = new FormData()
    body.append("file", file)
    if (carrierEntityId) body.append("carrierEntityId", carrierEntityId)
    return apiRequest<IngestResponse>("/ingest", { method: "POST", body })
  },
  getDocumentRenditions: (documentId: string) =>
    apiRequest<DocumentRenditionManifest>(
      `/documents/${encodeURIComponent(documentId)}/renditions`,
    ),
  prepareDocumentRenditions: (documentId: string) =>
    apiRequest<DocumentRenditionManifest>(
      `/documents/${encodeURIComponent(documentId)}/renditions`,
      { method: "POST" },
    ),
  documentPageUrl: (documentId: string, pageNumber: number, version?: string) =>
    endpoint(
      `/documents/${encodeURIComponent(documentId)}/renditions/${pageNumber}${
        version ? `?v=${encodeURIComponent(version)}` : ""
      }`,
    ),
  documentDownloadUrl: (documentId: string) =>
    endpoint(`/documents/${encodeURIComponent(documentId)}/download`),
  getEmailPreview: (id: string) =>
    apiRequest<{ html: string }>(`/claims/${encodeURIComponent(id)}/email`),
  sendEmail: (id: string, to: string) =>
    apiRequest<{ success: boolean }>(`/claims/${encodeURIComponent(id)}/email/send`, {
      method: "POST",
      body: JSON.stringify({ to }),
    }),
  reportUrl: (id: string) => endpoint(`/claims/${encodeURIComponent(id)}/download`),

  getCarrierOptions: () => apiRequest<CarrierOption[]>("/carriers"),
  getCarriers: () => apiRequest<CarrierProfile[]>("/platform/carriers"),
  getCarrier: (key: string) =>
    apiRequest<CarrierProfile>(`/platform/carriers/${encodeURIComponent(key)}`),
  saveCarrier: (
    key: string,
    input: Pick<
      CarrierProfile,
      "displayName" | "logoUrl" | "active" | "ruleset" | "sourceReferences" | "changeSummary"
    >,
  ) =>
    apiRequest<{ success: boolean; version: CarrierRulesetVersion }>(
      `/platform/carriers/${encodeURIComponent(key)}`,
      {
      method: "PUT",
      body: JSON.stringify(input),
      },
    ),
  getCarrierVersions: (key: string) =>
    apiRequest<{ versions: CarrierRulesetVersion[]; affectedClaimCount: number }>(
      `/platform/carriers/${encodeURIComponent(key)}/versions`,
    ),
  publishCarrierVersion: (key: string, versionId: string) =>
    apiRequest<{ version: CarrierRulesetVersion }>(
      `/platform/carriers/${encodeURIComponent(key)}/versions/${encodeURIComponent(versionId)}/publish`,
      { method: "POST" },
    ),
  rollbackCarrierVersion: (key: string, versionId: string) =>
    apiRequest<{ version: CarrierRulesetVersion }>(
      `/platform/carriers/${encodeURIComponent(key)}/versions/${encodeURIComponent(versionId)}/rollback`,
      { method: "POST" },
    ),
  testCarrierVersion: (key: string, claimId: string, versionId?: string) =>
    apiRequest<CarrierPreflightResult>(`/platform/carriers/${encodeURIComponent(key)}/test`, {
      method: "POST",
      body: JSON.stringify({ claimId, versionId }),
    }),
  deleteCarrier: (key: string) =>
    apiRequest<{ success: boolean }>(`/platform/carriers/${encodeURIComponent(key)}`, {
      method: "DELETE",
    }),

  getPrompts: () => apiRequest<PromptSettings>("/settings/prompts"),
  getSettingsOverview: () => apiRequest<SettingsOverview>("/settings/overview"),
  updateOrganizationSettings: (input: OrganizationSettingsInput) =>
    apiRequest<SettingsOverview["organizationSettings"]>("/settings/organization", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  updateMemberRole: (membershipId: string, role: string) =>
    apiRequest<{ membershipId: string; userId: string; role: string }>(
      `/settings/members/${encodeURIComponent(membershipId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ role }),
      },
    ),
  inviteMember: (email: string, role: string) =>
    apiRequest<SettingsOverview["invitations"][number]>("/settings/invitations", {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),
  resendInvitation: (invitationId: string) =>
    apiRequest<{
      id: string
      status: "pending"
      expiresAt: string
      lastSentAt: string
    }>(`/settings/invitations/${encodeURIComponent(invitationId)}/resend`, {
      method: "POST",
    }),
  revokeInvitation: (invitationId: string) =>
    apiRequest<void>(`/settings/invitations/${encodeURIComponent(invitationId)}`, {
      method: "DELETE",
    }),
  sendMemberPasswordReset: (membershipId: string) =>
    apiRequest<{ message: string; expiresAt: string }>(
      `/settings/members/${encodeURIComponent(membershipId)}/password-reset`,
      { method: "POST" },
    ),
  savePrompts: (prompts: PromptSettings) =>
    apiRequest<{ success: boolean }>("/settings/prompts", {
      method: "PUT",
      body: JSON.stringify(prompts),
    }),
  resetPrompts: () =>
    apiRequest<PromptSettings & { success: boolean }>("/settings/prompts/reset", {
      method: "POST",
    }),
}

export function apiErrorMessage(error: unknown, fallback = "Something went wrong.") {
  return error instanceof Error && error.message ? error.message : fallback
}
