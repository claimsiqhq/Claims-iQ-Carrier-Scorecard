import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { AppShell } from "./app-shell"

const authState = vi.hoisted(() => ({
  platformAdminInTenant: false,
  canCreateClaims: false,
}))

vi.mock("@/lib/api", () => ({
  queryKeys: {
    organizations: ["test", "organizations"],
    dashboard: ["test", "dashboard"],
    claims: ["test", "claims"],
  },
  api: {
    getOrganizations: vi.fn().mockImplementation(() =>
      Promise.resolve(
        authState.platformAdminInTenant
          ? [
              { id: "org-wawanesa", name: "Wawanesa", slug: "wawanesa", role: "platform_admin" },
              { id: "org-allstate", name: "Allstate", slug: "allstate", role: "platform_admin" },
            ]
          : [{ id: "org-allstate", name: "Allstate", slug: "allstate", role: "reviewer" }],
      ),
    ),
  },
  apiErrorMessage: (error: unknown, fallback = "Request failed") =>
    error instanceof Error ? error.message : fallback,
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      id: "user-allstate",
      email: "reviewer@allstate.example",
      firstName: "Alex",
      lastName: "Reviewer",
      role: "reviewer",
      platformRole: authState.platformAdminInTenant ? "admin" : "none",
    },
    organization: authState.platformAdminInTenant
      ? {
          id: "org-wawanesa",
          name: "Wawanesa",
          role: "platform_admin",
          permissions: ["claims:read", "settings:manage"],
          accessMode: "platform_lease",
        }
      : {
          id: "org-allstate",
          name: "Allstate",
          role: "reviewer",
          permissions: ["claims:read"],
          accessMode: "membership",
        },
    isPlatformAdmin: authState.platformAdminInTenant,
    isTenantAdmin: false,
    canManageSettings: authState.platformAdminInTenant,
    canCreateClaims: authState.canCreateClaims,
    logout: vi.fn(),
    switchTenant: vi.fn(),
  }),
}))

describe("AppShell tenant navigation", () => {
  it("shows an ordinary user's sole tenant in the header dropdown", async () => {
    const user = userEvent.setup()
    renderShell(
      <AppShell>
        <p>Tenant workspace</p>
      </AppShell>,
    )

    await user.click(
      screen.getByRole("button", {
        name: "Tenant menu. Current tenant: Allstate",
      }),
    )
    expect(
      await screen.findByRole("menuitem", {
        name: "Allstate, current tenant",
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: /switch to/i })).not.toBeInTheDocument()
    expect(screen.queryByText("Platform administration")).not.toBeInTheDocument()
    expect(screen.queryByText("New intake")).not.toBeInTheDocument()
  })

  it("shows a single New intake control when the user can create claims", () => {
    authState.canCreateClaims = true
    try {
      renderShell(
        <AppShell>
          <p>Tenant workspace</p>
        </AppShell>,
      )
      expect(screen.getAllByRole("button", { name: "New intake" })).toHaveLength(1)
    } finally {
      authState.canCreateClaims = false
    }
  })

  it("shows settings and other tenants for a platform administrator", async () => {
    authState.platformAdminInTenant = true
    try {
      const user = userEvent.setup()
      renderShell(
        <AppShell>
          <p>Platform tenant workspace</p>
        </AppShell>,
      )

      expect(screen.getAllByText("Settings").length).toBeGreaterThan(0)
      expect(screen.getAllByText("Wawanesa").length).toBeGreaterThan(0)

      await user.click(
        screen.getByRole("button", {
          name: "Tenant menu. Current tenant: Wawanesa",
        }),
      )
      expect(
        await screen.findByRole("menuitem", { name: "Switch to Allstate" }),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText("Reason for access")).not.toBeInTheDocument()
    } finally {
      authState.platformAdminInTenant = false
    }
  })
})

function renderShell(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
}
