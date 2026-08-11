import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import TenantAccessPage from "./tenant-access-page"

const mocks = vi.hoisted(() => ({
  enterTenant: vi.fn().mockResolvedValue(undefined),
  getPlatformTenants: vi.fn().mockResolvedValue([
    { id: "org-andover", name: "Andover Companies", slug: "andover" },
  ]),
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
    enterTenant: mocks.enterTenant,
  }),
}))

describe("TenantAccessPage", () => {
  it("requires a reason before a platform administrator can enter a tenant", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <TenantAccessPage />
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole("button", { name: "Access Andover Companies" }))

    const submit = screen.getByRole("button", { name: "Start temporary access" })
    expect(submit).toBeDisabled()

    await user.type(
      screen.getByLabelText("Reason for access"),
      "Investigate support case CIQ-1842",
    )
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(mocks.enterTenant).toHaveBeenCalledWith(
      "org-andover",
      "Investigate support case CIQ-1842",
    )
  })
})
