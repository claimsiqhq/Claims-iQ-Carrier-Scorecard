export type ClaimStatus =
  | "processing"
  | "pending"
  | "analyzed"
  | "approved"
  | "denied"
  | "error"
  | string

export type SystemWorkflowStatus = "uploaded" | "processing" | "ready" | "error" | "archived"
export type AiWorkflowStatus =
  | "not_started"
  | "queued"
  | "running"
  | "succeeded"
  | "degraded"
  | "failed"
  | "cancelled"
export type HumanReviewStatus =
  | "unassigned"
  | "pending"
  | "in_review"
  | "approved"
  | "changes_requested"
export type FindingDisposition =
  | "open"
  | "accepted"
  | "dismissed"
  | "remediated"
  | "overridden"

export interface ClaimSummary {
  id: string
  claimNumber: string
  insuredName: string
  carrier?: string | null
  dateOfLoss?: string | null
  status: ClaimStatus
  createdAt?: string | null
  policyNumber?: string
  lossType?: string | null
  propertyAddress?: string
  adjuster?: string
  totalClaimAmount?: string
  deductible?: string
  summary?: string
  overallScore?: number | null
  riskLevel?: string | null
  approvalStatus?: string | null
  ownerUserId?: string | null
  assigneeUserId?: string | null
  systemStatus?: SystemWorkflowStatus
  aiStatus?: AiWorkflowStatus
  humanReviewStatus?: HumanReviewStatus
}

export interface ClaimsQueueData {
  items: ClaimSummary[]
  total: number
  page: number
  pageSize: number
  facets: {
    carriers: string[]
  }
}

export interface ClaimAssignee {
  userId: string
  name: string
  role: string
}

export interface DashboardData {
  stats: {
    totalClaims: number
    analyzedCount: number
    pendingCount: number
    avgScore: number | null
    backlogCount: number
    dollarsAtRisk: string
    averageAgeDays: number
    completedLast7Days: number
    openFindingCount: number
  }
  riskDistribution: Record<string, number>
  approvalDistribution: Record<string, number>
  carriers: Array<{
    name: string
    count: number
    avgScore: number | null
  }>
  findingSeverity: Record<string, number>
  recentClaims: ClaimSummary[]
  recentActivity: Array<{
    id: string
    type: string
    claimId: string
    claimNumber: string
    metadata: Record<string, unknown>
    createdAt: string
  }>
}

export interface InsightsData {
  summary: {
    reviewAgreementRate: number | null
    overrideRate: number | null
    processingSuccessRate: number | null
    citationMappingRate: number | null
    averageLatencySeconds: number | null
    runCount: number
    degradedCount: number
    failedCount: number
  }
  carrierPerformance: Array<{
    name: string
    claimCount: number
    averageScore: number | null
    dollarsAtRisk: string
  }>
  reviewerPerformance: Array<{
    userId: string | null
    label: string
    assignedCount: number
    approvedCount: number
    changesRequestedCount: number
    averageScore: number | null
  }>
  scoreDistribution: Array<{ bucket: string; count: number }>
  rootCauses: Array<{ label: string; severity: string; count: number }>
  workflowDistribution: Array<{
    status: HumanReviewStatus
    count: number
    averageAgeDays: number
  }>
}

export interface ClaimDocument {
  id: string
  claimId: string
  type: string
  fileUrl?: string
  extractedText?: string
  metadata?: Record<string, unknown>
  createdAt?: string
}

export interface ScorecardQuestion {
  id: string
  answer: string
  points_awarded: number
  points_possible: number
  root_issue?: string
  issue?: string
  impact?: string
  fix?: string
  evidence_locations?: string[]
  confidence?: number
}

export interface ScorecardCategory {
  category_key: string
  category_name: string
  points_awarded: number
  points_possible: number
  questions: ScorecardQuestion[]
}

export interface AuditIssue {
  source_scorecard: string
  category_key: string
  question_key: string
  root_issue?: string
  severity: string
  issue: string
  impact: string
  fix: string
  evidence_locations?: string[]
}

export interface RootIssueGroup {
  root_issue: string
  affects: string[]
  issue?: string
  fix: string
  impact: string
  evidence_locations?: string[]
}

export interface ValidationCheck {
  key: string
  severity: string
  message: string
}

export interface AuditFinding {
  id: string
  auditId: string
  type: string
  severity: string
  title: string
  description: string
  category?: string
  answer?: string
  issue?: string
  impact?: string
  fix?: string
  evidence_locations?: string[]
  confidence?: number
  scorecard?: string
  category_key?: string
  points_awarded?: number
  points_possible?: number
  sourceDocumentId?: string | null
  disposition?: FindingDisposition
  overrideReason?: string | null
  reviewNotes?: string | null
  reviewedByUserId?: string | null
  reviewedAt?: string | null
}

export interface VisionToolReading {
  page_number: number
  tool_type: string
  tool_model?: string
  reading_value: string
  reading_unit: string
  material_or_location: string
  confidence?: number
}

export interface VisionDamageVerification {
  page_number: number
  caption_claim: string
  damage_visible: boolean
  damage_type?: string
  discrepancy?: string
  confidence?: number
}

export interface VisionAnalysis {
  analyzed_pages?: number[]
  total_photo_pages?: number
  tool_readings?: VisionToolReading[]
  damage_verifications?: VisionDamageVerification[]
  photo_sequence_valid?: boolean
  sequence_issues?: string[]
  diagnostics_summary?: {
    moisture_readings_found?: number
    thermal_readings_found?: number
    laser_readings_found?: number
    captions_verified?: number
    captions_with_discrepancy?: number
  }
}

export interface AuditResult {
  id: string
  claimId: string
  overallScore: number
  daScore?: number
  daPointsAwarded?: number
  daPointsPossible?: number
  denialLetterApplicable?: boolean
  faScore?: number
  faPointsAwarded?: number
  faPointsPossible?: number
  readiness?: string
  technicalRisk?: string
  failedCount?: number
  partialCount?: number
  passedCount?: number
  warningCount?: number
  actionRequiredCount?: number
  technicalScore: number
  technicalMax?: number
  presentationScore: number
  presentationMax?: number
  totalMax?: number
  riskLevel: string
  approvalStatus: string
  executiveSummary: string
  daCategories?: ScorecardCategory[]
  faCategories?: ScorecardCategory[]
  rootIssueGroups?: RootIssueGroup[]
  issues?: AuditIssue[]
  validationChecks?: ValidationCheck[]
  findings: AuditFinding[]
  visionAnalysis?: VisionAnalysis | null
  versionNumber?: number
}

export interface ClaimDetail {
  claim: ClaimSummary
  documents: ClaimDocument[]
  audit?: AuditResult
}

export interface ProcessingJob {
  id: string
  claimId?: string | null
  documentId?: string | null
  type?: string
  status: "queued" | "running" | "succeeded" | "degraded" | "failed" | "cancelled"
  stage:
    | "uploaded"
    | "scanning"
    | "extracting"
    | "auditing"
    | "degraded"
    | "completed"
    | "failed"
    | "cancelled"
  progress?: number
  attemptCount?: number
  maxAttempts?: number
  error?: { code?: string | null; message?: string | null } | null
}

export interface ProcessingStatus {
  claimId: string
  systemStatus: SystemWorkflowStatus
  aiStatus: AiWorkflowStatus
  humanReviewStatus: HumanReviewStatus
  job: ProcessingJob | null
}

export interface IngestResponse {
  claim?: {
    id: string
    claimNumber: string
    status: string
  }
  document?: {
    id: string
    fileName: string
  }
  job: ProcessingJob
  duplicate?: boolean
}

export interface ClaimActivity {
  id: string
  type: string
  actorUserId?: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface SavedView {
  id: string
  name: string
  resourceType: string
  filters: Record<string, unknown>
  sort: Record<string, unknown>
  columns: string[] | null
  isDefault: boolean
  createdAt?: string
  updatedAt?: string
}

export interface CarrierOption {
  key: string
  displayName: string
}

export interface CarrierQuestion {
  id: string
  text: string
  weight: number
  weightIfNoDenial?: number
  section: string
  scorecard: "DA" | "FA"
  categoryKey: string
  categoryName: string
  applicability?: string
  severity?: "critical" | "high" | "medium" | "low" | "info"
  sourceReference?: string
}

export interface CarrierCategory {
  id: string
  label: string
  max_score: number
}

export interface CarrierRuleset {
  version: string
  da_questions: CarrierQuestion[]
  fa_questions: CarrierQuestion[]
  scorecard_categories: CarrierCategory[]
  system_prompt_override?: string
  carrier_scorecard_prompt_override?: string
}

export interface CarrierProfile {
  id?: string
  carrierKey: string
  displayName: string
  logoUrl: string | null
  active: boolean
  ruleset: CarrierRuleset
  sourceReferences?: CarrierSourceReference[]
  changeSummary?: string | null
  hasDraft?: boolean
  latestVersion?: CarrierRulesetVersion | null
  publishedVersion?: CarrierRulesetVersion | null
  createdAt?: string
  updatedAt?: string
}

export interface CarrierSourceReference {
  label: string
  url?: string
  reference?: string
}

export interface CarrierRulesetVersion {
  id: string
  carrierKey: string
  versionNumber: number
  versionLabel: string
  status: "draft" | "published" | "archived"
  displayName: string
  logoUrl: string | null
  ruleset: CarrierRuleset
  validation: { errors: string[]; warnings: string[] }
  changeSummary: string | null
  sourceReferences: CarrierSourceReference[]
  createdByUserId: string | null
  approvedByUserId: string | null
  supersedesVersionId: string | null
  createdAt: string
  publishedAt: string | null
}

export interface CarrierPreflightResult {
  mode: "deterministic_preflight"
  claim: {
    id: string
    claimNumber: string
    carrier: string | null
    currentScore: number | null
    currentRisk: string | null
  }
  version: {
    id: string
    versionNumber: number
    versionLabel: string
    status: CarrierRulesetVersion["status"]
  }
  compatible: boolean
  validation: { errors: string[]; warnings: string[] }
  coverage: {
    deskAdjusterQuestions: number
    fieldAdjusterQuestions: number
    categories: number
    configuredPoints: number
  }
  note: string
}

export interface PromptSettings {
  system_prompt: string
  user_prompt_template: string
  model_identifier?: string
  updated_at?: string | null
}

export interface SettingsOverview {
  members: Array<{
    membershipId: string
    userId: string
    role: string
    firstName: string | null
    lastName: string | null
    email: string
    joinedAt: string
  }>
  invitations: Array<{
    id: string
    email: string
    role: string
    status: "pending" | "expired"
    expiresAt: string
    lastSentAt: string | null
    sendCount: number
    createdAt: string
  }>
  integrations: {
    ai: { configured: boolean; modelIdentifier: string }
    storage: { configured: boolean }
    email: { configured: boolean }
  }
  security: {
    sessionTtlDays: number
    cookieHttpOnly: boolean
    sameSite: string
    mfaReady: boolean
    ssoReady: boolean
  }
  organizationSettings: {
    inAppNotificationsEnabled: boolean
    emailNotificationsEnabled: boolean
    retentionDays: number | null
    purgeMode: "manual" | "scheduled"
    updatedAt: string | null
  }
  auditHistory: Array<{
    id: string
    eventType: string
    targetType: string
    targetId: string | null
    metadata: Record<string, unknown>
    actorName: string
    createdAt: string
  }>
}

export type OrganizationSettingsInput = Omit<
  SettingsOverview["organizationSettings"],
  "updatedAt"
>

export interface AuthUser {
  id: string
  email: string | null
  firstName: string | null
  lastName: string | null
  profileImageUrl: string | null
  role: string
}

export interface AuthOrganization {
  id: string
  name: string
  role: string
  permissions: string[]
}

export interface AuthSession {
  user: AuthUser | null
  organization: AuthOrganization | null
}

export interface InvitationPreview {
  email: string
  role: string
  organizationName: string
  expiresAt: string
  accountExists: boolean
}
