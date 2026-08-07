import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { StatusPill, formatDate, formatScore, humanize } from "./status"

describe("Complete iQ status formatting", () => {
  it("formats workflow values and scores without inventing unavailable data", () => {
    expect(humanize("changes_requested")).toBe("Changes Requested")
    expect(formatScore(91.6)).toBe("92%")
    expect(formatScore(null)).toBe("—")
    expect(formatDate("not-a-date")).toBe("not-a-date")
  })

  it("maps failure states to the critical visual treatment", () => {
    render(<StatusPill value="failed" />)
    expect(screen.getByText("Failed")).toHaveClass("ciq-status--critical")
  })

  it("treats legacy and canonical not-ready labels consistently", () => {
    const { rerender } = render(<StatusPill value="NOT READY" />)
    expect(screen.getByText("NOT READY")).toHaveClass("ciq-status--critical")
    rerender(<StatusPill value="NOT_READY" />)
    expect(screen.getByText("NOT READY")).toHaveClass("ciq-status--critical")
  })
})
