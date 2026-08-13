import { PAGE_RENDITION_VERSION } from "../lib/supabaseStorage";

export type DocumentRenditionState =
  | "missing"
  | "preparing"
  | "ready"
  | "degraded"
  | "failed";

export interface DocumentRenditionMetadata {
  version: typeof PAGE_RENDITION_VERSION;
  format: "jpeg";
  status: Exclude<DocumentRenditionState, "missing">;
  pageCount: number | null;
  renderedPages: number[];
  failedPages: Array<{ page_number: number; reason: string }>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

function positivePage(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

export function readDocumentRenditionMetadata(
  metadata: unknown,
  fallbackPageCount?: number | null,
): DocumentRenditionMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const raw = (metadata as Record<string, unknown>).pageRenditions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    value.version !== PAGE_RENDITION_VERSION
    || value.format !== "jpeg"
    || !["preparing", "ready", "degraded", "failed"].includes(
      String(value.status),
    )
  ) {
    return null;
  }
  const renderedPages = Array.isArray(value.renderedPages)
    ? value.renderedPages.filter(positivePage)
    : [];
  const failedPages = Array.isArray(value.failedPages)
    ? value.failedPages.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return [];
        }
        const page = entry as Record<string, unknown>;
        return positivePage(page.page_number)
          ? [{
              page_number: page.page_number,
              reason:
                typeof page.reason === "string"
                  ? page.reason
                  : "Page rendition failed",
            }]
          : [];
      })
    : [];
  const pageCount = positivePage(value.pageCount)
    ? value.pageCount
    : positivePage(fallbackPageCount)
      ? fallbackPageCount
      : null;
  return {
    version: PAGE_RENDITION_VERSION,
    format: "jpeg",
    status: value.status as DocumentRenditionMetadata["status"],
    pageCount,
    renderedPages: [...new Set(renderedPages)].sort((a, b) => a - b),
    failedPages: failedPages.sort(
      (a, b) => a.page_number - b.page_number,
    ),
    ...(typeof value.startedAt === "string"
      ? { startedAt: value.startedAt }
      : {}),
    ...(typeof value.completedAt === "string"
      ? { completedAt: value.completedAt }
      : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

