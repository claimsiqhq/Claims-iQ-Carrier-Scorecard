import { pgTable, text, uuid, date, timestamp, numeric, integer, jsonb, index, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const claims = pgTable("claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimNumber: text("claim_number").notNull(), /* PII: claim identifier */
  insuredName: text("insured_name").notNull(), /* PII: personal name — subject to GDPR right-to-erasure */
  carrier: text("carrier"),
  dateOfLoss: date("date_of_loss"),
  status: text("status").notNull().default("pending"),
  policyNumber: text("policy_number"), /* PII: policy identifier */
  lossType: text("loss_type"),
  propertyAddress: text("property_address"), /* PII: physical address — subject to GDPR right-to-erasure */
  adjuster: text("adjuster"), /* PII: adjuster name */
  totalClaimAmount: text("total_claim_amount"), /* PII: financial data */
  deductible: text("deductible"), /* PII: financial data */
  summary: text("summary"), /* may contain PII extracted from claim documents */
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_claims_claim_number").on(table.claimNumber),
]);

export const claimsRelations = relations(claims, ({ many }) => ({
  documents: many(documents),
  audits: many(audits),
}));

export type Claim = typeof claims.$inferSelect;

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").references(() => claims.id, { onDelete: "cascade" }),
  type: text("type"),
  fileUrl: text("file_url"), /* storage path — may indirectly identify claim */
  extractedText: text("extracted_text"), /* PII: may contain personal data extracted from claim PDF */
  metadata: jsonb("metadata"), /* PII: may contain fileName, parsed claim data */
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_documents_claim_id").on(table.claimId),
]);

export const documentsRelations = relations(documents, ({ one }) => ({
  claim: one(claims, { fields: [documents.claimId], references: [claims.id] }),
}));

export type Document = typeof documents.$inferSelect;

export const audits = pgTable("audits", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").references(() => claims.id, { onDelete: "cascade" }),
  overallScore: numeric("overall_score"),
  technicalScore: numeric("technical_score"),
  presentationScore: numeric("presentation_score"),
  riskLevel: text("risk_level"),
  approvalStatus: text("approval_status"),
  executiveSummary: text("executive_summary"),
  rawResponse: jsonb("raw_response"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_audits_claim_id").on(table.claimId),
  unique("uq_audits_claim_id").on(table.claimId),
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
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
  section: text("section"),
  score: numeric("score"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_sections_audit_id").on(table.auditId),
]);

export const auditSectionsRelations = relations(auditSections, ({ one }) => ({
  audit: one(audits, { fields: [auditSections.auditId], references: [audits.id] }),
}));

export type AuditSection = typeof auditSections.$inferSelect;

export const auditFindings = pgTable("audit_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
  type: text("type"),
  severity: text("severity"),
  title: text("title"),
  description: text("description"),
  sourceDocumentId: uuid("source_document_id").references(() => documents.id),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_findings_audit_id").on(table.auditId),
]);

export const auditFindingsRelations = relations(auditFindings, ({ one }) => ({
  audit: one(audits, { fields: [auditFindings.auditId], references: [audits.id] }),
  sourceDocument: one(documents, { fields: [auditFindings.sourceDocumentId], references: [documents.id] }),
}));

export type AuditFinding = typeof auditFindings.$inferSelect;

export const auditStructured = pgTable("audit_structured", {
  id: uuid("id").primaryKey().defaultRandom(),
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
  deferredItems: jsonb("deferred_items"),
  invoiceAdjustments: jsonb("invoice_adjustments"),
  scopeDeviations: jsonb("scope_deviations"),
  unknowns: jsonb("unknowns"),
  carrierQuestions: jsonb("carrier_questions"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const auditStructuredRelations = relations(auditStructured, ({ one }) => ({
  audit: one(audits, { fields: [auditStructured.auditId], references: [audits.id] }),
}));

export type AuditStructured = typeof auditStructured.$inferSelect;

export const auditVersions = pgTable("audit_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").references(() => claims.id, { onDelete: "cascade" }),
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AuditVersion = typeof auditVersions.$inferSelect;
