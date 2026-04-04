# Claims iQ Audit

## Overview
Claims iQ Audit is a full-stack SaaS application designed for insurance claim auditing. It provides a platform for ingesting claim documents, leveraging AI for comprehensive audit analysis against an Andover-style carrier scorecard, and generating detailed audit reports. The application aims to streamline the auditing process, improve accuracy, and facilitate communication by enabling email-based sharing of audit results.

**Key Capabilities:**
- Document ingestion and text extraction from PDFs.
- AI-powered audit analysis to generate technical and presentation scores.
- Detailed audit findings, risk levels, and executive summaries.
- Secure storage of claim documents.
- Email generation and sending of audit reports.
- User authentication and granular access control.

## User Preferences
I prefer clear, concise summaries and explanations. When making changes, prioritize functional correctness and security. For front-end development, adhere to the established brand system and UI/UX patterns. For back-end and database changes, focus on efficiency, scalability, and data integrity, especially concerning PII handling. Please ask for confirmation before making any significant architectural changes or altering core business logic related to the audit process.

## System Architecture

The project is a pnpm workspace monorepo using Node.js v24 and TypeScript v5.9.

### UI/UX Decisions
- **Frontend Framework**: React + Vite with Tailwind CSS v4.
- **Branding**: Uses a defined brand system with specific color palettes (deepPurple, gold, etc.), typography (Work Sans, Source Sans 3, Space Mono), and icon set (iconoir-react). Brand constants are centralized.
- **Design Patterns**: Employs a 3-column layout for the claims detail view, separating claim information, audit scorecard, and document viewer. Email previews are rendered within a sandboxed iframe.

### Technical Implementations
- **API**: Express 5 serves as the API framework.
- **Database**: Supabase PostgreSQL with Drizzle ORM.
- **Authentication**: Email/password login with bcrypt password hashing, cookie-based sessions stored in PostgreSQL.
- **File Storage**: Supabase Storage for claim document uploads, with a dedicated `claim-documents` bucket.
- **Email Service**: SendGrid for sending audit emails, with email content rendered as inline HTML.
- **AI Integration**: Leverages Replit AI Integrations for OpenAI (gpt-4o) for audit analysis. Prompts are in `artifacts/api-server/src/services/prompts.ts`.
- **Logging**: Pino for structured JSON logging with PII redaction and audit logging for sensitive actions.
- **Security**: Implements Helmet for security headers, CORS, rate limiting, body size limits, error sanitization, and CSRF protection.
- **Monorepo Structure**: Organized into `artifacts` (API server, frontend, mockup sandbox) and `lib` (shared utilities like API spec, database schema, auth, object storage).
- **TypeScript**: Extensively used across the monorepo with composite projects for improved type-checking and code organization.

### Feature Specifications
- **Claims Management**: CRUD operations for claims, including associated documents and audit data.
- **Document Processing**: Upload, text extraction (from PDFs up to 100MB), and storage of claim documents.
- **Audit Generation**: Dual DA/FA carrier-grade scorecard system with root-issue grouping and anti-double-penalization. Supports per-carrier rulesets with dynamic point weighting via `weightIfNoDenial` (e.g., Andover DA redistributes points when no denial exists). Active carriers: Allstate, Andover, Wawanesa. Rulesets seeded via `scripts/src/seed*.ts`. LLM answers carrier-specific questions split across DA and FA scorecards. Each question returns `root_issue` (snake_case grouping key) so related findings share the same root cause. Scoring engine: (1) policy provision guard — FAIL→PARTIAL unless explicitly missing; (2) root-issue dedup — secondary questions sharing a root_issue are damped to PARTIAL; (3) materiality — non-material root issues have primary softened to PARTIAL; (4) readiness considers critical validation + material failures. Validation engine uses section-aware payment mismatch detection, deductible inconsistency (critical), stack order validation (checks DA→SOL→Payment→Estimate→Photos→Sketch→Prior Loss order), and prior loss review validation (critical — checks ISO ClaimSearch report presence AND DA mention of prior losses). Material root issues: `payment_mismatch`, `missing_scope`, `coverage_error`, `deductible_mismatch`, `denial_language_error`, `missing_prior_loss_review`. Output: `root_issue_groups[]`, `issues[]`, `validation_checks[]`. Services: `questionBank.ts`, `scoringEngine.ts`, `rootIssueEngine.ts`, `runQuestionAudit.ts`, `validationEngine.ts`, `prompts.ts`, `audit.ts`.
- **Vision AI Photo Analysis**: Multimodal gpt-4o analysis of photo pages in claim PDFs. The audit route downloads the PDF from Supabase Storage, identifies photo pages via text heuristics (moisture_meter, tramex, flir, IMG_ patterns), renders them as images, and sends to Vision AI for extraction. Extracts: `ToolReading` (moisture meters, thermal imagers, laser/tape measures with values and units), `PhotoLabel` (label paths, captions, section types), `DamageVerification` (caption-to-damage alignment with confidence). Also validates photo sequencing (exterior-before-interior ordering). Results stored in `audits.vision_analysis` (jsonb) and as `audit_findings` (types: `vision_tool_reading`, `vision_damage_verification`, `vision_sequence`). Validation checks: `unverified_diagnostic_proof` (critical — no meter readings when water mitigation claimed), `caption_damage_mismatch` (warning), `photo_sequence_error` (warning). Frontend: VisionAnalysisPanel in claim-detail displays diagnostics summary stats, tool readings, damage verifications, and sequence issues. Service: `visionAnalysis.ts`.
- **Batch Upload Queue**: Dashboard supports multi-file upload with parallel processing (3 files at a time). Drop or select multiple PDFs, configure an optional email recipient, and start the pipeline — files are processed through ingest → audit → email in batches of 3 concurrently. Per-file progress tracking with statuses (queued/extracting/parsing/auditing/emailing/complete/error). Claims are persisted to the database as they complete, so navigating away preserves the data.
- **Async Ingest**: The `/ingest` endpoint returns 202 immediately after uploading the file, then processes PDF extraction and claim parsing in the background. The frontend polls `GET /claims/:id/processing-status` every 3 seconds until extraction is complete (status "ready"), then proceeds to audit. This prevents timeout errors on large PDFs (e.g. 30+ pages) that previously caused "Load failed" on mobile browsers. Claims use status "processing" during extraction, then transition to "pending" when ready or "error" if extraction fails.
- **Claim Retry**: Claims stuck in "processing" or "error" status can be retried via `POST /api/claims/:id/retry`. The endpoint verifies the PDF still exists in Supabase Storage (via `fileExists()`) before re-downloading and re-running the full extract→parse pipeline. Processing claims must be at least 15 minutes old to prevent duplicate concurrent processing. The claims list UI shows a "Retry" button on eligible cards with inline progress/error feedback.
- **Email Communication**: Preview and send comprehensive audit reports via email.
- **Settings Management**: UI for editing AI prompt settings, with persistence to the database.
- **Data Retention**: GDPR-compliant data deletion with cascading deletes for claims and associated PII.

### System Design Choices
- **Parallel Vision Extraction**: PDF pages are processed through Vision AI in batches of 5 concurrently (previously sequential), reducing a 129-page PDF from ~20min to ~4min. Configured via `CONCURRENCY` constant in `finalReportIngestion.ts`.
- **Auto-Refresh for Processing Claims**: The claims list auto-refreshes every 10 seconds when any claims are in "processing" status, so completed claims appear without manual refresh.
- **Transactional Integrity**: Audit process and claim deletions utilize database transactions for atomicity.
- **API Specification**: OpenAPI specification is used for API definition, with Orval for client and Zod schema generation.
- **Error Handling**: Generic error messages for 500 errors to prevent information leakage.
- **Graceful Shutdown**: Implemented for robust application termination.
- **Performance**: QueryClient defaults, cache invalidation, and database connection pooling are configured for optimal performance.

## External Dependencies

- **Database**: Supabase PostgreSQL
- **Object Storage**: Supabase Storage (`claim-documents` bucket)
- **Email Service**: SendGrid (@sendgrid/mail)
- **AI Integration**: Replit AI Integrations (for OpenAI access, specifically gpt-5)
- **Authentication**: Email/password (bcryptjs for hashing, cookie sessions)
- **PDF Processing**: `pdf-parse` v1.1.1
- **ORM**: Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API Codegen**: Orval
- **Frontend Components**: `iconoir-react` for icons
- **Logging**: `pino`