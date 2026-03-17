import { db } from "@workspace/db";
import { claims, documents, audits, auditSections, auditFindings } from "@workspace/db";

async function seed() {
  console.log("Seeding database...");

  const existingClaims = await db.select().from(claims);
  if (existingClaims.length > 0) {
    console.log("Database already has data, skipping seed.");
    process.exit(0);
  }

  const [claim1] = await db.insert(claims).values({
    claimNumber: "CLM-2024-00847",
    insuredName: "Morrison Properties LLC",
    carrier: "Nationwide",
    dateOfLoss: "2024-01-15",
    status: "analyzed",
  }).returning();

  const [claim2] = await db.insert(claims).values({
    claimNumber: "CLM-2024-00912",
    insuredName: "Brightview Commercial Group",
    carrier: "State Farm",
    dateOfLoss: "2024-02-03",
    status: "pending",
  }).returning();

  const [claim3] = await db.insert(claims).values({
    claimNumber: "CLM-2024-01055",
    insuredName: "Cedar Ridge HOA",
    carrier: "Allstate",
    dateOfLoss: "2024-03-10",
    status: "approved",
  }).returning();

  await db.insert(documents).values([
    { claimId: claim1.id, type: "FNOL", fileUrl: null, extractedText: null, metadata: null },
    { claimId: claim1.id, type: "policy", fileUrl: null, extractedText: null, metadata: null },
    { claimId: claim1.id, type: "estimate", fileUrl: null, extractedText: null, metadata: null },
    { claimId: claim1.id, type: "photos", fileUrl: null, extractedText: null, metadata: { count: 24 } },
    { claimId: claim1.id, type: "desk_report", fileUrl: null, extractedText: "Inspection of the property revealed significant wind and hail damage consistent with the reported date of loss. The primary dwelling sustained damage to the architectural shingle roof, particularly on the west and south facing slopes.\n\nFull roof replacement is recommended. Overhead and profit (10/10) has been applied to the estimate due to the coordination required between the roofing contractor and the siding repair team. The north elevation siding also shows signs of minor wind damage, though further inspection may be necessary as access was limited during the initial visit.\n\nThe current estimate reflects RCV (Replacement Cost Value) for the roofing materials. Age of roof is estimated at 15 years based on homeowner records.", metadata: null },
  ]);

  await db.insert(documents).values([
    { claimId: claim2.id, type: "FNOL", fileUrl: null, extractedText: null, metadata: null },
    { claimId: claim2.id, type: "policy", fileUrl: null, extractedText: null, metadata: null },
  ]);

  await db.insert(documents).values([
    { claimId: claim3.id, type: "FNOL", fileUrl: null, extractedText: null, metadata: null },
    { claimId: claim3.id, type: "estimate", fileUrl: null, extractedText: null, metadata: null },
    { claimId: claim3.id, type: "photos", fileUrl: null, extractedText: null, metadata: { count: 16 } },
  ]);

  const [audit1] = await db.insert(audits).values({
    claimId: claim1.id,
    overallScore: "82",
    riskLevel: "LOW",
    approvalStatus: "APPROVE",
    executiveSummary: "This claim generally aligns with policy coverage and standard pricing guidelines. The overall scope of repairs for the wind/hail damage is appropriate, and the provided field photos (24) well-substantiate the roof replacements. However, there are minor discrepancies regarding the depreciation calculation for the roofing materials and documentation of Overhead & Profit (O&P) that should be reviewed prior to final approval.",
    rawResponse: null,
  }).returning();

  await db.insert(auditSections).values([
    { auditId: audit1.id, section: "Coverage Clarity", score: "88" },
    { auditId: audit1.id, section: "Scope Completeness", score: "76" },
    { auditId: audit1.id, section: "Estimate Accuracy", score: "85" },
    { auditId: audit1.id, section: "Doc Support", score: "90" },
    { auditId: audit1.id, section: "Financial Accuracy", score: "79" },
    { auditId: audit1.id, section: "Carrier Risk", score: "74" },
  ]);

  await db.insert(auditFindings).values([
    {
      auditId: audit1.id,
      type: "defect",
      severity: "medium",
      title: "Missing depreciation calculation for roofing materials",
      description: "The estimate includes full replacement cost for 15-year old architectural shingles without applying standard age-based depreciation (approx. 40%).",
      sourceDocumentId: null,
      metadata: { category: "Financial Accuracy" },
    },
    {
      auditId: audit1.id,
      type: "defect",
      severity: "high",
      title: "Overhead & Profit not properly documented",
      description: "O&P of 10/10 was applied to the estimate, but the complexity of repairs (only 2 trades involved) does not meet carrier guidelines for O&P inclusion without further justification.",
      sourceDocumentId: null,
      metadata: { category: "Carrier Risk" },
    },
    {
      auditId: audit1.id,
      type: "defect",
      severity: "medium",
      title: "Photo documentation gaps for north elevation",
      description: "The desk report references wind damage to the north elevation siding, but only 1 wide-angle photo was provided, making it difficult to verify the extent of the damage.",
      sourceDocumentId: null,
      metadata: { category: "Documentation Support" },
    },
    {
      auditId: audit1.id,
      type: "question",
      severity: "medium",
      title: "Was a ladder assist used for roof inspection?",
      description: "The field report does not clarify whether an aerial inspection was conducted or if only ground-level assessment was performed.",
      sourceDocumentId: null,
      metadata: { category: "Scope Completeness" },
    },
    {
      auditId: audit1.id,
      type: "question",
      severity: "low",
      title: "Confirm insured occupancy status",
      description: "The policy lists the insured as an LLC — clarify whether this is owner-occupied or a rental/commercial property for coverage verification.",
      sourceDocumentId: null,
      metadata: { category: "Coverage Clarity" },
    },
    {
      auditId: audit1.id,
      type: "risk",
      severity: "medium",
      title: "O&P may be rejected by carrier",
      description: "Based on carrier guidelines, O&P typically requires 3+ trades involved. Current scope shows only 2 trades (roofing + siding).",
      sourceDocumentId: null,
      metadata: { category: "Carrier Risk" },
    },
    {
      auditId: audit1.id,
      type: "risk",
      severity: "low",
      title: "Depreciation dispute potential",
      description: "Without clear depreciation schedule, the carrier may apply a higher depreciation rate than estimated.",
      sourceDocumentId: null,
      metadata: { category: "Financial Accuracy" },
    },
    {
      auditId: audit1.id,
      type: "risk",
      severity: "medium",
      title: "Limited north elevation documentation",
      description: "Insufficient photo evidence for north elevation repairs could result in scope reduction during carrier review.",
      sourceDocumentId: null,
      metadata: { category: "Documentation Support" },
    },
    {
      auditId: audit1.id,
      type: "risk",
      severity: "low",
      title: "Age of roof may affect ACV calculation",
      description: "15-year-old roof on a 25-year shingle may result in significant ACV holdback.",
      sourceDocumentId: null,
      metadata: { category: "Financial Accuracy" },
    },
    {
      auditId: audit1.id,
      type: "deferred",
      severity: "low",
      title: "Interior inspection for water intrusion",
      description: "Recommend follow-up interior inspection to check for water intrusion from roof damage. Not included in current scope.",
      sourceDocumentId: null,
      metadata: { category: "Scope Completeness" },
    },
  ]);

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
