import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import LoginPage from "./login-page"

const { login } = vi.hoisted(() => ({
  login: vi.fn(),
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ login }),
}))

describe("LoginPage", () => {
  beforeEach(() => {
    login.mockReset()
  })

  it("requires both credentials and exposes a server-safe authentication error", async () => {
    login.mockResolvedValue("Invalid email or password")
    const user = userEvent.setup()
    render(<LoginPage />)

    const submit = screen.getByRole("button", { name: "Sign in" })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText("Work email"), "reviewer@example.com")
    await user.type(screen.getByLabelText("Password"), "incorrect")
    await user.click(submit)

    expect(login).toHaveBeenCalledWith("reviewer@example.com", "incorrect")
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password")
  })

  it("explains when a protected session expired", () => {
    window.sessionStorage.setItem("complete-iq:session-expired", "true")
    render(<LoginPage />)

    expect(screen.getByRole("status")).toHaveTextContent(
      "Your protected session expired. Sign in again to continue.",
    )
  })
})
