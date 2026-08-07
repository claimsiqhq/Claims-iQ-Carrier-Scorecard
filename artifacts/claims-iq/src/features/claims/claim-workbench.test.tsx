import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
  FindingReviewControl,
  type WorkFinding,
} from "./claim-workbench"

const finding: WorkFinding = {
  key: "finding-1",
  findingId: "00000000-0000-4000-8000-000000000001",
  title: "Missing estimate support",
  severity: "high",
  evidence: ["Page 3"],
  disposition: "open",
  reviewNotes: "",
}

describe("FindingReviewControl", () => {
  it("requires an override reason before saving a modified finding", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<FindingReviewControl finding={finding} saving={false} onSave={onSave} />)

    await user.selectOptions(screen.getByLabelText("Disposition"), "overridden")
    const save = screen.getByRole("button", { name: "Save review" })
    expect(save).toBeDisabled()

    await user.type(screen.getByLabelText("Reviewer notes"), "Carrier exception approved by lead.")
    expect(save).toBeEnabled()
    await user.click(save)

    expect(onSave).toHaveBeenCalledWith(
      "overridden",
      "Carrier exception approved by lead.",
    )
  })
})
