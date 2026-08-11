import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import TenantAccessPage from "./tenant-access-page"

describe("TenantAccessPage", () => {
  it("directs platform administrators to the persistent header tenant menu", () => {
    render(<TenantAccessPage />)

    expect(
      screen.getByRole("heading", {
        name: "Choose a tenant from the header",
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/tenant menu in the top-right corner/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /access/i })).not.toBeInTheDocument()
  })
})
