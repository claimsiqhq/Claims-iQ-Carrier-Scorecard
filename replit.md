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
- **PDF extraction**: pdf-parse

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
│   └── object-storage-web/ # Uppy v5 upload components (useUpload hook, ObjectUploader)
├── scripts/                # Utility scripts (seed, etc.)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database

Uses Supabase PostgreSQL via `SUPABASE_DATABASE_URL` secret. SSL configured with `rejectUnauthorized: false` for Supabase pooler connections.

### Tables (created via Supabase SQL, Drizzle maps to them):
- `claims` — id (uuid), claim_number, insured_name, carrier, date_of_loss, status, policy_number, loss_type, property_address, adjuster, total_claim_amount, deductible, summary
- `documents` — id (uuid), claim_id (FK), type, file_url, extracted_text, metadata (jsonb)
- `audits` — id (uuid), claim_id (FK), overall_score, technical_score, presentation_score, risk_level, approval_status, executive_summary, raw_response (jsonb)
- `audit_sections` — id (uuid), audit_id (FK), section, score
- `audit_findings` — id (uuid), audit_id (FK), type, severity, title, description, source_document_id (FK), metadata (jsonb)
- `audit_structured` — id (uuid), audit_id (FK), deferred_items, invoice_adjustments, scope_deviations, unknowns, carrier_questions (all jsonb)
- `audit_versions` — id (uuid), claim_id (FK), audit_id (FK), version_number
- `prompt_settings` — id (uuid), key (text, unique), value (text), updated_at (timestamp)

### Drizzle Schema: `lib/db/src/schema/claims.ts`, `lib/db/src/schema/prompt-settings.ts`

## File Storage

Supabase Storage for claim document uploads.
- **Bucket**: `claim-documents` (auto-created on server start)
- **Server lib**: `artifacts/api-server/src/lib/supabaseStorage.ts` — Supabase Storage client, upload/download/signedUrl/delete
- **Storage routes**: `artifacts/api-server/src/routes/storage.ts` — file upload (multipart), download, signed URL generation
- **Ingest flow**: Frontend sends PDF via FormData to `/api/ingest` → server uploads to Supabase Storage → extracts text → parses with AI → creates claim + document records
- **Env vars**: `SUPABASE_DATABASE_URL` (project ref derived from it), `SUPABASE_SERVICE_ROLE` (for storage admin access)

## Email

SendGrid integration for sending carrier audit emails.
- **Service**: `artifacts/api-server/src/services/sendgrid.ts` — wraps @sendgrid/mail
- **From address**: john@claimsiq.ai (configurable via `SENDGRID_FROM_EMAIL` env var)
- **Email rendering**: `artifacts/api-server/src/services/email.ts` — inline HTML with full carrier scorecard
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

## API Routes

All routes prefixed with `/api`:
- `GET /api/healthz` — Health check
- `GET /api/claims` — List all claims (includes all 13 claim fields)
- `GET /api/claims/:id` — Get claim detail with documents, audit, sections, findings
- `DELETE /api/claims/:id` — Delete claim + all related data (transactional)
- `POST /api/claims/:id/audit` — Run Andover-style carrier audit (calls OpenAI, saves results to DB)
- `POST /api/claims/:id/documents` — Register an uploaded document to a claim
- `DELETE /api/claims/:id/documents/:docId` — Delete a document
- `POST /api/claims/:id/documents/:docId/extract` — Extract text from uploaded document (PDF/text)
- `GET /api/claims/:id/email` — Generate carrier audit email HTML (preview)
- `POST /api/claims/:id/email/send` — Send audit email via SendGrid
- `POST /api/storage/uploads/request-url` — Request presigned upload URL
- `GET /api/storage/objects/*` — Serve uploaded objects
- `GET /api/storage/public-objects/*` — Serve public assets
- `GET /api/settings/prompts` — Get current prompt settings (DB values or defaults)
- `PUT /api/settings/prompts` — Save prompt settings (validates {{REPORT}} placeholder, atomic upsert)
- `POST /api/settings/prompts/reset` — Reset prompts to hardcoded defaults

## Frontend Pages

- `/` — Dashboard with claim stats and quick links
- `/claims` — Claims list with status badges
- `/claims/:id` — 3-column carrier audit dashboard (claim details | Andover-style technical + presentation scorecard + findings | document viewer) with "Preview Email" and "Send to Carrier" actions
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
