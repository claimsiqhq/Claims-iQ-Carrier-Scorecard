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

export interface DashboardData {
  stats: {
    totalClaims: number
    analyzedCount: number
    pendingCount: number
    avgScore: number | null
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
  createdAt?: string
  updatedAt?: string
}

export interface PromptSettings {
  system_prompt: string
  user_prompt_template: string
}

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
