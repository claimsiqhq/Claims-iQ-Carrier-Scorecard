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
- **Audit Generation**: Dual DA/FA carrier-grade scorecard system. LLM answers 11 canonical questions: 7 for Desk Adjuster (DA) scorecard (file stack order, payment match, deductible, DA report quality, policy provisions, prior losses, denial letters) and 4 for Field Adjuster (FA) scorecard (estimate order, photos, FA report quality, FA policy provisions). Each scorecard totals 100 points with weighted categories. DA denial-letter category is conditional — if N/A, weights redistribute. Combined score is 50/50 DA/FA blend. Readiness: READY (90+), REVIEW (75-89), NOT READY (<75). Technical risk: LOW/MEDIUM/HIGH. Each question returns issue/impact/fix/evidence_locations/confidence. Validation engine provides supplemental regex-based warnings. Services: `questionBank.ts` (DA_QUESTIONS + FA_QUESTIONS), `scoringEngine.ts` (dual scoring), `runQuestionAudit.ts` (LLM runner), `validationEngine.ts` (pre-checks), `prompts.ts` (DA/FA prompt), `audit.ts` (AuditResponse with da/fa scorecards + issues + validation_checks).
- **Email Communication**: Preview and send comprehensive audit reports via email.
- **Settings Management**: UI for editing AI prompt settings, with persistence to the database.
- **Data Retention**: GDPR-compliant data deletion with cascading deletes for claims and associated PII.

### System Design Choices
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