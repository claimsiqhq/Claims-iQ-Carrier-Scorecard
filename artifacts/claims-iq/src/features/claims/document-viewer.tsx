import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Collapse,
  Download,
  Expand,
  NavArrowLeft,
  NavArrowRight,
  Page,
  Refresh,
  Search,
  Text,
  ZoomIn,
  ZoomOut,
} from "iconoir-react"
import { Button } from "@/components/ui/button"
import { api, apiErrorMessage, queryKeys } from "@/lib/api"
import type { ClaimDocument } from "@/lib/types"

type ViewerMode = "pages" | "text"

function sourceName(document: ClaimDocument) {
  const fileName = document.metadata?.fileName
  return typeof fileName === "string" && fileName
    ? fileName
    : document.type.replace(/_/g, " ")
}

function textPages(extractedText?: string) {
  if (!extractedText) return [] as Array<{ page: number; text: string }>
  const marker = /={3,}\s*page\s+(\d+)\s*={3,}/gi
  const matches = [...extractedText.matchAll(marker)]
  if (!matches.length) return [{ page: 1, text: extractedText.trim() }]
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const finish = matches[index + 1]?.index ?? extractedText.length
    return {
      page: Number.parseInt(match[1]!, 10),
      text: extractedText.slice(start, finish).trim(),
    }
  })
}

function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function safeViewerError(error: unknown) {
  const message = apiErrorMessage(error, "Page renditions are not available yet.")
  return message.includes("<html")
    || message.includes("<!DOCTYPE")
    || message.length > 180
    ? "Page renditions are not available yet. Prepare the document again after the viewer service is updated."
    : message
}

function highlightedText(text: string, query: string): ReactNode {
  const normalized = query.trim()
  if (!normalized) return text
  const parts = text.split(new RegExp(`(${escapedRegExp(normalized)})`, "gi"))
  return parts.map((part, index) =>
    part.toLowerCase() === normalized.toLowerCase() ? (
      <mark
        key={`${part}-${index}`}
        className="rounded-sm bg-[var(--ciq-gold-soft)] px-0.5 text-[var(--ciq-ink)]"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

export function DocumentViewer({
  document,
  documents,
  selectedId,
  targetPage,
  onSelect,
  onCollapse,
  onToggleFocus,
  focused = false,
  className = "",
}: {
  document?: ClaimDocument
  documents: ClaimDocument[]
  selectedId?: string
  targetPage?: number | null
  onSelect: (documentId: string) => void
  onCollapse?: () => void
  onToggleFocus?: () => void
  focused?: boolean
  className?: string
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<ViewerMode>("pages")
  const [zoom, setZoom] = useState(100)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageEntry, setPageEntry] = useState("1")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchCursor, setSearchCursor] = useState(-1)
  const [imageFailures, setImageFailures] = useState<Set<number>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef(new Map<number, HTMLElement>())
  const scrollFrame = useRef<number | null>(null)
  const preparationRequested = useRef<string | null>(null)

  const renditionQuery = useQuery({
    queryKey: queryKeys.documentRenditions(document?.id || "none"),
    queryFn: () => api.getDocumentRenditions(document!.id),
    enabled: Boolean(document?.id && document.fileUrl),
    refetchInterval: (query) =>
      query.state.data?.status === "preparing" ? 1_500 : false,
  })
  const prepareMutation = useMutation({
    mutationFn: (documentId: string) =>
      api.prepareDocumentRenditions(documentId),
    onSuccess: (manifest) => {
      queryClient.setQueryData(
        queryKeys.documentRenditions(manifest.documentId),
        manifest,
      )
    },
  })

  const manifest = renditionQuery.data
  const pageCount = manifest?.pageCount ?? document?.pageCount ?? 0
  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  )
  const availablePages = useMemo(() => {
    if (!manifest) return new Set<number>()
    if (
      manifest.availablePages.length === 0
      && manifest.status === "ready"
      && pageCount > 0
    ) {
      return new Set(pages)
    }
    return new Set(manifest.availablePages)
  }, [manifest, pageCount, pages])
  const extractedPages = useMemo(
    () => textPages(document?.extractedText),
    [document?.extractedText],
  )
  const matchingPages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return [] as number[]
    return extractedPages
      .filter((page) => page.text.toLowerCase().includes(query))
      .map((page) => page.page)
  }, [extractedPages, searchQuery])

  useEffect(() => {
    setCurrentPage(1)
    setPageEntry("1")
    setZoom(100)
    setMode("pages")
    setSearchCursor(-1)
    setImageFailures(new Set())
    pageRefs.current.clear()
    preparationRequested.current = null
  }, [document?.id])

  useEffect(() => {
    if (
      !document?.id
      || renditionQuery.data?.status !== "missing"
      || preparationRequested.current === document.id
      || prepareMutation.isPending
    ) {
      return
    }
    preparationRequested.current = document.id
    prepareMutation.mutate(document.id)
  }, [
    document?.id,
    prepareMutation,
    renditionQuery.data?.status,
  ])

  const goToPage = (pageNumber: number, behavior: ScrollBehavior = "smooth") => {
    if (!pageCount) return
    const bounded = Math.min(Math.max(Math.round(pageNumber), 1), pageCount)
    setCurrentPage(bounded)
    setPageEntry(String(bounded))
    setMode("pages")
    window.requestAnimationFrame(() => {
      const container = scrollRef.current
      const target = pageRefs.current.get(bounded)
      if (!container || !target) return
      container.scrollTo({
        top: Math.max(0, target.offsetTop - 18),
        behavior,
      })
    })
  }

  useEffect(() => {
    if (!targetPage || !pageCount) return
    goToPage(targetPage)
    // targetPage is an explicit external citation destination.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetPage, pageCount, document?.id])

  const updateVisiblePage = () => {
    if (scrollFrame.current !== null) return
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null
      const container = scrollRef.current
      if (!container) return
      const top = container.getBoundingClientRect().top + 28
      let nearestPage = currentPage
      let nearestDistance = Number.POSITIVE_INFINITY
      for (const [pageNumber, element] of pageRefs.current) {
        const distance = Math.abs(element.getBoundingClientRect().top - top)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestPage = pageNumber
        }
      }
      if (nearestPage !== currentPage) {
        setCurrentPage(nearestPage)
        setPageEntry(String(nearestPage))
      }
    })
  }

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current)
      }
    },
    [],
  )

  const runSearch = () => {
    if (!matchingPages.length) return
    const nextCursor = (searchCursor + 1) % matchingPages.length
    setSearchCursor(nextCursor)
    goToPage(matchingPages[nextCursor]!)
  }

  const retryPreparation = () => {
    if (!document?.id) return
    preparationRequested.current = document.id
    prepareMutation.mutate(document.id)
  }

  if (!document) {
    return (
      <aside className={`ciq-document-viewer ${className}`}>
        <div className="grid h-full place-items-center p-6 text-center">
          <div>
            <Page className="mx-auto h-8 w-8 text-[var(--ciq-brand)]" />
            <p className="mt-3 text-sm font-semibold">No source document</p>
          </div>
        </div>
      </aside>
    )
  }

  const failed = manifest?.status === "failed" || renditionQuery.isError
  const preparing =
    !failed
    && (
      renditionQuery.isLoading
      || prepareMutation.isPending
      || manifest?.status === "preparing"
      || !manifest
    )
  const statusLabel =
    manifest?.status === "degraded"
      ? "Some pages unavailable"
      : manifest?.status === "ready"
        ? `${pageCount} pages ready`
        : preparing
          ? "Preparing pages"
          : failed
            ? "Viewer unavailable"
            : "Source document"

  return (
    <aside className={`ciq-document-viewer ${className}`}>
      <header className="ciq-document-viewer__header">
        <div className="min-w-0">
          <span className="ciq-eyebrow !mb-1 !text-[var(--ciq-financial)]">
            Document workspace
          </span>
          <h2 className="truncate text-sm font-bold text-[var(--ciq-ink)]">
            {sourceName(document)}
          </h2>
          <p className="mt-1 text-[0.68rem] text-[var(--ciq-ink-muted)]">
            {statusLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onToggleFocus && (
            <button
              type="button"
              className="ciq-viewer-icon-button"
              onClick={onToggleFocus}
              aria-label={focused ? "Restore viewer size" : "Maximize viewer"}
              title={focused ? "Restore viewer size" : "Maximize viewer"}
            >
              {focused ? <Collapse /> : <Expand />}
            </button>
          )}
          {onCollapse && (
            <button
              type="button"
              className="ciq-viewer-icon-button"
              onClick={onCollapse}
              aria-label="Collapse document viewer"
              title="Collapse document viewer"
            >
              <NavArrowRight />
            </button>
          )}
        </div>
      </header>

      {documents.length > 1 && (
        <div className="border-b border-[var(--ciq-border)] px-3 py-2">
          <label htmlFor={`viewer-document-${document.id}`} className="sr-only">
            Source document
          </label>
          <select
            id={`viewer-document-${document.id}`}
            className="ciq-control h-9 text-xs"
            value={selectedId}
            onChange={(event) => onSelect(event.target.value)}
          >
            {documents.map((item) => (
              <option key={item.id} value={item.id}>
                {sourceName(item)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="ciq-document-viewer__toolbar" role="toolbar" aria-label="Document viewer controls">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`ciq-viewer-mode-button ${mode === "pages" ? "is-active" : ""}`}
            onClick={() => setMode("pages")}
          >
            <Page />
            Pages
          </button>
          <button
            type="button"
            className={`ciq-viewer-mode-button ${mode === "text" ? "is-active" : ""}`}
            onClick={() => setMode("text")}
            disabled={!document.extractedText}
          >
            <Text />
            Text
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <a
            className="ciq-viewer-icon-button"
            href={api.documentDownloadUrl(document.id)}
            download={sourceName(document)}
            aria-label="Download original PDF"
            title="Download original PDF"
          >
            <Download />
          </a>
        </div>
      </div>

      <div className="ciq-document-viewer__controls">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="ciq-viewer-icon-button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1 || !pageCount}
            aria-label="Previous page"
          >
            <NavArrowLeft />
          </button>
          <form
            className="flex items-center gap-1 text-xs"
            onSubmit={(event) => {
              event.preventDefault()
              goToPage(Number.parseInt(pageEntry, 10) || 1)
            }}
          >
            <input
              className="h-8 w-11 rounded-md border border-[var(--ciq-border)] bg-[var(--ciq-surface)] text-center font-[var(--ciq-font-mono)]"
              inputMode="numeric"
              aria-label="Page number"
              value={pageEntry}
              onChange={(event) => setPageEntry(event.target.value.replace(/\D/g, ""))}
            />
            <span className="text-[var(--ciq-ink-muted)]">/ {pageCount || "—"}</span>
          </form>
          <button
            type="button"
            className="ciq-viewer-icon-button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={!pageCount || currentPage >= pageCount}
            aria-label="Next page"
          >
            <NavArrowRight />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="ciq-viewer-icon-button"
            onClick={() => setZoom((value) => Math.max(60, value - 20))}
            disabled={zoom <= 60}
            aria-label="Zoom out"
          >
            <ZoomOut />
          </button>
          <button
            type="button"
            className="min-w-12 text-center font-[var(--ciq-font-mono)] text-[0.65rem] font-bold text-[var(--ciq-ink-muted)]"
            onClick={() => setZoom(100)}
            title="Fit width"
            aria-label="Fit width"
          >
            {zoom}%
          </button>
          <button
            type="button"
            className="ciq-viewer-icon-button"
            onClick={() => setZoom((value) => Math.min(220, value + 20))}
            disabled={zoom >= 220}
            aria-label="Zoom in"
          >
            <ZoomIn />
          </button>
        </div>
      </div>

      <form
        className="ciq-document-viewer__search"
        onSubmit={(event) => {
          event.preventDefault()
          runSearch()
        }}
      >
        <Search className="h-4 w-4 text-[var(--ciq-ink-muted)]" aria-hidden="true" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value)
            setSearchCursor(-1)
          }}
          placeholder="Search extracted document text"
          aria-label="Search document"
        />
        {searchQuery && (
          <button type="submit" disabled={!matchingPages.length}>
            {matchingPages.length
              ? `${Math.max(1, searchCursor + 1)}/${matchingPages.length}`
              : "No results"}
          </button>
        )}
      </form>

      {mode === "pages" ? (
        <div
          ref={scrollRef}
          className="ciq-document-viewer__pages"
          onScroll={updateVisiblePage}
        >
          {preparing ? (
            <div className="grid min-h-full place-items-center p-8">
              <div className="max-w-xs text-center">
                <div className="ciq-viewer-loader mx-auto" aria-hidden="true" />
                <h3 className="mt-5 font-[var(--ciq-font-display)] text-lg text-[var(--ciq-ink)]">
                  Preparing page view
                </h3>
                <p className="mt-2 text-xs leading-5 text-[var(--ciq-ink-muted)]">
                  The source PDF is being converted into secure review pages.
                  You can keep working while this finishes.
                </p>
                {manifest?.job && (
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--ciq-border)]">
                    <div
                      className="h-full bg-[var(--ciq-brand)] transition-[width]"
                      style={{ width: `${manifest.job.progress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : failed ? (
            <div className="grid min-h-full place-items-center p-8">
              <div className="max-w-xs text-center">
                <Page className="mx-auto h-9 w-9 text-[var(--ciq-critical)]" />
                <h3 className="mt-4 text-base font-bold">Page view unavailable</h3>
                <p className="mt-2 text-xs leading-5 text-[var(--ciq-ink-muted)]">
                  {manifest?.error || safeViewerError(renditionQuery.error)}
                </p>
                <Button className="mt-4" size="sm" onClick={retryPreparation}>
                  <Refresh />
                  Try again
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="ciq-document-viewer__page-stack"
              style={{ width: `${zoom}%` }}
            >
              {pages.map((pageNumber) => {
                const unavailable =
                  imageFailures.has(pageNumber)
                  || (
                    manifest?.status === "degraded"
                    && !availablePages.has(pageNumber)
                  )
                return (
                  <article
                    key={pageNumber}
                    ref={(element) => {
                      if (element) pageRefs.current.set(pageNumber, element)
                      else pageRefs.current.delete(pageNumber)
                    }}
                    className={`ciq-document-page ${currentPage === pageNumber ? "is-current" : ""}`}
                    data-page-number={pageNumber}
                    aria-label={`Page ${pageNumber}`}
                  >
                    <div className="ciq-document-page__label">
                      Page {pageNumber}
                    </div>
                    {unavailable ? (
                      <div className="grid aspect-[8.5/11] place-items-center bg-[var(--ciq-surface)] p-8 text-center">
                        <div>
                          <Page className="mx-auto h-7 w-7 text-[var(--ciq-warning)]" />
                          <p className="mt-3 text-xs font-semibold">
                            Page image unavailable
                          </p>
                        </div>
                      </div>
                    ) : (
                      <img
                        src={api.documentPageUrl(
                          document.id,
                          pageNumber,
                          manifest?.version,
                        )}
                        alt={`Page ${pageNumber} of ${sourceName(document)}`}
                        loading={pageNumber <= 2 ? "eager" : "lazy"}
                        decoding="async"
                        onError={() =>
                          setImageFailures((current) => {
                            const next = new Set(current)
                            next.add(pageNumber)
                            return next
                          })
                        }
                      />
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div ref={scrollRef} className="ciq-document-viewer__text">
          {extractedPages.length ? (
            extractedPages.map((page) => (
              <section
                key={page.page}
                className="ciq-document-text-page"
                aria-label={`Extracted text from page ${page.page}`}
              >
                <button type="button" onClick={() => goToPage(page.page)}>
                  Page {page.page}
                </button>
                <pre>{highlightedText(page.text, searchQuery)}</pre>
              </section>
            ))
          ) : (
            <div className="grid h-full place-items-center p-8 text-center text-sm text-[var(--ciq-ink-muted)]">
              Extracted text is unavailable for this document.
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

