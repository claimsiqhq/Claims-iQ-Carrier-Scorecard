import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TenantSwitcher } from "./tenant-switcher"

const mocks = vi.hoisted(() => ({
  enterTenant: vi.fn().mockResolvedValue(undefined),
  getPlatformTenants: vi.fn(),
  auth: {
    organization: {
      id: "org-allstate",
      name: "Allstate",
      role: "reviewer",
      permissions: ["claims:read"],
      accessMode: "membership" as const,
    } as {
      id: string
      name: string
      role: string
      permissions: string[]
      accessMode: "membership" | "platform_lease"
    } | null,
    isPlatformAdmin: false,
  },
}))

vi.mock("@/lib/api", () => ({
  queryKeys: {
    platformTenants: ["test", "platform", "tenants"],
  },
  api: {
    getPlatformTenants: mocks.getPlatformTenants,
  },
  apiErrorMessage: (error: unknown, fallback = "Request failed") =>
    error instanceof Error ? error.message : fallback,
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    organization: mocks.auth.organization,
    isPlatformAdmin: mocks.auth.isPlatformAdmin,
    enterTenant: mocks.enterTenant,
  }),
}))

describe("TenantSwitcher", () => {
  beforeEach(() => {
    mocks.enterTenant.mockClear()
    mocks.getPlatformTenants.mockReset()
    mocks.auth.organization = {
      id: "org-allstate",
      name: "Allstate",
      role: "reviewer",
      permissions: ["claims:read"],
      accessMode: "membership",
    }
    mocks.auth.isPlatformAdmin = false
  })

  it("shows an ordinary user's sole tenant without requesting a platform list", async () => {
    const user = userEvent.setup()
    renderSwitcher()

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
    expect(mocks.getPlatformTenants).not.toHaveBeenCalled()
  })

  it("lists platform tenants and requires an audited reason before switching", async () => {
    mocks.auth.isPlatformAdmin = true
    mocks.auth.organization = {
      id: "org-allstate",
      name: "Allstate",
      role: "platform_admin",
      permissions: ["claims:read"],
      accessMode: "platform_lease",
    }
    mocks.getPlatformTenants.mockResolvedValue([
      { id: "org-allstate", name: "Allstate", slug: "allstate" },
      { id: "org-andover", name: "Andover", slug: "andover" },
    ])
    const user = userEvent.setup()
    renderSwitcher()

    await user.click(
      screen.getByRole("button", {
        name: "Tenant menu. Current tenant: Allstate",
      }),
    )
    await user.click(await screen.findByRole("menuitem", { name: "Switch to Andover" }))

    const submit = screen.getByRole("button", { name: "Switch to Andover" })
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText("Reason for access"), "Investigate support case CIQ-1842")
    await user.click(submit)

    await waitFor(() => {
      expect(mocks.enterTenant).toHaveBeenCalledWith(
        "org-andover",
        "Investigate support case CIQ-1842",
      )
    })
  })

  it("lets a platform administrator choose a tenant from the header before entering one", async () => {
    mocks.auth.isPlatformAdmin = true
    mocks.auth.organization = null
    mocks.getPlatformTenants.mockResolvedValue([
      { id: "org-wawanesa", name: "Wawanesa", slug: "wawanesa" },
    ])
    const user = userEvent.setup()
    renderSwitcher()

    await user.click(
      screen.getByRole("button", {
        name: "Tenant menu. Select a tenant",
      }),
    )
    await user.click(await screen.findByRole("menuitem", { name: "Open Wawanesa" }))

    expect(screen.getByRole("heading", { name: "Open tenant workspace" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open Wawanesa" })).toBeDisabled()
  })
})

function renderSwitcher() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TenantSwitcher />
    </QueryClientProvider>,
  )
}
