import type {
  AuthSession,
  AuthUser,
  CarrierOption,
  CarrierProfile,
  ClaimDetail,
  ClaimSummary,
  DashboardData,
  IngestResponse,
  FindingDisposition,
  HumanReviewStatus,
  ClaimActivity,
  ProcessingJob,
  ProcessingStatus,
  PromptSettings,
} from "@/lib/types"

export const API_BASE_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "")

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
    throw new ApiError(message, response.status, body)
  }

  return body as T
}

export const queryKeys = {
  dashboard: ["complete-iq", "dashboard"] as const,
  claims: ["complete-iq", "claims"] as const,
  claim: (id: string) => ["complete-iq", "claim", id] as const,
  claimActivity: (id: string) => ["complete-iq", "claim", id, "activity"] as const,
  claimJobs: (id: string) => ["complete-iq", "claim", id, "jobs"] as const,
  carriers: ["complete-iq", "carriers"] as const,
  carrier: (key: string) => ["complete-iq", "carrier", key] as const,
  prompts: ["complete-iq", "settings", "prompts"] as const,
}

export const api = {
  getSession: () => apiRequest<AuthSession>("/auth/user"),
  login: (email: string, password: string) =>
    apiRequest<{ user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => apiRequest<void>("/auth/logout", { method: "POST" }),

  getDashboard: () => apiRequest<DashboardData>("/dashboard"),
  getClaims: (limit = 100, offset = 0) =>
    apiRequest<ClaimSummary[]>(`/claims?limit=${limit}&offset=${offset}`),
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
  getClaimActivity: (id: string, limit = 100) =>
    apiRequest<{ activity: ClaimActivity[] }>(
      `/claims/${encodeURIComponent(id)}/activity?limit=${limit}`,
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
    input: Pick<CarrierProfile, "displayName" | "logoUrl" | "active" | "ruleset">,
  ) =>
    apiRequest<{ success: boolean }>(`/carriers/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteCarrier: (key: string) =>
    apiRequest<{ success: boolean }>(`/carriers/${encodeURIComponent(key)}`, {
      method: "DELETE",
    }),

  getPrompts: () => apiRequest<PromptSettings>("/settings/prompts"),
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
