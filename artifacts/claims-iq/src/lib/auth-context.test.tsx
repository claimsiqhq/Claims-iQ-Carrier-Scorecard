import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AuthProvider, useAuth } from "@/lib/auth-context"
import { queryKeys } from "@/lib/api"
import { intakeRecoveryKey } from "@/lib/tenant-state"
import type { AuthSession } from "@/lib/types"

const reviewerUser = {
  id: "reviewer-user",
  email: "reviewer@example.com",
  firstName: "Riley",
  lastName: "Reviewer",
  profileImageUrl: null,
  role: "reviewer",
  platformRole: "none" as const,
}

const allstateSession: AuthSession = {
  user: reviewerUser,
  organization: {
    id: "org-allstate",
    name: "Allstate",
    role: "reviewer",
    permissions: ["claims:read", "claims:create"],
    accessMode: "membership",
    accessExpiresAt: null,
  },
}

const andoverSession: AuthSession = {
  user: reviewerUser,
  organization: {
    id: "org-andover",
    name: "Andover Companies",
    role: "admin",
    permissions: ["claims:read", "claims:create", "settings:manage"],
    accessMode: "membership",
    accessExpiresAt: null,
  },
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }))
}

function AuthHarness() {
  const {
    loading,
    organization,
    isTenantAdmin,
    canManageSettings,
    switchTenant,
  } = useAuth()
  if (loading) return <span>Loading</span>

  return (
    <div>
      <span>{organization?.name || "Outside tenant"}</span>
      <span>Tenant admin: {isTenantAdmin ? "yes" : "no"}</span>
      <span>Settings: {canManageSettings ? "yes" : "no"}</span>
      <button type="button" onClick={() => void switchTenant("org-andover")}>
        Switch to Andover
      </button>
    </div>
  )
}

describe("AuthProvider tenant transitions", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("clears query and upload recovery state when switching tenants", async () => {
    let session = allstateSession
    const switchRequests: Array<{ organizationId: string }> = []
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      if (url.pathname === "/api/auth/user") return jsonResponse(session)
      if (url.pathname === "/api/auth/active-organization" && init?.method === "POST") {
        switchRequests.push(JSON.parse(String(init.body)) as { organizationId: string })
        session = andoverSession
        return jsonResponse(session)
      }
      return jsonResponse({ error: "Unhandled test endpoint" }, 404)
    })
    vi.stubGlobal("fetch", fetchMock)

    const queryClient = new QueryClient()
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthHarness />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await screen.findByText("Allstate")
    expect(screen.getByText("Settings: no")).toBeInTheDocument()

    const recoveryKey = intakeRecoveryKey(reviewerUser.id, allstateSession.organization?.id)
    expect(recoveryKey).not.toBeNull()
    queryClient.setQueryData(["tenant", "allstate", "claims"], { secret: true })
    window.localStorage.setItem(recoveryKey!, JSON.stringify([{ claimId: "claim-1" }]))

    await user.click(screen.getByRole("button", { name: "Switch to Andover" }))
    await screen.findByText("Andover Companies")
    expect(screen.getByText("Tenant admin: yes")).toBeInTheDocument()
    expect(screen.getByText("Settings: yes")).toBeInTheDocument()
    expect(switchRequests).toEqual([{ organizationId: "org-andover" }])

    await waitFor(() => {
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(window.localStorage.getItem(recoveryKey!)).toBeNull()
      expect(queryKeys.dashboard).toEqual([
        "complete-iq",
        "session",
        "reviewer-user",
        "org-andover",
        "dashboard",
      ])
    })
  })
})
