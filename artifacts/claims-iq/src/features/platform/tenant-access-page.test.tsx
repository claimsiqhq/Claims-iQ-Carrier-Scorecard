import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { NoTenantAccessPage } from "./tenant-access-page"

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    logout: vi.fn(),
  }),
}))

describe("NoTenantAccessPage", () => {
  it("explains the missing tenant workspace and offers sign-out", () => {
    render(<NoTenantAccessPage />)

    expect(
      screen.getByRole("heading", { name: "No tenant workspace assigned" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument()
    expect(screen.queryByText(/reason/i)).not.toBeInTheDocument()
  })
})
