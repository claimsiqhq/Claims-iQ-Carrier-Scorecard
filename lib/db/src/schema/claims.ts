import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { usersTable } from "./auth";
import { organizations } from "./organizations";

export const systemWorkflowStateEnum = pgEnum("system_workflow_state", [
  "uploaded",
  "processing",
  "ready",
  "error",
  "archived",
]);

export const aiWorkflowStateEnum = pgEnum("ai_workflow_state", [
  "not_started",
  "queued",
  "running",
  "succeeded",
  "degraded",
  "failed",
  "cancelled",
]);

export const humanReviewStateEnum = pgEnum("human_review_state", [
  "unassigned",
  "pending",
  "in_review",
  "approved",
  "changes_requested",
]);

export const findingDispositionEnum = pgEnum("finding_disposition", [
  "open",
  "accepted",
  "dismissed",
  "remediated",
  "overridden",
]);

export const auditRunStateEnum = pgEnum("audit_run_state", [
  "succeeded",
  "degraded",
  "failed",
  "cancelled",
]);

export const processingJobTypeEnum = pgEnum("processing_job_type", [
  "ingest",
  "audit",
  "retry",
  "reprocess",
  "extract",
]);

export const processingJobStateEnum = pgEnum("processing_job_state", [
  "queued",
  "running",
  "succeeded",
  "degraded",
  "failed",
  "cancelled",
]);

export const processingJobStageEnum = pgEnum("processing_job_stage", [
  "uploaded",
  "scanning",
  "extracting",
  "auditing",
  "degraded",
  "completed",
  "failed",
  "cancelled",
]);

export const processingAttemptStateEnum = pgEnum("processing_attempt_state", [
  "running",
  "succeeded",
  "degraded",
  "failed",
  "cancelled",
  "lease_expired",
]);

export const claims = pgTable("claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  claimNumber: text("claim_number").notNull(), /* PII: claim identifier */
  insuredName: text("insured_name").notNull(), /* PII: personal name — subject to GDPR right-to-erasure */
  carrier: text("carrier"),
  jobType: text("job_type"),
  dateOfLoss: date("date_of_loss"),
  status: text("status").notNull().default("pending"),
  policyNumber: text("policy_number"), /* PII: policy identifier */
  lossType: text("loss_type"),
  propertyAddress: text("property_address"), /* PII: physical address — subject to GDPR right-to-erasure */
  adjuster: text("adjuster"), /* PII: adjuster name */
  totalClaimAmount: text("total_claim_amount"), /* PII: financial data */
  deductible: text("deductible"), /* PII: financial data */
  summary: text("summary"), /* may contain PII extracted from claim documents */
  ownerUserId: varchar("owner_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  assigneeUserId: varchar("assignee_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  systemStatus: systemWorkflowStateEnum("system_status").notNull().default("uploaded"),
  aiStatus: aiWorkflowStateEnum("ai_status").notNull().default("not_started"),
  humanReviewStatus: humanReviewStateEnum("human_review_status")
    .notNull()
    .default("unassigned"),
  currentAuditId: uuid("current_audit_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("idx_claims_claim_number").on(table.claimNumber),
  index("idx_claims_org_created").on(table.organizationId, table.createdAt),
  index("idx_claims_org_workflow").on(
    table.organizationId,
    table.systemStatus,
    table.aiStatus,
  ),
  index("idx_claims_org_assignee_review").on(
    table.organizationId,
    table.assigneeUserId,
    table.humanReviewStatus,
  ),
]);

export const claimsRelations = relations(claims, ({ many }) => ({
  documents: many(documents),
  audits: many(audits),
}));

export type Claim = typeof claims.$inferSelect;

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  claimId: uuid("claim_id").references(() => claims.id, { onDelete: "cascade" }),
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  type: text("type"),
  fileUrl: text("file_url"), /* storage path — may indirectly identify claim */
  sourceSha256: text("source_sha256"),
  pageCount: integer("page_count"),
  extractedText: text("extracted_text"), /* PII: may contain personal data extracted from claim PDF */
  metadata: jsonb("metadata"), /* PII: may contain fileName, parsed claim data */
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("idx_documents_claim_id").on(table.claimId),
  index("idx_documents_org_claim").on(table.organizationId, table.claimId),
  index("idx_documents_org_storage_path").on(table.organizationId, table.fileUrl),
]);

export const documentsRelations = relations(documents, ({ one }) => ({
  claim: one(claims, { fields: [documents.claimId], references: [claims.id] }),
}));

export type Document = typeof documents.$inferSelect;

export const audits = pgTable("audits", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  claimId: uuid("claim_id").references(() => claims.id, { onDelete: "cascade" }),
  auditRunId: uuid("audit_run_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  supersedesAuditId: uuid("supersedes_audit_id"),
  overallScore: numeric("overall_score"),
  technicalScore: numeric("technical_score"),
  presentationScore: numeric("presentation_score"),
  riskLevel: text("risk_level"),
  approvalStatus: text("approval_status"),
  executiveSummary: text("executive_summary"),
  rawResponse: jsonb("raw_response"),
  visionAnalysis: jsonb("vision_analysis"),
  rulesetVersion: text("ruleset_version").notNull().default("unknown"),
  rulesetHash: text("ruleset_hash"),
  promptIdentifier: text("prompt_identifier").notNull().default("carrier-audit"),
  promptHash: text("prompt_hash"),
  modelIdentifier: text("model_identifier").notNull().default("unknown"),
  sourceDocumentHashes: jsonb("source_document_hashes")
    .$type<Array<{ documentId: string; sha256: string | null }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  actorUserId: varchar("actor_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  processingJobId: uuid("processing_job_id"),
  fallbackUsed: boolean("fallback_used").notNull().default(false),
  degraded: boolean("degraded").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_audits_claim_id").on(table.claimId),
  unique("uq_audits_run_id").on(table.auditRunId),
  unique("uq_audits_org_claim_version").on(
    table.organizationId,
    table.claimId,
    table.versionNumber,
  ),
  index("idx_audits_org_claim_version").on(
    table.organizationId,
    table.claimId,
    table.versionNumber,
  ),
  index("idx_audits_job").on(table.processingJobId),
]);

export const auditsRelations = relations(audits, ({ one, many }) => ({
  claim: one(claims, { fields: [audits.claimId], references: [claims.id] }),
  sections: many(auditSections),
  findings: many(auditFindings),
  structured: many(auditStructured),
}));

export type Audit = typeof audits.$inferSelect;

export const auditSections = pgTable("audit_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
  section: text("section"),
  score: numeric("score"),
  reasoning: text("reasoning"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_sections_audit_id").on(table.auditId),
  index("idx_sections_org_audit").on(table.organizationId, table.auditId),
]);

export const auditSectionsRelations = relations(auditSections, ({ one }) => ({
  audit: one(audits, { fields: [auditSections.auditId], references: [audits.id] }),
}));

export type AuditSection = typeof auditSections.$inferSelect;

export const auditFindings = pgTable("audit_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
  type: text("type"),
  severity: text("severity"),
  title: text("title"),
  description: text("description"),
  sourceDocumentId: uuid("source_document_id").references(() => documents.id),
  disposition: findingDispositionEnum("disposition").notNull().default("open"),
  overrideReason: text("override_reason"),
  reviewNotes: text("review_notes"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("idx_findings_audit_id").on(table.auditId),
  index("idx_findings_org_audit").on(table.organizationId, table.auditId),
  index("idx_findings_org_disposition").on(
    table.organizationId,
    table.disposition,
  ),
]);

export const auditFindingsRelations = relations(auditFindings, ({ one }) => ({
  audit: one(audits, { fields: [auditFindings.auditId], references: [audits.id] }),
  sourceDocument: one(documents, { fields: [auditFindings.sourceDocumentId], references: [documents.id] }),
}));

export type AuditFinding = typeof auditFindings.$inferSelect;

export const auditStructured = pgTable("audit_structured", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
  deferredItems: jsonb("deferred_items"),
  invoiceAdjustments: jsonb("invoice_adjustments"),
  scopeDeviations: jsonb("scope_deviations"),
  unknowns: jsonb("unknowns"),
  carrierQuestions: jsonb("carrier_questions"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_audit_structured_org_audit").on(
    table.organizationId,
    table.auditId,
  ),
]);

export const auditStructuredRelations = relations(auditStructured, ({ one }) => ({
  audit: one(audits, { fields: [auditStructured.auditId], references: [audits.id] }),
}));

export type AuditStructured = typeof auditStructured.$inferSelect;

export const auditVersions = pgTable("audit_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  claimId: uuid("claim_id").references(() => claims.id, { onDelete: "cascade" }),
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
  auditRunId: uuid("audit_run_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  supersedesAuditId: uuid("supersedes_audit_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uq_audit_versions_org_claim_version").on(
    table.organizationId,
    table.claimId,
    table.versionNumber,
  ),
  unique("uq_audit_versions_audit").on(table.auditId),
  index("idx_audit_versions_org_claim").on(
    table.organizationId,
    table.claimId,
    table.versionNumber,
  ),
]);

export type AuditVersion = typeof auditVersions.$inferSelect;

export const processingJobs = pgTable("processing_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  claimId: uuid("claim_id").references(() => claims.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  requestedByUserId: varchar("requested_by_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  type: processingJobTypeEnum("type").notNull(),
  status: processingJobStateEnum("status").notNull().default("queued"),
  stage: processingJobStageEnum("stage").notNull().default("uploaded"),
  progress: integer("progress").notNull().default(0),
  priority: integer("priority").notNull().default(100),
  idempotencyKey: text("idempotency_key").notNull(),
  payload: jsonb("payload")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  errorMetadata: jsonb("error_metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  unique("uq_processing_jobs_org_idempotency").on(
    table.organizationId,
    table.idempotencyKey,
  ),
  index("idx_processing_jobs_claim").on(
    table.organizationId,
    table.claimId,
    table.createdAt,
  ),
  index("idx_processing_jobs_ready").on(
    table.status,
    table.availableAt,
    table.priority,
    table.createdAt,
  ),
  index("idx_processing_jobs_expired_lease").on(
    table.status,
    table.leaseExpiresAt,
  ),
]);

export const processingJobAttempts = pgTable("processing_job_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  jobId: uuid("job_id")
    .notNull()
    .references(() => processingJobs.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  workerId: text("worker_id").notNull(),
  status: processingAttemptStateEnum("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  errorMetadata: jsonb("error_metadata").$type<Record<string, unknown>>(),
}, (table) => [
  unique("uq_processing_job_attempt_number").on(table.jobId, table.attemptNumber),
  index("idx_processing_job_attempts_org_job").on(
    table.organizationId,
    table.jobId,
  ),
]);

export const auditRuns = pgTable("audit_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  claimId: uuid("claim_id").references(() => claims.id, { onDelete: "cascade" }),
  processingJobId: uuid("processing_job_id").references(() => processingJobs.id, {
    onDelete: "set null",
  }),
  actorUserId: varchar("actor_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  status: auditRunStateEnum("status").notNull(),
  rulesetVersion: text("ruleset_version").notNull(),
  rulesetHash: text("ruleset_hash"),
  rulesetSnapshot: jsonb("ruleset_snapshot").$type<Record<string, unknown>>(),
  promptIdentifier: text("prompt_identifier").notNull(),
  promptHash: text("prompt_hash"),
  promptSnapshot: jsonb("prompt_snapshot").$type<Record<string, unknown>>(),
  modelIdentifier: text("model_identifier").notNull(),
  sourceDocumentHashes: jsonb("source_document_hashes")
    .$type<Array<{ documentId: string; sha256: string | null }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  providerRequestIds: jsonb("provider_request_ids")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  fallbackUsed: boolean("fallback_used").notNull().default(false),
  degraded: boolean("degraded").notNull().default(false),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  errorMetadata: jsonb("error_metadata").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_audit_runs_org_claim_created").on(
    table.organizationId,
    table.claimId,
    table.createdAt,
  ),
  index("idx_audit_runs_job").on(table.processingJobId),
  index("idx_audit_runs_org_status").on(table.organizationId, table.status),
]);

export const evidenceAnchors = pgTable("evidence_anchors", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  findingId: uuid("finding_id")
    .notNull()
    .references(() => auditFindings.id, { onDelete: "cascade" }),
  sourceDocumentId: uuid("source_document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  isMapped: boolean("is_mapped").notNull().default(false),
  pageNumber: integer("page_number"),
  rawLocation: text("raw_location"),
  quote: text("quote"),
  anchorData: jsonb("anchor_data").$type<Record<string, unknown>>(),
  mappingMethod: text("mapping_method").notNull().default("unmapped"),
  confidence: numeric("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_evidence_anchors_org_finding").on(
    table.organizationId,
    table.findingId,
  ),
  index("idx_evidence_anchors_document_page").on(
    table.sourceDocumentId,
    table.pageNumber,
  ),
]);

export const claimActivity = pgTable("claim_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => claims.id, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  activityType: text("activity_type").notNull(),
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_claim_activity_org_claim_created").on(
    table.organizationId,
    table.claimId,
    table.createdAt,
  ),
  index("idx_claim_activity_actor").on(table.organizationId, table.actorUserId),
]);

export type ProcessingJob = typeof processingJobs.$inferSelect;
export type ProcessingJobAttempt = typeof processingJobAttempts.$inferSelect;
export type AuditRun = typeof auditRuns.$inferSelect;
export type EvidenceAnchor = typeof evidenceAnchors.$inferSelect;
export type ClaimActivity = typeof claimActivity.$inferSelect;
