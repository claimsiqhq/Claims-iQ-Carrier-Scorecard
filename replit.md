# Workspace

## Overview

Claims iQ Audit — a full-stack insurance claim auditing SaaS application. pnpm workspace monorepo using TypeScript.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: Supabase PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite + Tailwind CSS v4
- **Icons**: iconoir-react
- **Build**: esbuild (CJS bundle for API server)
- **File storage**: Supabase Storage (bucket: `claim-documents`)
- **Email**: SendGrid (@sendgrid/mail) — from john@claimsiq.ai
- **PDF extraction**: pdf-parse v1.1.1 (loaded via `createRequire(import.meta.url)`)
- **Authentication**: Replit Auth (OIDC + PKCE) via `openid-client`
- **Logging**: pino structured JSON logging with PII redaction

## Brand System

- **Colors**: deepPurple `#342A4F`, purple `#7763B7`, purpleSecondary `#9D8BBF`, purpleLight `#CDBFF7`, gold `#C6A54E`, goldLight `#EAD4A2`, lightPurpleGrey `#F0E6FA`, greyLavender `#E3DFE8`, offWhite `#F0EDF4`
- **Typography**: Work Sans (headings/labels), Source Sans 3 (body), Space Mono (data/numbers)
- **Icons**: iconoir-react
- **Brand constants**: `artifacts/claims-iq/src/lib/brand.ts`

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (port 8080)
│   ├── claims-iq/          # React + Vite frontend (port 20727, preview path /)
│   └── mockup-sandbox/     # Component preview server
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   ├── replit-auth-web/    # Frontend auth hook (useAuth)
│   └── object-storage-web/ # Uppy v5 upload components (useUpload hook, ObjectUploader)
├── scripts/                # Utility scripts (seed, etc.)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Authentication

Replit Auth (OpenID Connect with PKCE) protects all API routes except `/healthz` and `/metrics`.

- **Server middleware**: `artifacts/api-server/src/middlewares/authMiddleware.ts` — loads session from DB, attaches `req.user`, provides `req.isAuthenticated()`
- **Auth routes**: `artifacts/api-server/src/routes/auth.ts` — login, callback, logout, mobile token exchange
- **Auth lib**: `artifacts/api-server/src/lib/auth.ts` — OIDC config, session CRUD, cookie management
- **requireAuth guard**: `artifacts/api-server/src/middlewares/requireAuth.ts` — 401 if not authenticated
- **Frontend hook**: `lib/replit-auth-web/src/use-auth.ts` — `useAuth()` returns `{ user, isLoading, isAuthenticated, login, logout }`
- **Session storage**: PostgreSQL `sessions` table (sid, sess jsonb, expire timestamp)
- **User storage**: PostgreSQL `users` table (id, email, first_name, last_name, profile_image_url)
- **Cookie config**: `sid` cookie, httpOnly, secure, sameSite=lax, 7-day TTL
- **CSRF protection**: Origin/Referer header validation on mutating requests, SameSite=lax cookies

## Database

Uses Supabase PostgreSQL via `SUPABASE_DATABASE_URL` secret. SSL configured with `rejectUnauthorized: false` for Supabase pooler connections (documented constraint — Supabase transaction mode pooler uses dynamic IPs, so cert pinning is not possible).

### Tables (created via Drizzle push):
- `claims` — id (uuid), claim_number (NOT NULL), insured_name (NOT NULL), carrier, date_of_loss, status (NOT NULL), policy_number, loss_type, property_address, adjuster, total_claim_amount, deductible, summary
- `documents` — id (uuid), claim_id (FK CASCADE), type, file_url, extracted_text, metadata (jsonb)
- `audits` — id (uuid), claim_id (FK CASCADE, UNIQUE), overall_score, technical_score, presentation_score, risk_level, approval_status, executive_summary, raw_response (jsonb)
- `audit_sections` — id (uuid), audit_id (FK CASCADE), section, score
- `audit_findings` — id (uuid), audit_id (FK CASCADE), type, severity, title, description, source_document_id (FK), metadata (jsonb)
- `audit_structured` — id (uuid), audit_id (FK CASCADE), deferred_items, invoice_adjustments, scope_deviations, unknowns, carrier_questions (all jsonb)
- `audit_versions` — id (uuid), claim_id (FK CASCADE), audit_id (FK CASCADE), version_number
- `prompt_settings` — id (uuid), key (text, unique), value (text), updated_at (timestamp)
- `sessions` — sid (varchar PK), sess (jsonb), expire (timestamp) — Replit Auth sessions
- `users` — id (varchar PK), email (unique), first_name, last_name, profile_image_url, created_at, updated_at

### PII Classification
Fields containing personally identifiable information are annotated in `lib/db/src/schema/claims.ts`:
- `claims.insured_name`, `claims.property_address` — subject to GDPR right-to-erasure
- `claims.claim_number`, `claims.policy_number`, `claims.adjuster` — PII identifiers
- `claims.total_claim_amount`, `claims.deductible` — financial PII
- `claims.summary`, `documents.extracted_text`, `documents.metadata` — may contain PII from claim documents

### Data Retention / GDPR
- DELETE `/api/claims/:id` cascades to all child records (documents, audits, sections, findings, structured, versions)
- This serves as the GDPR right-to-erasure endpoint — deleting a claim removes all associated PII
- Supabase Storage files are cleaned up asynchronously after cascade delete

### Drizzle Schema Files
- `lib/db/src/schema/claims.ts` — claims, documents, audits, audit_sections, audit_findings, audit_structured, audit_versions
- `lib/db/src/schema/prompt-settings.ts` — prompt_settings
- `lib/db/src/schema/auth.ts` — sessions, users (Replit Auth)

## File Storage

Supabase Storage for claim document uploads.
- **Bucket**: `claim-documents` (auto-created on server start)
- **Server lib**: `artifacts/api-server/src/lib/supabaseStorage.ts` — Supabase Storage client, upload/download/signedUrl/delete
- **Storage routes**: `artifacts/api-server/src/routes/storage.ts` — file upload (multipart, 50MB limit), download, signed URL generation
- **Ingest flow**: Frontend sends PDF via FormData to `/api/ingest` → server uploads to Supabase Storage → extracts text → parses with AI → creates claim + document records
- **Upload size validation**: 50MB limit enforced by multer + explicit size check (D6.9)
- **PDF size limit**: 100MB for text extraction (D8.5)
- **Env vars**: `SUPABASE_DATABASE_URL` (project ref derived from it), `SUPABASE_SERVICE_ROLE` (for storage admin access)

## Email

SendGrid integration for sending carrier audit emails.
- **Service**: `artifacts/api-server/src/services/sendgrid.ts` — wraps @sendgrid/mail
- **From address**: john@claimsiq.ai (configurable via `SENDGRID_FROM_EMAIL` env var)
- **Email rendering**: `artifacts/api-server/src/services/email.ts` — inline HTML with full carrier scorecard
- **Email preview**: Uses sandboxed iframe (`srcDoc` + `sandbox="allow-same-origin"`) instead of `document.write`
- **Routes**: GET `/api/claims/:id/email` (preview HTML), POST `/api/claims/:id/email/send` (send via SendGrid)
- **Env vars**: `SENDGRID_API_KEY` (user-provided secret)

## AI Integration

Uses Replit AI Integrations for OpenAI access (no API key needed, billed to Replit credits).
- **OpenAI client**: `@workspace/integrations-openai-ai-server` (lib/integrations-openai-ai-server/)
- **Model**: gpt-5 for audit analysis
- **Default prompt constants**: `artifacts/api-server/src/services/prompts.ts` — `SYSTEM_PROMPT` and `USER_PROMPT_TEMPLATE`
- **Prompt storage**: `prompt_settings` table in Supabase — editable via Settings page, falls back to defaults
- **Audit service**: `artifacts/api-server/src/services/audit.ts` — `runFinalAudit()` reads prompts from DB (with fallback)
- **Audit route**: `artifacts/api-server/src/routes/audit.ts` — POST endpoint with transactional DB persistence
- **Prompt structure**: Andover-style carrier scorecard — evaluates technical correctness + carrier presentation quality
- **Technical Score (80)**: Coverage & Liability Clarity (15), Scope Completeness (15), Estimate Technical Accuracy (15), Documentation & Evidence Support (10), Financial Accuracy & Reconciliation (10), Carrier Risk & Completeness (15)
- **Presentation Score (20)**: File Stack Order (3), Payment Recommendations Match (5), Estimate Operational Order (3), Photographs Clear and In Order (3), DA Report Not Cumbersome (2), FA Report Detailed Enough (2), Unique Policy Provisions Addressed (2)
- **Response format**: Structured JSON with overall/technical/presentation scores, 13 section scores, findings (including presentation_issues), risk level, approval status, executive summary
- **Env vars**: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` (auto-provisioned)
- **OpenAI DPA note**: Claims data sent to OpenAI for audit analysis is covered by OpenAI's Data Processing Agreement. OpenAI API calls with data retention disabled (no training on user data). Replit AI Integrations proxy handles billing.
- **Duplicate OpenAI libs**: Both `@workspace/integrations-openai-ai-server` (Replit proxy) and raw `openai` package exist. The integration wrapper is used for all production calls; the raw package is a transitive dependency. Both use the same OpenAI SDK under the hood.

## Security & Reliability

- **Authentication**: Replit Auth (OIDC + PKCE) on all routes except `/healthz` and `/metrics`
- **Helmet**: Security headers (CSP disabled for inline styles, COEP disabled for iframe compat)
- **CORS**: credentials=true, origin=true (cookie-based auth requires credentials)
- **Rate limiting**: Global (200 req/15min), audit endpoint (10 req/15min), email send (10 req/hr)
- **Body size limits**: 50MB for JSON and URL-encoded
- **Error sanitization**: All 500 errors return generic messages, no stack traces or internals exposed. Standard error shape: `{ error: string }`
- **Structured logging**: pino JSON logger with PII field redaction (authorization, cookie, email, insuredName, propertyAddress, policyNumber)
- **Audit logging**: Sensitive actions (audit runs, email sends, claim deletes, prompt changes) logged with user ID, action, status code, timestamp
- **Request metrics**: In-memory route-level metrics (count, avgMs, errors) exposed via `GET /api/metrics`
- **OpenAI timeouts**: 60s for ingest parsing, 120s for audit analysis (via AbortSignal.timeout)
- **Graceful shutdown**: SIGTERM/SIGINT handlers close HTTP server and DB pool (30s forced kill timeout)
- **Env validation**: Required env vars checked at startup (SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE)
- **DB pool config**: max=20, connectionTimeout=10s, idleTimeout=30s
- **Error Boundary**: Global React error boundary wraps the entire app
- **QueryClient defaults**: staleTime=30s, retry=2, refetchOnWindowFocus=false
- **Cache invalidation**: Mutations (audit, delete) invalidate relevant query caches
- **Email validation**: Recipient email format validated server-side before sending
- **CSRF protection**: Origin/Referer header validation on mutating requests, SameSite=lax session cookies
- **ARIA labels**: Modals, buttons, and interactive elements have aria-label attributes

## Database Constraints

- `claims.claim_number`, `claims.insured_name`, `claims.status` — NOT NULL
- `audits.claim_id` — UNIQUE constraint (one audit per claim, re-auditing replaces)
- `audit_sections.audit_id` — indexed for fast lookups
- All child tables use ON DELETE CASCADE for FKs (documents, audits, audit_sections, audit_findings, audit_structured, audit_versions)
- Audit route uses DB transactions (BEGIN/COMMIT/ROLLBACK) for atomicity
- Batch inserts for audit sections and findings (single INSERT per type)
- Raw pool client usage in claims delete and audit routes is the accepted pattern for transactions (Drizzle's `db.transaction()` doesn't support all nested query patterns needed)

## API Routes

All routes prefixed with `/api`. All routes except `/healthz` and `/metrics` require authentication.

- `GET /api/healthz` — Deep health check (verifies DB connectivity), returns `{ status, checks }`
- `GET /api/metrics` — Request metrics (count, avgMs, errors per route)
- `GET /api/auth/user` — Get current authenticated user
- `GET /api/login` — Start OIDC login flow (302 redirect)
- `GET /api/callback` — Complete OIDC login (302 redirect)
- `GET /api/logout` — Clear session and OIDC logout (302 redirect)
- `GET /api/claims` — List claims with pagination (`?limit=100&offset=0`)
- `GET /api/claims/:id` — Get claim detail with documents, audit, sections, findings
- `POST /api/claims` — Create a new claim
- `DELETE /api/claims/:id` — Delete claim + all related data (transactional, cascading)
- `POST /api/claims/:id/audit` — Run Andover-style carrier audit (calls OpenAI, saves results to DB)
- `POST /api/claims/:id/documents` — Register an uploaded document to a claim
- `DELETE /api/claims/:id/documents/:docId` — Delete a document
- `POST /api/claims/:id/documents/:docId/extract` — Extract text from uploaded document (PDF/text)
- `GET /api/claims/:id/email` — Generate carrier audit email HTML (preview)
- `POST /api/claims/:id/email/send` — Send audit email via SendGrid
- `POST /api/storage/upload` — Upload file to Supabase Storage (multipart, 50MB limit)
- `GET /api/storage/download/*` — Download file from Supabase Storage
- `GET /api/storage/signed-url/*` — Get signed URL for file access
- `GET /api/settings/prompts` — Get current prompt settings (DB values or defaults)
- `PUT /api/settings/prompts` — Save prompt settings (validates {{REPORT}} placeholder, atomic upsert)
- `POST /api/settings/prompts/reset` — Reset prompts to hardcoded defaults
- `POST /api/ingest` — Upload PDF, extract text, parse with AI, create claim + document

## Frontend Pages

- `/` — Dashboard with claim stats and quick links
- `/claims` — Claims list with status badges
- `/claims/:id` — 3-column carrier audit dashboard (claim details | Andover-style technical + presentation scorecard + findings | document viewer) with "Preview Email" (iframe-based) and "Send to Carrier" actions
- `/upload` — Working file upload page: select claim, choose doc type, drag-and-drop or browse files, auto-extracts text from PDFs
- `/audit-results` — Lists audited and pending claims
- `/settings` — AI prompt editor (system prompt + user prompt template, saved to Supabase)

## Secrets

- `SUPABASE_DATABASE_URL` — PostgreSQL connection string for Supabase
- `SUPABASE_ANON_KEY` — Supabase anon key
- `SUPABASE_SERVICE_ROLE` — Supabase service role key
- `SESSION_SECRET` — Session secret
- `SENDGRID_API_KEY` — SendGrid API key for email sending

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite

## Key Commands

- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API client + Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/scripts run seed` — Seed database with sample claims data
- `pnpm --filter @workspace/claims-iq run dev` — Start frontend dev server
- `pnpm --filter @workspace/api-server run dev` — Start API server
- `pnpm run audit` — Run production dependency audit
- `pnpm run validate` — Run typecheck + audit

## Deployment Notes

- **Rollback strategy**: Replit checkpoints provide automatic rollback for code, chat session, and database. If a deployment fails, use the checkpoint system to revert to a known-good state.
- **Mockup sandbox**: The `artifacts/mockup-sandbox` package is for development-only component previews. It should not be included in production builds or deployments.
- **pdf-parse**: Uses v1.1.1 (latest stable). Known to have no CVEs. Loaded via `createRequire(import.meta.url)` for ESM compatibility.
