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
} from "@/lib/types"

export const API_BASE_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "")
export const SESSION_EXPIRED_EVENT = "complete-iq:session-expired"
const SELECTED_ORGANIZATION_KEY = "complete-iq:selected-organization"

export function getSelectedOrganizationId(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_ORGANIZATION_KEY)
  } catch {
    return null
  }
}

export function setSelectedOrganizationId(organizationId: string | null): void {
  try {
    if (organizationId) {
      window.localStorage.setItem(SELECTED_ORGANIZATION_KEY, organizationId)
    } else {
      window.localStorage.removeItem(SELECTED_ORGANIZATION_KEY)
    }
  } catch {
    // The server will fall back to the user's default membership.
  }
}

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
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  const selectedOrganizationId =
    typeof window !== "undefined" ? getSelectedOrganizationId() : null
  if (selectedOrganizationId && !headers.has("X-Organization-Id")) {
    headers.set("X-Organization-Id", selectedOrganizationId)
  }

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

  return body as T
}

export const queryKeys = {
  dashboard: ["complete-iq", "dashboard"] as const,
  insights: ["complete-iq", "insights"] as const,
  claims: ["complete-iq", "claims"] as const,
  claimsQueue: (filters: Record<string, string | number>) =>
    ["complete-iq", "claims", "queue", filters] as const,
  claimAssignees: ["complete-iq", "claims", "assignees"] as const,
  claim: (id: string) => ["complete-iq", "claim", id] as const,
  claimActivity: (id: string) => ["complete-iq", "claim", id, "activity"] as const,
  claimJobs: (id: string) => ["complete-iq", "claim", id, "jobs"] as const,
  savedViews: (resourceType = "claims") =>
    ["complete-iq", "saved-views", resourceType] as const,
  carriers: ["complete-iq", "carriers"] as const,
  carrier: (key: string) => ["complete-iq", "carrier", key] as const,
  carrierVersions: (key: string) => ["complete-iq", "carrier", key, "versions"] as const,
  prompts: ["complete-iq", "settings", "prompts"] as const,
  settingsOverview: ["complete-iq", "settings", "overview"] as const,
}

export const api = {
  getSession: () => apiRequest<AuthSession>("/auth/user"),
  login: (email: string, password: string) =>
    apiRequest<{ user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => apiRequest<void>("/auth/logout", { method: "POST" }),
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
  reprocessClaim: (id: string, carrier: string) =>
    apiRequest<{ job: ProcessingJob; duplicate?: boolean }>(
      `/claims/${encodeURIComponent(id)}/reprocess`,
      {
        method: "POST",
        body: JSON.stringify({ carrier }),
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
  ingest: (file: File, carrier?: string) => {
    const body = new FormData()
    body.append("file", file)
    if (carrier) body.append("carrier", carrier)
    return apiRequest<IngestResponse>("/ingest", { method: "POST", body })
  },
  getEmailPreview: (id: string) =>
    apiRequest<{ html: string }>(`/claims/${encodeURIComponent(id)}/email`),
  sendEmail: (id: string, to: string) =>
    apiRequest<{ success: boolean }>(`/claims/${encodeURIComponent(id)}/email/send`, {
      method: "POST",
      body: JSON.stringify({ to }),
    }),
  reportUrl: (id: string) => endpoint(`/claims/${encodeURIComponent(id)}/download`),

  getCarrierOptions: () => apiRequest<CarrierOption[]>("/carriers"),
  getCarriers: () => apiRequest<CarrierProfile[]>("/carriers/all"),
  getCarrier: (key: string) =>
    apiRequest<CarrierProfile>(`/carriers/${encodeURIComponent(key)}`),
  saveCarrier: (
    key: string,
    input: Pick<
      CarrierProfile,
      "displayName" | "logoUrl" | "active" | "ruleset" | "sourceReferences" | "changeSummary"
    >,
  ) =>
    apiRequest<{ success: boolean; version: CarrierRulesetVersion }>(
      `/carriers/${encodeURIComponent(key)}`,
      {
      method: "PUT",
      body: JSON.stringify(input),
      },
    ),
  getCarrierVersions: (key: string) =>
    apiRequest<{ versions: CarrierRulesetVersion[]; affectedClaimCount: number }>(
      `/carriers/${encodeURIComponent(key)}/versions`,
    ),
  publishCarrierVersion: (key: string, versionId: string) =>
    apiRequest<{ version: CarrierRulesetVersion }>(
      `/carriers/${encodeURIComponent(key)}/versions/${encodeURIComponent(versionId)}/publish`,
      { method: "POST" },
    ),
  rollbackCarrierVersion: (key: string, versionId: string) =>
    apiRequest<{ version: CarrierRulesetVersion }>(
      `/carriers/${encodeURIComponent(key)}/versions/${encodeURIComponent(versionId)}/rollback`,
      { method: "POST" },
    ),
  testCarrierVersion: (key: string, claimId: string, versionId?: string) =>
    apiRequest<CarrierPreflightResult>(`/carriers/${encodeURIComponent(key)}/test`, {
      method: "POST",
      body: JSON.stringify({ claimId, versionId }),
    }),
  deleteCarrier: (key: string) =>
    apiRequest<{ success: boolean }>(`/carriers/${encodeURIComponent(key)}`, {
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
