import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "@/lib/api"
import type { ClaimDocument, DocumentRenditionManifest } from "@/lib/types"
import { DocumentViewer } from "./document-viewer"

const sourceDocument: ClaimDocument = {
  id: "10000000-0000-4000-8000-000000000001",
  claimId: "20000000-0000-4000-8000-000000000001",
  type: "claim_file",
  fileUrl: "organizations/test/source.pdf",
  pageCount: 3,
  extractedText:
    "=== Page 1 ===\nOpening page\n\n=== Page 2 ===\nNeedle evidence\n\n=== Page 3 ===\nFinal page",
  metadata: { fileName: "claim-source.pdf" },
}

const manifest: DocumentRenditionManifest = {
  documentId: sourceDocument.id,
  version: "page-jpeg-v1",
  format: "jpeg",
  status: "ready",
  pageCount: 3,
  availablePages: [1, 2, 3],
  failedPages: [],
  error: null,
  job: null,
}

function renderViewer(targetPage?: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const result = render(
    <QueryClientProvider client={client}>
      <DocumentViewer
        document={sourceDocument}
        documents={[sourceDocument]}
        selectedId={sourceDocument.id}
        targetPage={targetPage}
        onSelect={vi.fn()}
      />
    </QueryClientProvider>,
  )
  return { ...result, client }
}

describe("DocumentViewer", () => {
  beforeEach(() => {
    vi.spyOn(api, "getDocumentRenditions").mockResolvedValue(manifest)
    vi.spyOn(api, "prepareDocumentRenditions").mockResolvedValue(manifest)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("shows rendered pages and provides page and zoom controls", async () => {
    const user = userEvent.setup()
    renderViewer()

    expect(await screen.findByText("3 pages ready")).toBeInTheDocument()
    expect(screen.getByAltText("Page 1 of claim-source.pdf")).toHaveAttribute(
      "src",
      expect.stringContaining("/renditions/1"),
    )

    await user.click(screen.getByRole("button", { name: "Next page" }))
    expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2")

    await user.click(screen.getByRole("button", { name: "Zoom in" }))
    expect(screen.getByRole("button", { name: "Fit width" })).toHaveTextContent("120%")
  })

  it("searches extracted text and jumps to the matching rendered page", async () => {
    const user = userEvent.setup()
    renderViewer()
    await screen.findByText("3 pages ready")

    await user.type(screen.getByRole("searchbox", { name: "Search document" }), "needle")
    await user.click(screen.getByRole("button", { name: "1/1" }))

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2")
    })
  })

  it("synchronizes an external evidence citation without changing routes", async () => {
    const { rerender, client } = renderViewer(1)
    await screen.findByText("3 pages ready")

    rerender(
      <QueryClientProvider client={client}>
        <DocumentViewer
          document={sourceDocument}
          documents={[sourceDocument]}
          selectedId={sourceDocument.id}
          targetPage={3}
          onSelect={vi.fn()}
        />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("3")
    })
  })
})

