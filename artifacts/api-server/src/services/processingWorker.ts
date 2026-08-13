import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import {
  acquireWorkerControlDatabase,
  acquireWorkerDatabase,
  claimActivity,
  claims,
  db,
  documents,
  runWithScopedDatabase,
  type DatabaseSessionSettings,
  type WorkspaceDatabase,
} from "@workspace/db";
import {
  assertWorkerJobContext,
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  JobLeaseLostError,
  updateJobStage,
  type ClaimedJob,
} from "./jobQueue";
import {
  listActiveCarrierEntities,
  resolveDetectedCarrierEntity,
} from "./carrierRulesetService";
import { parseClaimFromText } from "./ingest";
import {
  extractPdfTextWithVisionPages,
  renderPdfPageRenditions,
  type PageRenditionSummary,
} from "./finalReportIngestion";
import { runAndSaveAudit } from "./auditRunner";
import {
  createTenantStorageCapability,
  PAGE_RENDITION_VERSION,
  type TenantStorageCapability,
} from "../lib/supabaseStorage";
import logger from "../lib/logger";

const MAX_SOURCE_SIZE = 100 * 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 25_000;
const IDLE_POLL_MS = 1_000;

let workerLoop: Promise<void> | null = null;
let stopping = false;
let wakeIdle: (() => void) | null = null;

class ProcessingFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProcessingFailure";
    this.code = code;
  }
}

function waitForWork(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeIdle = null;
      resolve();
    }, IDLE_POLL_MS);
    wakeIdle = () => {
      clearTimeout(timer);
      wakeIdle = null;
      resolve();
    };
  });
}

async function loadJobDocument(job: ClaimedJob) {
  if (!job.claimId || !job.documentId) {
    throw new ProcessingFailure(
      "job_source_missing",
      "Processing job is missing its claim or document reference",
    );
  }
  const [document] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, job.documentId),
        eq(documents.claimId, job.claimId),
        eq(documents.organizationId, job.organizationId),
      ),
    )
    .limit(1);
  if (!document?.fileUrl) {
    throw new ProcessingFailure(
      "document_not_found",
      "Authorized source document was not found",
    );
  }
  return document;
}

async function processExtractionJob(
  job: ClaimedJob,
  jobDatabase: WorkspaceDatabase,
  storage: TenantStorageCapability,
): Promise<{
  degraded: boolean;
}> {
  const document = await loadJobDocument(job);
  await updateJobStage(jobDatabase, job, "scanning", 10);

  const fileBuffer = await storage.downloadDocument({
    claimId: job.claimId!,
    documentId: document.id,
    storagePath: document.fileUrl!,
  });
  if (fileBuffer.length > MAX_SOURCE_SIZE) {
    throw new ProcessingFailure(
      "source_too_large",
      `Source document exceeds the ${MAX_SOURCE_SIZE / 1024 / 1024}MB processing limit`,
    );
  }

  await updateJobStage(jobDatabase, job, "extracting", 25);
  const metadata = (document.metadata as Record<string, unknown> | null) ?? {};
  const fileName =
    typeof metadata.fileName === "string" ? metadata.fileName : "claim.pdf";
  const contentType =
    typeof metadata.contentType === "string"
      ? metadata.contentType
      : "application/pdf";
  let extractedText: string;
  let extractionDocument: Record<string, unknown> | undefined;
  let renditionDocument: PageRenditionSummary | undefined;
  let degraded = false;

  if (
    contentType.toLowerCase() === "application/pdf"
    || fileName.toLowerCase().endsWith(".pdf")
  ) {
    const vision = await extractPdfTextWithVisionPages({
      pdfBuffer: fileBuffer,
      fileName,
      requestId: job.id,
      onPageRendered: async (page) => {
        await storage.uploadPageRendition({
          claimId: job.claimId!,
          documentId: document.id,
          pageNumber: page.pageNumber,
          body: page.jpegBuffer,
        });
      },
    });
    extractedText = vision.text;
    extractionDocument = vision.extractionDocument as unknown as Record<string, unknown>;
    renditionDocument = vision.renditionDocument;
    degraded =
      vision.extractionDocument.failedPages.length > 0
      || vision.extractionDocument.filteredPages.length > 0;
  } else {
    extractedText = fileBuffer.toString("utf-8");
  }

  if (!extractedText || extractedText.trim().length < 50) {
    throw new ProcessingFailure(
      "insufficient_extracted_text",
      "Source document did not produce enough usable text",
    );
  }

  await db
    .update(documents)
    .set({
      extractedText,
      metadata: {
        ...metadata,
        fileName,
        contentType,
        storagePath: document.fileUrl,
        extractionDocument,
        pageRenditions: renditionDocument
          ? {
              version: renditionDocument.version,
              format: renditionDocument.format,
              status:
                renditionDocument.failed_pages.length > 0
                  ? "degraded"
                  : "ready",
              pageCount: renditionDocument.page_count,
              renderedPages: renditionDocument.rendered_pages,
              failedPages: renditionDocument.failed_pages,
              completedAt: new Date().toISOString(),
            }
          : null,
      },
      pageCount:
        extractionDocument && typeof extractionDocument.page_count === "number"
          ? extractionDocument.page_count
          : document.pageCount,
    })
    .where(
      and(
        eq(documents.id, document.id),
        eq(documents.organizationId, job.organizationId),
      ),
    );

  if (job.type === "extract") {
    await db.insert(claimActivity).values({
      organizationId: job.organizationId,
      claimId: job.claimId!,
      actorUserId: job.requestedByUserId,
      activityType: degraded ? "document_extraction_degraded" : "document_extracted",
      metadata: {
        documentId: document.id,
        processingJobId: job.id,
        extractedCharacters: extractedText.length,
      },
    });
    return { degraded };
  }

  const parsedData = await parseClaimFromText(extractedText);
  let requestedCarrierEntityId =
    typeof job.payload.carrierEntityId === "string" &&
    job.payload.carrierEntityId.trim()
      ? job.payload.carrierEntityId.trim()
      : null;
  if (!requestedCarrierEntityId) {
    const [claimCarrier] = await db
      .select({ carrierEntityId: claims.carrierEntityId })
      .from(claims)
      .where(
        and(
          eq(claims.id, job.claimId!),
          eq(claims.organizationId, job.organizationId),
        ),
      )
      .limit(1);
    requestedCarrierEntityId = claimCarrier?.carrierEntityId ?? null;
  }
  const allowedCarrierEntities = await listActiveCarrierEntities(
    job.organizationId,
  );
  const resolvedCarrierEntity = resolveDetectedCarrierEntity({
    organizationId: job.organizationId,
    entities: allowedCarrierEntities,
    detectedCarrier: parsedData.carrier,
    requestedCarrierEntityId,
  });

  const [updatedClaim] = await db
    .update(claims)
    .set({
      claimNumber: parsedData.claimNumber || `CLM-${job.claimId!.slice(0, 8)}`,
      insuredName: parsedData.insuredName || "Unknown Insured",
      carrierEntityId: resolvedCarrierEntity.id,
      carrier:
        parsedData.carrier.trim() || resolvedCarrierEntity.displayName,
      dateOfLoss: parsedData.dateOfLoss || null,
      status: "pending",
      policyNumber: parsedData.policyNumber || null,
      lossType: parsedData.lossType || null,
      propertyAddress: parsedData.propertyAddress || null,
      adjuster: parsedData.adjusterName || null,
      totalClaimAmount: parsedData.totalClaimAmount || null,
      deductible: parsedData.deductible || null,
      summary: parsedData.summary || null,
      systemStatus: "ready",
      aiStatus: "running",
    })
    .where(
      and(
        eq(claims.id, job.claimId!),
        eq(claims.organizationId, job.organizationId),
        ne(claims.status, "archived"),
        ne(claims.systemStatus, "archived"),
      ),
    )
    .returning({ id: claims.id });
  if (!updatedClaim) {
    throw new ProcessingFailure(
      "claim_update_denied",
      "The claimed job could not update its organization-scoped claim",
    );
  }

  await db
    .update(documents)
    .set({
      metadata: {
        ...metadata,
        fileName,
        contentType,
        storagePath: document.fileUrl,
        parsedData,
        extractionDocument,
        pageRenditions: renditionDocument
          ? {
              version: renditionDocument.version,
              format: renditionDocument.format,
              status:
                renditionDocument.failed_pages.length > 0
                  ? "degraded"
                  : "ready",
              pageCount: renditionDocument.page_count,
              renderedPages: renditionDocument.rendered_pages,
              failedPages: renditionDocument.failed_pages,
              completedAt: new Date().toISOString(),
            }
          : null,
      },
    })
    .where(
      and(
        eq(documents.id, document.id),
        eq(documents.organizationId, job.organizationId),
      ),
    );

  await updateJobStage(jobDatabase, job, "auditing", 70);
  const audit = await runAndSaveAudit(job.claimId!, {
    organizationId: job.organizationId,
    storage,
    actorUserId: job.requestedByUserId,
    processingJobId: job.id,
  });
  if (audit.outcome === "degraded") return { degraded: true };
  if (!audit.success) {
    throw new ProcessingFailure(
      "audit_failed",
      audit.error || "Audit provider failed",
    );
  }
  return { degraded };
}

async function processRenditionJob(
  job: ClaimedJob,
  jobDatabase: WorkspaceDatabase,
  storage: TenantStorageCapability,
): Promise<{ degraded: boolean }> {
  if (!job.claimId || !job.documentId) {
    throw new ProcessingFailure(
      "rendition_source_missing",
      "Page rendition job is missing its claim or document reference",
    );
  }
  const document = await loadJobDocument(job);
  const metadata = (document.metadata as Record<string, unknown> | null) ?? {};
  const fileName =
    typeof metadata.fileName === "string" ? metadata.fileName : "claim.pdf";
  const contentType =
    typeof metadata.contentType === "string"
      ? metadata.contentType
      : "application/pdf";
  if (
    contentType.toLowerCase() !== "application/pdf"
    && !fileName.toLowerCase().endsWith(".pdf")
  ) {
    throw new ProcessingFailure(
      "rendition_source_unsupported",
      "Only PDF documents can produce page renditions",
    );
  }

  await updateJobStage(jobDatabase, job, "scanning", 10);
  await db
    .update(documents)
    .set({
      metadata: {
        ...metadata,
        pageRenditions: {
          version: PAGE_RENDITION_VERSION,
          format: "jpeg",
          status: "preparing",
          pageCount: document.pageCount ?? null,
          renderedPages: [],
          failedPages: [],
          startedAt: new Date().toISOString(),
        },
      },
    })
    .where(
      and(
        eq(documents.id, document.id),
        eq(documents.organizationId, job.organizationId),
      ),
    );

  try {
    const fileBuffer = await storage.downloadDocument({
      claimId: job.claimId,
      documentId: document.id,
      storagePath: document.fileUrl!,
    });
    if (fileBuffer.length > MAX_SOURCE_SIZE) {
      throw new ProcessingFailure(
        "source_too_large",
        `Source document exceeds the ${MAX_SOURCE_SIZE / 1024 / 1024}MB processing limit`,
      );
    }
    await updateJobStage(jobDatabase, job, "extracting", 20);
    const rendition = await renderPdfPageRenditions({
      pdfBuffer: fileBuffer,
      fileName,
      requestId: job.id,
      onPageRendered: async (page) => {
        await storage.uploadPageRendition({
          claimId: job.claimId!,
          documentId: document.id,
          pageNumber: page.pageNumber,
          body: page.jpegBuffer,
        });
      },
      onProgress: async (completedPages, totalPages) => {
        const progress = Math.min(
          90,
          20 + Math.round((completedPages / Math.max(1, totalPages)) * 70),
        );
        await updateJobStage(jobDatabase, job, "extracting", progress);
      },
    });
    const status =
      rendition.failed_pages.length > 0 ? "degraded" : "ready";
    await db
      .update(documents)
      .set({
        pageCount: rendition.page_count,
        metadata: {
          ...metadata,
          pageRenditions: {
            version: rendition.version,
            format: rendition.format,
            status,
            pageCount: rendition.page_count,
            renderedPages: rendition.rendered_pages,
            failedPages: rendition.failed_pages,
            completedAt: new Date().toISOString(),
          },
        },
      })
      .where(
        and(
          eq(documents.id, document.id),
          eq(documents.organizationId, job.organizationId),
        ),
      );
    return { degraded: rendition.failed_pages.length > 0 };
  } catch (error) {
    await db
      .update(documents)
      .set({
        metadata: {
          ...metadata,
          pageRenditions: {
            version: PAGE_RENDITION_VERSION,
            format: "jpeg",
            status: "failed",
            pageCount: document.pageCount ?? null,
            renderedPages: [],
            failedPages: [],
            error:
              error instanceof Error
                ? error.message
                : "Page rendition generation failed",
            completedAt: new Date().toISOString(),
          },
        },
      })
      .where(
        and(
          eq(documents.id, document.id),
          eq(documents.organizationId, job.organizationId),
        ),
      )
      .catch(() => undefined);
    throw error;
  }
}

async function processAuditOnlyJob(
  job: ClaimedJob,
  jobDatabase: WorkspaceDatabase,
  storage: TenantStorageCapability,
): Promise<{
  degraded: boolean;
}> {
  if (!job.claimId) {
    throw new ProcessingFailure("claim_missing", "Audit job has no claim");
  }
  await updateJobStage(jobDatabase, job, "auditing", 30);
  const result = await runAndSaveAudit(job.claimId, {
    organizationId: job.organizationId,
    storage,
    actorUserId: job.requestedByUserId,
    processingJobId: job.id,
  });
  if (result.outcome === "degraded") return { degraded: true };
  if (!result.success) {
    throw new ProcessingFailure("audit_failed", result.error || "Audit failed");
  }
  return { degraded: false };
}

async function processClaimedJob(
  job: ClaimedJob,
  jobDatabase: WorkspaceDatabase,
  storage: TenantStorageCapability,
): Promise<void> {
  let heartbeatError: Error | null = null;
  let heartbeatInFlight = Promise.resolve();
  const heartbeatTimer = setInterval(() => {
    heartbeatInFlight = heartbeatInFlight
      .then(() => heartbeatJob(jobDatabase, job))
      .catch((error) => {
        heartbeatError =
          error instanceof Error ? error : new JobLeaseLostError();
      });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  try {
    if (job.claimId && job.type !== "rendition") {
      await db
        .update(claims)
        .set({
          status: "processing",
          systemStatus: "processing",
          aiStatus: "running",
        })
        .where(
          and(
            eq(claims.id, job.claimId),
            eq(claims.organizationId, job.organizationId),
            ne(claims.status, "archived"),
            ne(claims.systemStatus, "archived"),
          ),
        );
    }

    const outcome =
      job.type === "audit"
        ? await processAuditOnlyJob(job, jobDatabase, storage)
        : job.type === "rendition"
          ? await processRenditionJob(job, jobDatabase, storage)
          : await processExtractionJob(job, jobDatabase, storage);
    if (heartbeatError) throw heartbeatError;
    await completeJob(
      jobDatabase,
      job,
      outcome.degraded ? "degraded" : "succeeded",
      {
        claimId: job.claimId,
        documentId: job.documentId,
      },
    );
  } finally {
    clearInterval(heartbeatTimer);
    await heartbeatInFlight;
  }
}

export function createWorkerJobStorageCapability(
  job: ClaimedJob,
  settings: DatabaseSessionSettings,
): TenantStorageCapability {
  assertWorkerJobContext(job, settings);
  return createTenantStorageCapability({
    organizationId: settings.organizationId!,
    userId: settings.workerId!,
    sessionId: settings.jobId!,
  });
}

async function claimWithWorkerControl(
  workerId: string,
): Promise<ClaimedJob | null> {
  const controlLease = await acquireWorkerControlDatabase(workerId);
  try {
    return await claimNextJob(controlLease.database, workerId);
  } finally {
    await controlLease.release();
  }
}

async function markClaimFailedWhenAttemptsExhausted(
  job: ClaimedJob,
  error: unknown,
): Promise<void> {
  if (
    !job.claimId ||
    job.type === "rendition" ||
    job.attemptCount < job.maxAttempts ||
    error instanceof JobLeaseLostError
  ) {
    return;
  }
  const [claimState] = await db
    .select({ currentAuditId: claims.currentAuditId })
    .from(claims)
    .where(
      and(
        eq(claims.id, job.claimId),
        eq(claims.organizationId, job.organizationId),
        ne(claims.status, "archived"),
        ne(claims.systemStatus, "archived"),
      ),
    )
    .limit(1);
  await db
    .update(claims)
    .set({
      status: claimState?.currentAuditId ? "analyzed" : "error",
      systemStatus: claimState?.currentAuditId ? "ready" : "error",
      aiStatus: "failed",
    })
    .where(
      and(
        eq(claims.id, job.claimId),
        eq(claims.organizationId, job.organizationId),
        ne(claims.status, "archived"),
        ne(claims.systemStatus, "archived"),
      ),
    );
}

async function runLoop(workerId: string): Promise<void> {
  logger.info({ workerId }, "Durable processing worker started");
  while (!stopping) {
    let job: ClaimedJob | null = null;
    let jobLease: Awaited<ReturnType<typeof acquireWorkerDatabase>> | null =
      null;
    try {
      job = await claimWithWorkerControl(workerId);
      if (!job) {
        await waitForWork();
        continue;
      }
      logger.info(
        {
          workerId,
          jobId: job.id,
          jobType: job.type,
          attempt: job.attemptCount,
        },
        "Durable processing job claimed",
      );
      jobLease = await acquireWorkerDatabase({
        organizationId: job.organizationId,
        jobId: job.id,
        workerId,
      });
      assertWorkerJobContext(job, jobLease.settings);
      const storage = createWorkerJobStorageCapability(job, jobLease.settings);
      await runWithScopedDatabase(jobLease, () =>
        processClaimedJob(job!, jobLease!.database, storage),
      );
      logger.info({ workerId, jobId: job.id }, "Durable processing job completed");
    } catch (error) {
      logger.error(
        { error, workerId, jobId: job?.id },
        "Durable processing job failed",
      );
      if (job && jobLease) {
        try {
          await runWithScopedDatabase(jobLease, async () => {
            await markClaimFailedWhenAttemptsExhausted(job!, error);
            await failJob(jobLease!.database, job!, error);
          });
        } catch (failureError) {
          logger.error(
            { failureError, jobId: job.id },
            "Failed to persist processing job failure",
          );
        }
      } else if (!stopping) {
        await waitForWork();
      }
    } finally {
      if (jobLease) await jobLease.release();
    }
  }
  logger.info({ workerId }, "Durable processing worker stopped");
}

export function startDurableWorker(): void {
  if (workerLoop) return;
  stopping = false;
  const workerId = `${process.env.HOSTNAME || "local"}:${process.pid}:${randomUUID()}`;
  workerLoop = runLoop(workerId).finally(() => {
    workerLoop = null;
  });
}

export async function stopDurableWorker(): Promise<void> {
  stopping = true;
  wakeIdle?.();
  await workerLoop;
}
