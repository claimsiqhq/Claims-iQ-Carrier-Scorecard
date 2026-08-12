import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NoTenantAccessPage } from "./tenant-access-page"

const mocks = vi.hoisted(() => ({
  switchTenant: vi.fn().mockResolvedValue(undefined),
  getOrganizations: vi.fn(),
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
    logout: vi.fn(),
    switchTenant: mocks.switchTenant,
  }),
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <NoTenantAccessPage />
    </QueryClientProvider>,
  )
}

describe("NoTenantAccessPage", () => {
  beforeEach(() => {
    mocks.switchTenant.mockClear()
    mocks.getOrganizations.mockReset()
  })

  it("explains the missing tenant workspace and offers sign-out", async () => {
    mocks.getOrganizations.mockResolvedValue([])
    renderPage()

    expect(
      await screen.findByRole("heading", { name: "No tenant workspace assigned" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument()
    expect(screen.queryByText(/reason/i)).not.toBeInTheDocument()
  })

  it("offers accessible tenants as a recovery path", async () => {
    mocks.getOrganizations.mockResolvedValue([
      { id: "org-wawanesa", name: "Wawanesa", slug: "wawanesa", role: "platform_admin" },
    ])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: /Wawanesa/ }))
    await waitFor(() => {
      expect(mocks.switchTenant).toHaveBeenCalledWith("org-wawanesa")
    })
    expect(screen.queryByLabelText("Reason for access")).not.toBeInTheDocument()
  })
})
