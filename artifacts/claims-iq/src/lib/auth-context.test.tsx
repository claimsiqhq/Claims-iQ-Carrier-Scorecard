import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AuthProvider, useAuth } from "@/lib/auth-context"
import { queryKeys } from "@/lib/api"
import { intakeRecoveryKey } from "@/lib/tenant-state"
import type { AuthSession } from "@/lib/types"

const platformUser = {
  id: "platform-user",
  email: "platform@example.com",
  firstName: "Pat",
  lastName: "Platform",
  profileImageUrl: null,
  role: "reviewer",
  platformRole: "admin" as const,
}

const outsideSession: AuthSession = {
  user: platformUser,
  organization: null,
}

const insideSession: AuthSession = {
  user: platformUser,
  organization: {
    id: "org-andover",
    name: "Andover Companies",
    role: "platform_admin",
    permissions: ["claims:read", "claims:create", "settings:manage"],
    accessMode: "platform_lease",
    accessExpiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
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
    enterTenant,
    exitTenant,
  } = useAuth()
  if (loading) return <span>Loading</span>

  return (
    <div>
      <span>{organization?.name || "Outside tenant"}</span>
      <span>Tenant admin: {isTenantAdmin ? "yes" : "no"}</span>
      <span>Settings: {canManageSettings ? "yes" : "no"}</span>
      <button
        type="button"
        onClick={() => void enterTenant("org-andover", "Support investigation")}
      >
        Enter
      </button>
      <button type="button" onClick={() => void exitTenant()}>
        Exit
      </button>
    </div>
  )
}

describe("AuthProvider tenant transitions", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("clears query and upload recovery state on enter and exit", async () => {
    let session = outsideSession
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      if (url.pathname === "/api/auth/user") return jsonResponse(session)
      if (url.pathname === "/api/platform/tenant-access" && init?.method === "POST") {
        session = insideSession
        return jsonResponse(session)
      }
      if (url.pathname === "/api/platform/tenant-access" && init?.method === "DELETE") {
        session = outsideSession
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

    await screen.findByText("Outside tenant")
    const recoveryKey = intakeRecoveryKey(platformUser.id, insideSession.organization?.id)
    expect(recoveryKey).not.toBeNull()
    queryClient.setQueryData(["tenant", "outside", "claims"], { secret: true })
    window.localStorage.setItem(recoveryKey!, JSON.stringify([{ claimId: "claim-1" }]))

    await user.click(screen.getByRole("button", { name: "Enter" }))
    await screen.findByText("Andover Companies")
    expect(screen.getByText("Tenant admin: no")).toBeInTheDocument()
    expect(screen.getByText("Settings: yes")).toBeInTheDocument()

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(window.localStorage.getItem(recoveryKey!)).toBeNull()
    expect(queryKeys.dashboard).toEqual([
      "complete-iq",
      "session",
      "platform-user",
      "org-andover",
      "dashboard",
    ])

    queryClient.setQueryData(["tenant", "inside", "claims"], { secret: true })
    window.localStorage.setItem(recoveryKey!, JSON.stringify([{ claimId: "claim-2" }]))
    await user.click(screen.getByRole("button", { name: "Exit" }))
    await screen.findByText("Outside tenant")
    expect(screen.getByText("Settings: no")).toBeInTheDocument()

    await waitFor(() => {
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(window.localStorage.getItem(recoveryKey!)).toBeNull()
      expect(queryKeys.dashboard).toEqual([
        "complete-iq",
        "session",
        "platform-user",
        "no-organization",
        "dashboard",
      ])
    })
  })

  it("clears tenant-scoped state when a platform lease expires", async () => {
    const expiredSession: AuthSession = {
      ...insideSession,
      organization: {
        ...insideSession.organization!,
        accessExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost")
      if (url.pathname === "/api/auth/user") return jsonResponse(expiredSession)
      return jsonResponse({ error: "Unhandled test endpoint" }, 404)
    })
    vi.stubGlobal("fetch", fetchMock)

    const queryClient = new QueryClient()
    const recoveryKey = intakeRecoveryKey(platformUser.id, expiredSession.organization?.id)
    expect(recoveryKey).not.toBeNull()
    queryClient.setQueryData(["tenant", "expired", "claims"], { secret: true })
    window.localStorage.setItem(recoveryKey!, JSON.stringify([{ claimId: "claim-expired" }]))

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthHarness />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await screen.findByText("Outside tenant")
    await waitFor(() => {
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(window.localStorage.getItem(recoveryKey!)).toBeNull()
      expect(queryKeys.dashboard).toEqual([
        "complete-iq",
        "session",
        "platform-user",
        "no-organization",
        "dashboard",
      ])
    })
  })
})
