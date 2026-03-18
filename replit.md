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
- **Authentication**: Replit Auth (OIDC + PKCE) for secure user authentication, managing sessions and user data in PostgreSQL.
- **File Storage**: Supabase Storage for claim document uploads, with a dedicated `claim-documents` bucket.
- **Email Service**: SendGrid for sending audit emails, with email content rendered as inline HTML.
- **AI Integration**: Leverages Replit AI Integrations for OpenAI (gpt-5) for audit analysis, with configurable prompts stored in the database.
- **Logging**: Pino for structured JSON logging with PII redaction and audit logging for sensitive actions.
- **Security**: Implements Helmet for security headers, CORS, rate limiting, body size limits, error sanitization, and CSRF protection.
- **Monorepo Structure**: Organized into `artifacts` (API server, frontend, mockup sandbox) and `lib` (shared utilities like API spec, database schema, auth, object storage).
- **TypeScript**: Extensively used across the monorepo with composite projects for improved type-checking and code organization.

### Feature Specifications
- **Claims Management**: CRUD operations for claims, including associated documents and audit data.
- **Document Processing**: Upload, text extraction (from PDFs up to 100MB), and storage of claim documents.
- **Audit Generation**: AI-driven generation of audit reports based on configurable prompts, providing technical and presentation scores, findings, and an executive summary. Audit results are stored transactionally.
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
- **Authentication**: Replit Auth (OpenID Connect with PKCE via `openid-client`)
- **PDF Processing**: `pdf-parse` v1.1.1
- **ORM**: Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API Codegen**: Orval
- **Frontend Components**: `iconoir-react` for icons
- **Logging**: `pino`