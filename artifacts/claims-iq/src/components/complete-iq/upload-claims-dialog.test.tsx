import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/button"
import { UploadClaimsDialog } from "./upload-claims-dialog"

const mocks = vi.hoisted(() => ({
  getCarrierOptions: vi.fn(),
  organization: {
    id: "org-allstate",
    name: "Allstate",
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
    getCarrierOptions: mocks.getCarrierOptions,
  },
  apiErrorMessage: (error: unknown, fallback = "Request failed") =>
    error instanceof Error ? error.message : fallback,
}))

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-allstate" },
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
    mocks.getCarrierOptions.mockReset()
    mocks.getCarrierOptions.mockResolvedValue([])
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

  it("filters carrier entities to the authenticated organization", async () => {
    mocks.getCarrierOptions.mockResolvedValue([
      {
        id: "10000000-0000-4000-8000-000000000001",
        key: "allstate-property",
        entityKey: "allstate-property",
        carrierKey: "allstate",
        displayName: "Allstate Property",
        organizationId: "org-allstate",
        isPrimary: true,
        active: true,
        logoUrl: null,
      },
      {
        id: "20000000-0000-4000-8000-000000000001",
        key: "andover",
        entityKey: "andover",
        carrierKey: "andover",
        displayName: "Andover",
        organizationId: "org-andover",
        isPrimary: true,
        active: true,
        logoUrl: null,
      },
    ])
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole("button", { name: "Add files" }))

    const selector = await screen.findByLabelText("Carrier entity")
    await waitFor(() => {
      expect(selector).toHaveValue("10000000-0000-4000-8000-000000000001")
    })

    expect(selector).toBeDisabled()
    expect(screen.getByRole("option", { name: "Allstate Property" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Andover" })).not.toBeInTheDocument()
  })

  it("preselects the primary entity so multi-entity tenants are never forced to choose", async () => {
    mocks.getCarrierOptions.mockResolvedValue([
      {
        id: "10000000-0000-4000-8000-000000000002",
        key: "allstate-indemnity",
        entityKey: "allstate-indemnity",
        carrierKey: "allstate",
        displayName: "Allstate Indemnity",
        organizationId: "org-allstate",
        isPrimary: false,
        active: true,
        logoUrl: null,
      },
      {
        id: "10000000-0000-4000-8000-000000000001",
        key: "allstate-property",
        entityKey: "allstate-property",
        carrierKey: "allstate",
        displayName: "Allstate Property",
        organizationId: "org-allstate",
        isPrimary: true,
        active: true,
        logoUrl: null,
      },
    ])
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole("button", { name: "Add files" }))

    const selector = await screen.findByLabelText("Carrier entity")
    // The primary entity is preselected even when it is not listed first.
    await waitFor(() => {
      expect(selector).toHaveValue("10000000-0000-4000-8000-000000000001")
    })
    expect(screen.queryByRole("option", { name: /select a carrier/i })).not.toBeInTheDocument()
    expect(
      screen.getByText(/audited under this tenant's ruleset/i),
    ).toBeInTheDocument()

    await waitFor(() => expect(selector).toBeEnabled())
    await user.selectOptions(selector, "10000000-0000-4000-8000-000000000002")
    expect(selector).toHaveValue("10000000-0000-4000-8000-000000000002")
  })
})
