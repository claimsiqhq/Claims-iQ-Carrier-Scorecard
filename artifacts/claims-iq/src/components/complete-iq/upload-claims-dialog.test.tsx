import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/button"
import { UploadClaimsDialog } from "./upload-claims-dialog"

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  organization: {
    id: "org-andover",
    name: "Andover",
    role: "reviewer",
    permissions: ["claims:create"],
  },
}))

vi.mock("@/lib/api", () => ({
  queryKeys: {
    carriers: ["test", "carriers"],
    dashboard: ["test", "dashboard"],
    claims: ["test", "claims"],
  },
  api: {
    ingest: mocks.ingest,
  },
  apiErrorMessage: (error: unknown, fallback = "Request failed") =>
    error instanceof Error ? error.message : fallback,
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-andover" },
    organization: mocks.organization,
  }),
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
  beforeEach(() => {
    mocks.ingest.mockReset()
    mocks.organization.name = "Andover"
  })

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
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start 1 intake" })).toBeEnabled()
    })
  })

  it("does not offer a carrier or prompt picker for a multi-entity tenant", async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole("button", { name: "Add files" }))

    expect(screen.queryByLabelText("Carrier entity")).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Andover" })).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Bay State Insurance Company" })).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Cambridge Mutual" })).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Merrimack Mutual" })).not.toBeInTheDocument()
    expect(
      screen.getByText(/This intake uses the Andover assigned prompt and ruleset/),
    ).toBeInTheDocument()
  })
})
