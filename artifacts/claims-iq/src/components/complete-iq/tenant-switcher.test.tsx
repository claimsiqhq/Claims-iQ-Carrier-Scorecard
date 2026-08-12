import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TenantSwitcher } from "./tenant-switcher"

const mocks = vi.hoisted(() => ({
  switchTenant: vi.fn().mockResolvedValue(undefined),
  getOrganizations: vi.fn(),
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
  },
}))

vi.mock("@/lib/api", () => ({
  queryKeys: {
    organizations: ["test", "organizations"],
  },
  api: {
    getOrganizations: mocks.getOrganizations,
  },
  apiErrorMessage: (error: unknown, fallback = "Request failed") =>
    error instanceof Error ? error.message : fallback,
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    organization: mocks.auth.organization,
    switchTenant: mocks.switchTenant,
  }),
}))

describe("TenantSwitcher", () => {
  beforeEach(() => {
    mocks.switchTenant.mockClear()
    mocks.getOrganizations.mockReset()
    mocks.auth.organization = {
      id: "org-allstate",
      name: "Allstate",
      role: "reviewer",
      permissions: ["claims:read"],
      accessMode: "membership",
    }
  })

  it("shows a single-tenant user's sole tenant with no switch options", async () => {
    mocks.getOrganizations.mockResolvedValue([
      { id: "org-allstate", name: "Allstate", slug: "allstate", role: "reviewer" },
    ])
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
    expect(screen.getByText("Your assigned tenant.")).toBeInTheDocument()
  })

  it("switches tenants immediately without asking for a reason", async () => {
    mocks.getOrganizations.mockResolvedValue([
      { id: "org-allstate", name: "Allstate", slug: "allstate", role: "reviewer" },
      { id: "org-andover", name: "Andover", slug: "andover", role: "admin" },
    ])
    const user = userEvent.setup()
    renderSwitcher()

    await user.click(
      screen.getByRole("button", {
        name: "Tenant menu. Current tenant: Allstate",
      }),
    )
    await user.click(await screen.findByRole("menuitem", { name: "Switch to Andover" }))

    await waitFor(() => {
      expect(mocks.switchTenant).toHaveBeenCalledWith("org-andover")
    })
    expect(screen.queryByLabelText("Reason for access")).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("selecting the current tenant is a no-op", async () => {
    mocks.getOrganizations.mockResolvedValue([
      { id: "org-allstate", name: "Allstate", slug: "allstate", role: "reviewer" },
      { id: "org-andover", name: "Andover", slug: "andover", role: "admin" },
    ])
    const user = userEvent.setup()
    renderSwitcher()

    await user.click(
      screen.getByRole("button", {
        name: "Tenant menu. Current tenant: Allstate",
      }),
    )
    await user.click(
      await screen.findByRole("menuitem", { name: "Allstate, current tenant" }),
    )

    expect(mocks.switchTenant).not.toHaveBeenCalled()
  })

  it("surfaces a failed switch without losing the menu", async () => {
    mocks.getOrganizations.mockResolvedValue([
      { id: "org-allstate", name: "Allstate", slug: "allstate", role: "reviewer" },
      { id: "org-andover", name: "Andover", slug: "andover", role: "admin" },
    ])
    mocks.switchTenant.mockRejectedValueOnce(new Error("Switch failed upstream"))
    const user = userEvent.setup()
    renderSwitcher()

    await user.click(
      screen.getByRole("button", {
        name: "Tenant menu. Current tenant: Allstate",
      }),
    )
    await user.click(await screen.findByRole("menuitem", { name: "Switch to Andover" }))

    await waitFor(() => {
      expect(mocks.switchTenant).toHaveBeenCalledWith("org-andover")
    })
    expect(
      await screen.findByRole("menuitem", { name: "Switch to Andover" }),
    ).toBeInTheDocument()
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
