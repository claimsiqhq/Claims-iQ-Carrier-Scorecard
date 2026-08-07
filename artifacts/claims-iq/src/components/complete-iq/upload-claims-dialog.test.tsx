import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/button"
import { UploadClaimsDialog } from "./upload-claims-dialog"

vi.mock("@/lib/api", () => ({
  queryKeys: {
    carriers: ["test", "carriers"],
    dashboard: ["test", "dashboard"],
    claims: ["test", "claims"],
  },
  api: {
    getCarrierOptions: vi.fn().mockResolvedValue([]),
  },
  apiErrorMessage: (error: unknown, fallback = "Request failed") =>
    error instanceof Error ? error.message : fallback,
}))

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <UploadClaimsDialog trigger={<Button>Add files</Button>} />
    </QueryClientProvider>,
  )
}

describe("UploadClaimsDialog", () => {
  it("rejects non-PDF input during client preflight", async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderDialog()
    await user.click(screen.getByRole("button", { name: "Add files" }))

    await user.upload(
      screen.getByLabelText("Choose claim PDF files"),
      new File(["plain text"], "notes.txt", { type: "text/plain" }),
    )

    expect(screen.getByRole("alert")).toHaveTextContent("notes.txt: PDF files only")
  })

  it("queues a valid PDF with an explicit batch start action", async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole("button", { name: "Add files" }))

    await user.upload(
      screen.getByLabelText("Choose claim PDF files"),
      new File(["%PDF-1.7"], "claim-package.pdf", { type: "application/pdf" }),
    )

    expect(screen.getByText("claim-package.pdf")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start 1 intake" })).toBeEnabled()
  })
})
