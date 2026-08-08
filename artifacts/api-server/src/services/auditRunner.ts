import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  auditFindings,
  auditRuns,
  auditSections,
  auditStructured,
  auditVersions,
  audits,
  claimActivity,
  claims,
  db,
  documents,
  evidenceAnchors,
  pool,
} from "@workspace/db";
import * as schema from "@workspace/db/schema";
import {
  AuditOperationalError,
  runFinalAudit,
  type AuditResponse,
} from "./audit";
import { InsufficientAuditEvidenceError } from "./scoringEngine";
import {
  CarrierRulesetUnavailableError,
  normalizeCarrierKey,
} from "./carrierRulesetService";
import {
  resolveQuestionAuditConfiguration,
  type QuestionAuditConfiguration,
} from "./runQuestionAudit";
import { AuditPromptConfigurationError } from "./auditPromptService";
import { env } from "../env";
import { downloadFile } from "../lib/supabaseStorage";
import logger from "../lib/logger";
import { nextAuditVersion } from "./auditVersioning";

export interface AuditRunRequestContext {
  organizationId: string;
  actorUserId?: string | null;
  processingJobId?: string | null;
}

export interface AuditSaveResult {
  success: boolean;
  outcome: "succeeded" | "degraded" | "failed";
  auditId?: string;
  auditRunId?: string;
  versionNumber?: number;
  overallScore?: number;
  error?: string;
}

type SourceHash = { documentId: string; sha256: string | null };

type PendingFinding = {
  values: {
    organizationId: string;
    auditId: string;
    type: string;
    severity: string;
    title: string;
    description: string;
    sourceDocumentId: string | null;
    metadata: Record<string, unknown>;
  };
  evidence: Array<{
    sourceDocumentId: string | null;
    isMapped: boolean;
    pageNumber: number | null;
    rawLocation: string;
    mappingMethod: string;
    confidence: string | null;
  }>;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function pageFromLocation(location: string): number | null {
  const match = location.match(/(?:page|pg\.?|p\.)\s*#?\s*(\d+)/i)
    ?? location.match(/===\s*page\s+(\d+)\s*===/i);
  if (!match?.[1]) return null;
  const page = Number.parseInt(match[1], 10);
  return Number.isFinite(page) && page > 0 ? page : null;
}

function buildEvidence(
  locations: string[],
  sourceDocument: {
    id: string;
    pageCount: number | null;
    extractedText: string | null;
  } | null,
  confidence?: number,
) {
  return locations.map((rawLocation) => {
    const pageNumber = pageFromLocation(rawLocation);
    const markerPattern = pageNumber
      ? new RegExp(`={3,}\\s*page\\s+${pageNumber}\\s*={3,}`, "i")
      : null;
    const pageIsVerified = Boolean(
      sourceDocument
      && pageNumber
      && (
        (sourceDocument.pageCount !== null
          && pageNumber <= sourceDocument.pageCount)
        || (
          sourceDocument.pageCount === null
          && markerPattern?.test(sourceDocument.extractedText ?? "")
        )
      ),
    );
    return {
      sourceDocumentId: pageIsVerified ? sourceDocument!.id : null,
      isMapped: pageIsVerified,
      pageNumber,
      rawLocation,
      mappingMethod: pageIsVerified
        ? "verified_single_document_page_reference"
        : "unmapped",
      confidence:
        typeof confidence === "number"
          ? String(Math.min(Math.max(confidence > 1 ? confidence / 100 : confidence, 0), 1))
          : null,
    };
  });
}

async function persistTerminalRun(input: {
  organizationId: string;
  claimId: string;
  processingJobId?: string | null;
  actorUserId?: string | null;
  status: "degraded" | "failed";
  rulesetVersion: string;
  rulesetHash: string | null;
  rulesetSnapshot?: Record<string, unknown> | null;
  promptIdentifier: string;
  promptHash: string | null;
  promptSnapshot?: Record<string, unknown> | null;
  modelIdentifier: string;
  sourceDocumentHashes: SourceHash[];
  startedAt: Date;
  error: unknown;
}): Promise<string> {
  const operational = input.error instanceof AuditOperationalError
    ? input.error
    : null;
  const errorCode = operational?.code
    ?? (input.error instanceof InsufficientAuditEvidenceError
      ? input.error.code
      : input.error instanceof CarrierRulesetUnavailableError
        ? input.error.code
        : input.error instanceof AuditPromptConfigurationError
          ? input.error.code
          : "audit_execution_failed");
  const errorMessage = input.error instanceof Error
    ? input.error.message
    : "Audit execution failed";
  const auditRunId = randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(auditRuns).values({
      id: auditRunId,
      organizationId: input.organizationId,
      claimId: input.claimId,
      processingJobId: input.processingJobId ?? null,
      actorUserId: input.actorUserId ?? null,
      status: input.status,
      rulesetVersion: input.rulesetVersion,
      rulesetHash: input.rulesetHash,
      rulesetSnapshot: input.rulesetSnapshot ?? null,
      promptIdentifier: input.promptIdentifier,
      promptHash: input.promptHash,
      promptSnapshot: input.promptSnapshot ?? null,
      modelIdentifier: input.modelIdentifier,
      sourceDocumentHashes: input.sourceDocumentHashes,
      providerRequestIds: [],
      fallbackUsed: false,
      degraded: input.status === "degraded",
      errorCode,
      errorMessage: errorMessage.slice(0, 2000),
      errorMetadata: operational?.metadata ?? {
        errorName: input.error instanceof Error ? input.error.name : "UnknownError",
      },
      startedAt: input.startedAt,
      completedAt: new Date(),
    });

    const [currentClaim] = await tx
      .select({ currentAuditId: claims.currentAuditId })
      .from(claims)
      .where(
        and(
          eq(claims.id, input.claimId),
          eq(claims.organizationId, input.organizationId),
        ),
      )
      .limit(1);

    await tx
      .update(claims)
      .set({
        status: currentClaim?.currentAuditId ? "analyzed" : "pending",
        systemStatus: "ready",
        aiStatus: input.status,
      })
      .where(
        and(
          eq(claims.id, input.claimId),
          eq(claims.organizationId, input.organizationId),
        ),
      );

    await tx.insert(claimActivity).values({
      organizationId: input.organizationId,
      claimId: input.claimId,
      actorUserId: input.actorUserId ?? null,
      activityType: `audit_${input.status}`,
      metadata: {
        auditRunId,
        processingJobId: input.processingJobId ?? null,
        errorCode,
      },
    });
  });

  return auditRunId;
}

export async function runAndSaveAudit(
  claimId: string,
  context: AuditRunRequestContext,
): Promise<AuditSaveResult> {
  const startedAt = new Date();
  const [claim] = await db
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.id, claimId),
        eq(claims.organizationId, context.organizationId),
      ),
    )
    .limit(1);
  if (!claim) {
    return {
      success: false,
      outcome: "failed",
      error: "Claim not found",
    };
  }

  const claimDocuments = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.claimId, claimId),
        eq(documents.organizationId, context.organizationId),
      ),
    );

  const reportParts = [
    `Claim Number: ${claim.claimNumber}`,
    `Insured: ${claim.insuredName}`,
    `Carrier: ${claim.carrier ?? ""}`,
    `Date of Loss: ${claim.dateOfLoss ?? ""}`,
    "",
  ];
  for (const document of claimDocuments) {
    reportParts.push(`--- Document: ${document.type ?? "document"} ---`);
    reportParts.push(document.extractedText || "[No text content available]");
    reportParts.push("");
  }
  const reportText = reportParts.join("\n");

  const carrierKey = normalizeCarrierKey(claim.carrier || "unidentified-carrier");
  let questionAuditConfiguration: QuestionAuditConfiguration | undefined;
  let rulesetVersion = "unavailable";
  let rulesetHash: string | null = null;
  let rulesetSnapshot: Record<string, unknown> | null = null;
  let promptIdentifier = `carrier-audit:${carrierKey}:unresolved`;
  let promptHash: string | null = null;
  let promptSnapshot: Record<string, unknown> | null = null;
  let modelIdentifier = env.CARRIER_AUDIT_MODEL;

  let pdfBuffer: Buffer | undefined;
  let sourceDownloadError: unknown;
  const pdfDocument = claimDocuments.find(
    (document) =>
      document.fileUrl
      && (
        document.type === "claim_file"
        || document.fileUrl.toLowerCase().endsWith(".pdf")
      ),
  );
  if (pdfDocument?.fileUrl) {
    try {
      pdfBuffer = await downloadFile(pdfDocument.fileUrl);
      if (!pdfDocument.sourceSha256) {
        const sourceSha256 = sha256(pdfBuffer);
        await db
          .update(documents)
          .set({ sourceSha256 })
          .where(
            and(
              eq(documents.id, pdfDocument.id),
              eq(documents.organizationId, context.organizationId),
            ),
          );
        pdfDocument.sourceSha256 = sourceSha256;
      }
    } catch (error) {
      sourceDownloadError = error;
    }
  }

  const sourceDocumentHashes: SourceHash[] = claimDocuments.map((document) => ({
    documentId: document.id,
    sha256:
      document.sourceSha256
      ?? (document.extractedText ? sha256(document.extractedText) : null),
  }));

  let auditResult: AuditResponse;
  try {
    questionAuditConfiguration = await resolveQuestionAuditConfiguration(
      claim.carrier ?? "",
      context.organizationId,
    );
    rulesetVersion = questionAuditConfiguration.ruleset.version || "unknown";
    rulesetHash = sha256(stableJson(questionAuditConfiguration.ruleset));
    rulesetSnapshot = questionAuditConfiguration.ruleset as unknown as Record<
      string,
      unknown
    >;
    promptIdentifier = questionAuditConfiguration.prompts.promptIdentifier;
    promptSnapshot = {
      promptVersion: questionAuditConfiguration.prompts.promptVersion,
      systemPrompt: questionAuditConfiguration.prompts.systemPrompt,
      userPromptTemplate:
        questionAuditConfiguration.prompts.userPromptTemplate,
    };
    promptHash = sha256(stableJson(promptSnapshot));
    modelIdentifier =
      questionAuditConfiguration.prompts.modelIdentifier;

    if (sourceDownloadError) {
      throw new AuditOperationalError({
        message: "The authorized source document could not be downloaded for auditing.",
        code: "source_document_download_failed",
        outcome: "failed",
        metadata: {
          cause:
            sourceDownloadError instanceof Error
              ? sourceDownloadError.message
              : "Unknown storage error",
        },
      });
    }

    const incompleteExtraction = claimDocuments.find((document) => {
      const metadata = document.metadata as Record<string, unknown> | null;
      const extraction = metadata?.extractionDocument as
        | Record<string, unknown>
        | undefined;
      const failedPages = Array.isArray(extraction?.failedPages)
        ? extraction.failedPages
        : [];
      const filteredPages = Array.isArray(extraction?.filteredPages)
        ? extraction.filteredPages
        : [];
      return failedPages.length > 0 || filteredPages.length > 0;
    });
    if (incompleteExtraction) {
      throw new AuditOperationalError({
        message: "Document extraction was incomplete; a partial source will not be scored.",
        code: "source_extraction_degraded",
        outcome: "degraded",
        metadata: { documentId: incompleteExtraction.id },
      });
    }

    auditResult = await runFinalAudit(
      reportText,
      {
        claim_number: claim.claimNumber ?? "",
        insured_name: claim.insuredName ?? "",
        carrier_name: claim.carrier ?? "",
      },
      {
        pdfBuffer,
        requestId: context.processingJobId ?? randomUUID(),
        questionAuditConfiguration,
      },
    );
  } catch (error) {
    const outcome = error instanceof AuditOperationalError
      ? error.outcome
      : "failed";
    logger.error(
      { error, claimId, organizationId: context.organizationId, outcome },
      "Carrier audit failed without producing a score",
    );
    const auditRunId = await persistTerminalRun({
      organizationId: context.organizationId,
      claimId,
      processingJobId: context.processingJobId,
      actorUserId: context.actorUserId,
      status: outcome,
      rulesetVersion,
      rulesetHash,
      rulesetSnapshot,
      promptIdentifier,
      promptHash,
      promptSnapshot,
      modelIdentifier,
      sourceDocumentHashes,
      startedAt,
      error,
    });
    return {
      success: false,
      outcome,
      auditRunId,
      error: error instanceof Error ? error.message : "Audit failed",
    };
  }

  const oa = auditResult.overall_audit;
  const da = auditResult.desk_adjuster_scorecard;
  const fa = auditResult.field_adjuster_scorecard;
  const client = await pool.connect();
  const auditRunId = randomUUID();

  try {
    await client.query("BEGIN");
    const tx = drizzle(client, { schema });

    const lockedClaim = await client.query<{ current_audit_id: string | null }>(
      `
        SELECT current_audit_id
        FROM claims
        WHERE id = $1 AND organization_id = $2
        FOR UPDATE
      `,
      [claimId, context.organizationId],
    );
    if (!lockedClaim.rows[0]) throw new Error("Claim not found during audit persistence");

    const versionRows = await tx
      .select({ versionNumber: audits.versionNumber })
      .from(audits)
      .where(
        and(
          eq(audits.claimId, claimId),
          eq(audits.organizationId, context.organizationId),
        ),
      )
      .orderBy(desc(audits.versionNumber));
    const versionNumber = nextAuditVersion(
      versionRows.map((version) => version.versionNumber),
    );
    const supersedesAuditId = lockedClaim.rows[0].current_audit_id;

    await tx.insert(auditRuns).values({
      id: auditRunId,
      organizationId: context.organizationId,
      claimId,
      processingJobId: context.processingJobId ?? null,
      actorUserId: context.actorUserId ?? null,
      status: "succeeded",
      rulesetVersion,
      rulesetHash,
      rulesetSnapshot,
      promptIdentifier,
      promptHash,
      promptSnapshot,
      modelIdentifier,
      sourceDocumentHashes,
      providerRequestIds: auditResult.provider_request_ids,
      fallbackUsed: false,
      degraded: false,
      startedAt,
      completedAt: new Date(),
    });

    const [newAudit] = await tx
      .insert(audits)
      .values({
        organizationId: context.organizationId,
        claimId,
        auditRunId,
        versionNumber,
        supersedesAuditId,
        overallScore: String(oa.overall_score_percent),
        technicalScore: String(da.points_awarded),
        presentationScore: String(fa.points_awarded),
        riskLevel: oa.technical_risk,
        approvalStatus: oa.readiness,
        executiveSummary: oa.executive_summary,
        rawResponse: auditResult as unknown as Record<string, unknown>,
        visionAnalysis:
          (auditResult.vision_analysis as unknown as Record<string, unknown>)
          ?? null,
        rulesetVersion,
        rulesetHash,
        promptIdentifier,
        promptHash,
        modelIdentifier,
        sourceDocumentHashes,
        actorUserId: context.actorUserId ?? null,
        processingJobId: context.processingJobId ?? null,
        fallbackUsed: false,
        degraded: false,
        startedAt,
        completedAt: new Date(),
      })
      .returning();

    const sectionValues = [
      ...da.categories.map((category) => ({
        organizationId: context.organizationId,
        auditId: newAudit.id,
        section: `da_${category.category_key}`,
        score: String(category.points_awarded),
        reasoning:
          category.questions
            .filter((question) => question.issue)
            .map(
              (question) =>
                `${question.answer}: ${question.issue}${
                  question.fix ? ` → ${question.fix}` : ""
                }`,
            )
            .join("\n") || null,
      })),
      ...fa.categories.map((category) => ({
        organizationId: context.organizationId,
        auditId: newAudit.id,
        section: `fa_${category.category_key}`,
        score: String(category.points_awarded),
        reasoning:
          category.questions
            .filter((question) => question.issue)
            .map(
              (question) =>
                `${question.answer}: ${question.issue}${
                  question.fix ? ` → ${question.fix}` : ""
                }`,
            )
            .join("\n") || null,
      })),
    ];
    if (sectionValues.length > 0) {
      await tx.insert(auditSections).values(sectionValues);
    }

    const singleSourceDocument = claimDocuments.length === 1
      ? {
          id: claimDocuments[0]!.id,
          pageCount: claimDocuments[0]!.pageCount,
          extractedText: claimDocuments[0]!.extractedText,
        }
      : null;
    const pendingFindings: PendingFinding[] = [];
    const allQuestions = [
      ...da.categories.flatMap((category) =>
        category.questions.map((question) => ({
          ...question,
          scorecard: "DA" as const,
          categoryKey: category.category_key,
        })),
      ),
      ...fa.categories.flatMap((category) =>
        category.questions.map((question) => ({
          ...question,
          scorecard: "FA" as const,
          categoryKey: category.category_key,
        })),
      ),
    ];

    for (const question of allQuestions) {
      const evidence = buildEvidence(
        question.evidence_locations,
        singleSourceDocument,
        question.confidence,
      );
      pendingFindings.push({
        values: {
          organizationId: context.organizationId,
          auditId: newAudit.id,
          type: "question_result",
          severity:
            question.answer === "PASS"
              ? "pass"
              : question.answer === "PARTIAL"
                ? "partial"
                : question.answer === "NOT_APPLICABLE"
                  ? "na"
                  : "fail",
          title: question.id,
          description: question.issue || "",
          sourceDocumentId:
            evidence.find((anchor) => anchor.isMapped)?.sourceDocumentId ?? null,
          metadata: {
            category: "question_result",
            scorecard: question.scorecard,
            category_key: question.categoryKey,
            root_issue: question.root_issue,
            answer: question.answer,
            points_awarded: question.points_awarded,
            points_possible: question.points_possible,
            issue: question.issue,
            impact: question.impact,
            fix: question.fix,
            evidence_locations: question.evidence_locations,
            confidence: question.confidence,
          },
        },
        evidence,
      });
    }

    for (const issue of auditResult.issues) {
      const evidence = buildEvidence(
        issue.evidence_locations,
        singleSourceDocument,
      );
      pendingFindings.push({
        values: {
          organizationId: context.organizationId,
          auditId: newAudit.id,
          type: "issue",
          severity: issue.severity,
          title: `[${issue.source_scorecard}] ${issue.question_key}`,
          description: issue.issue,
          sourceDocumentId:
            evidence.find((anchor) => anchor.isMapped)?.sourceDocumentId ?? null,
          metadata: {
            category: "issue",
            source_scorecard: issue.source_scorecard,
            category_key: issue.category_key,
            question_key: issue.question_key,
            root_issue: issue.root_issue,
            impact: issue.impact,
            fix: issue.fix,
            evidence_locations: issue.evidence_locations,
          },
        },
        evidence,
      });
    }

    for (const check of auditResult.validation_checks) {
      pendingFindings.push({
        values: {
          organizationId: context.organizationId,
          auditId: newAudit.id,
          type: "validation",
          severity: check.severity,
          title: check.key,
          description: check.message,
          sourceDocumentId: null,
          metadata: {
            category: "validation",
            key: check.key,
            severity: check.severity,
          },
        },
        evidence: [],
      });
    }

    if (auditResult.vision_analysis) {
      for (const reading of auditResult.vision_analysis.tool_readings) {
        const rawLocation = `Page ${reading.page_number}`;
        const evidence = buildEvidence([rawLocation], singleSourceDocument);
        pendingFindings.push({
          values: {
            organizationId: context.organizationId,
            auditId: newAudit.id,
            type: "vision_tool_reading",
            severity: "info",
            title: `${reading.tool_type}: ${reading.reading_value} ${reading.reading_unit}`,
            description: `${reading.tool_model} reading at ${reading.material_or_location} (${rawLocation})`,
            sourceDocumentId:
              evidence.find((anchor) => anchor.isMapped)?.sourceDocumentId ?? null,
            metadata: { category: "vision_analysis", ...reading },
          },
          evidence,
        });
      }
      for (const damage of auditResult.vision_analysis.damage_verifications) {
        const rawLocation = `Page ${damage.page_number}`;
        const evidence = buildEvidence([rawLocation], singleSourceDocument);
        pendingFindings.push({
          values: {
            organizationId: context.organizationId,
            auditId: newAudit.id,
            type: "vision_damage_verification",
            severity: damage.damage_visible ? "pass" : "warning",
            title: `Damage check: ${damage.caption_claim}`,
            description: damage.damage_visible
              ? `Confirmed: ${damage.damage_type} visible (${rawLocation})`
              : `Discrepancy: ${damage.discrepancy || "damage not apparent"} (${rawLocation})`,
            sourceDocumentId:
              evidence.find((anchor) => anchor.isMapped)?.sourceDocumentId ?? null,
            metadata: { category: "vision_analysis", ...damage },
          },
          evidence,
        });
      }
    }

    if (pendingFindings.length > 0) {
      const insertedFindings = await tx
        .insert(auditFindings)
        .values(pendingFindings.map((finding) => finding.values))
        .returning({ id: auditFindings.id });

      const anchors = pendingFindings.flatMap((finding, index) =>
        finding.evidence.map((anchor) => ({
          organizationId: context.organizationId,
          findingId: insertedFindings[index]!.id,
          sourceDocumentId: anchor.sourceDocumentId,
          isMapped: anchor.isMapped,
          pageNumber: anchor.pageNumber,
          rawLocation: anchor.rawLocation,
          mappingMethod: anchor.mappingMethod,
          confidence: anchor.confidence,
        })),
      );
      if (anchors.length > 0) {
        await tx.insert(evidenceAnchors).values(anchors);
      }
    }

    await tx.insert(auditStructured).values({
      organizationId: context.organizationId,
      auditId: newAudit.id,
      deferredItems: [],
      invoiceAdjustments: [],
      scopeDeviations: [],
      unknowns: [],
      carrierQuestions: [],
    });

    await tx.insert(auditVersions).values({
      organizationId: context.organizationId,
      claimId,
      auditId: newAudit.id,
      auditRunId,
      versionNumber,
      supersedesAuditId,
    });

    await tx
      .update(claims)
      .set({
        currentAuditId: newAudit.id,
        status: "analyzed",
        systemStatus: "ready",
        aiStatus: "succeeded",
      })
      .where(
        and(
          eq(claims.id, claimId),
          eq(claims.organizationId, context.organizationId),
        ),
      );

    await tx.insert(claimActivity).values({
      organizationId: context.organizationId,
      claimId,
      actorUserId: context.actorUserId ?? null,
      activityType: "audit_completed",
      metadata: {
        auditId: newAudit.id,
        auditRunId,
        versionNumber,
        processingJobId: context.processingJobId ?? null,
        overallScore: oa.overall_score_percent,
      },
    });

    await client.query("COMMIT");
    logger.info(
      {
        claimId,
        auditId: newAudit.id,
        auditRunId,
        versionNumber,
        overallScore: oa.overall_score_percent,
      },
      "Append-only carrier audit saved",
    );
    return {
      success: true,
      outcome: "succeeded",
      auditId: newAudit.id,
      auditRunId,
      versionNumber,
      overallScore: oa.overall_score_percent,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ error, claimId }, "Audit persistence failed");
    const failedRunId = await persistTerminalRun({
      organizationId: context.organizationId,
      claimId,
      processingJobId: context.processingJobId,
      actorUserId: context.actorUserId,
      status: "failed",
      rulesetVersion,
      rulesetHash,
      promptIdentifier,
      promptHash,
      modelIdentifier,
      sourceDocumentHashes,
      startedAt,
      error,
    });
    return {
      success: false,
      outcome: "failed",
      auditRunId: failedRunId,
      error: error instanceof Error ? error.message : "Audit persistence failed",
    };
  } finally {
    client.release();
  }
}
