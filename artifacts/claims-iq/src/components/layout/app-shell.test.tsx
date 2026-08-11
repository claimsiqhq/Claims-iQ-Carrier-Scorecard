import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AppShell } from "./app-shell"

const authState = vi.hoisted(() => ({ leasedPlatformAccess: false }))

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
    exitTenant: vi.fn(),
  }),
}))

describe("AppShell tenant navigation", () => {
  it("shows an ordinary user's sole tenant without a switcher", () => {
    const { container } = render(
      <AppShell>
        <p>Tenant workspace</p>
      </AppShell>,
    )

    const tenantChip = container.querySelector(".ciq-tenant-chip")
    expect(tenantChip).toHaveTextContent("Allstate")
    expect(tenantChip?.tagName).toBe("SPAN")
    expect(screen.queryByRole("button", { name: /switch tenant/i })).not.toBeInTheDocument()
    expect(screen.queryByText("Platform administration")).not.toBeInTheDocument()
    expect(screen.queryByText("New intake")).not.toBeInTheDocument()
  })

  it("shows settings during leased platform access without tenant-admin status", () => {
    authState.leasedPlatformAccess = true
    try {
      render(
        <AppShell>
          <p>Leased tenant workspace</p>
        </AppShell>,
      )

      expect(screen.getAllByText("Settings").length).toBeGreaterThan(0)
      expect(screen.getByText("Wawanesa")).toBeInTheDocument()
    } finally {
      authState.leasedPlatformAccess = false
    }
  })
})
