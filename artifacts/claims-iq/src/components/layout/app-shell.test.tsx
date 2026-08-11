import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { AppShell } from "./app-shell"

const authState = vi.hoisted(() => ({ leasedPlatformAccess: false }))

vi.mock("@/lib/api", () => ({
  queryKeys: {
    platformTenants: ["test", "platform", "tenants"],
  },
  api: {
    getPlatformTenants: vi.fn().mockResolvedValue([
      { id: "org-wawanesa", name: "Wawanesa", slug: "wawanesa" },
      { id: "org-allstate", name: "Allstate", slug: "allstate" },
    ]),
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
      platformRole: authState.leasedPlatformAccess ? "admin" : "none",
    },
    organization: authState.leasedPlatformAccess
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
    isPlatformAdmin: authState.leasedPlatformAccess,
    isTenantAdmin: false,
    isPlatformAccessActive: authState.leasedPlatformAccess,
    canManageSettings: authState.leasedPlatformAccess,
    canCreateClaims: false,
    logout: vi.fn(),
    enterTenant: vi.fn(),
    exitTenant: vi.fn(),
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

  it("shows settings during leased platform access without tenant-admin status", async () => {
    authState.leasedPlatformAccess = true
    try {
      renderShell(
        <AppShell>
          <p>Leased tenant workspace</p>
        </AppShell>,
      )

      expect(screen.getAllByText("Settings").length).toBeGreaterThan(0)
      expect(screen.getAllByText("Wawanesa").length).toBeGreaterThan(0)
    } finally {
      authState.leasedPlatformAccess = false
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
