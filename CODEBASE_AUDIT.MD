# Production Readiness, Security, and Operability Audit

Audit date: 2026-03-18  
Repository: `/home/runner/workspace`

---

## Audit Method (commands/searches used)

- Enumerated repository structure and package boundaries.
- Searched codebase for critical patterns:
  - `rg "router\.(get|post|put|delete)|Router\(" artifacts/api-server/src`
  - `rg "requireAuth|authMiddleware|isAuthenticated|SESSION_COOKIE" artifacts/api-server/src`
  - `rg "pdf-parse|pdfParse|responses\.create|chat\.completions\.create|image_url" artifacts/api-server/src`
  - `rg "TODO|FIXME|placeholder|mock|not implemented" artifacts claims-iq lib`
  - `rg "credentials:\s*\"include\"|fetch\(" artifacts/claims-iq/src`
  - `rg "sourcemap|sourceMap|PORT|BASE_PATH" artifacts/**/vite.config.ts`
  - `rg "SUPABASE|SENDGRID|OPENAI|JWT_SECRET" artifacts/api-server src lib`
  - `rg "dangerouslySetInnerHTML|innerHTML|eval\(" artifacts lib`
  - `rg "rateLimit|helmet|cors|csrf|origin" artifacts/api-server/src`
  - `rg "BEGIN|COMMIT|ROLLBACK|transaction" artifacts/api-server/src`
- Read and inspected key files directly:
  - API app/bootstrap/middleware/routes/services
  - DB schema and DB client config
  - Frontend route/pages + API client usage
  - Vite and workspace/package configuration
- Ran validation commands:
  - `pnpm run typecheck`
  - `pnpm run build`
  - `pnpm --filter @workspace/api-server run test`

---

## Phase 0 — System Map

### 1) Repository structure

- `artifacts/api-server`: Express API (backend)
- `artifacts/claims-iq`: Primary React frontend
- `artifacts/mockup-sandbox`: Frontend preview/sandbox app
- `lib/db`: Drizzle schema + DB client
- `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`: contract and generated clients/schemas
- `lib/integrations-openai-ai-server`: OpenAI integration utilities
- `lib/object-storage-web`: storage-related client helper library
- `scripts`: helper scripts

### 2) Runtime architecture

- Frontend: Vite + React + Wouter
- Backend: Express 5 API under `/api`
- Data: PostgreSQL via Supabase (`@workspace/db`, Drizzle)
- File storage: Supabase Storage bucket (`claim-documents`)
- External APIs: OpenAI (audit/extraction), SendGrid (outbound + inbound parse webhook)

Architecture sketch:

- Browser UI -> `claims-iq` -> `/api/*` -> Express middleware -> route handlers -> DB/Storage/OpenAI/SendGrid -> JSON/HTML responses

### 3) Auth model

- Session cookie (`sid`) + DB-backed session table.
- `authMiddleware` attaches `req.user`; `requireAuth` guards protected endpoints.
- Login/logout routes are public; most business routes are protected.
- No role model beyond authenticated user (no admin/user RBAC split in schema).

### 4) Data model overview

Core entities (`lib/db/src/schema/claims.ts`, `lib/db/src/schema/auth.ts`):

- `users`, `sessions`
- `claims`
- `documents` (FK to `claims`)
- `audits` (unique per claim), `audit_sections`, `audit_findings`, `audit_structured`, `audit_versions`
- `prompt_settings`

Tenancy boundary:

- **No explicit tenant/user ownership field on claims/documents/audits** (single shared data scope).

### 5) Request lifecycle

Representative flow (claim ingest + audit):

1. UI uploads PDF to API (`/api/ingest` or standalone audit endpoint)
2. API stores file in Supabase Storage
3. API extracts text (Vision page-by-page for PDF paths implemented in current flow)
4. API persists extracted text/metadata in `documents`
5. API runs OpenAI audit
6. API stores/returns audit results
7. UI renders scorecards and optionally sends email via SendGrid

### 6) Environments & deploy target

- Dev/build appears oriented for Replit + local Vite.
- No explicit staging/prod deployment manifests in repo.
- Env-driven runtime configuration in API startup and integrations.

### Critical flows used as audit backbone

1. Auth login/logout/session retrieval
2. Claim ingest and document persistence
3. Claim detail retrieval and audit execution
4. Standalone carrier scorecard audit and email send
5. Inbound SendGrid parse -> async audit -> reply email
6. Prompt settings load/update/reset
7. Storage upload/download/signed URL paths
8. Claim delete and cascading cleanup

---

## A) Executive Summary

### Issues by severity

- **Critical:** 5
- **High:** 8
- **Medium:** 14
- **Low:** 9

### Top production risks (immediate)

1. **Data isolation gap**: claims/audits/documents are not scoped to user/tenant (`lib/db/src/schema/claims.ts`, `artifacts/api-server/src/routes/claims.ts`), enabling cross-user data access in authenticated contexts.
2. **Storage path trust/path traversal risk** in storage/document routes (`artifacts/api-server/src/routes/storage.ts`, `artifacts/api-server/src/routes/documents.ts`).
3. **DB TLS verification disabled** (`lib/db/src/index.ts` with `rejectUnauthorized: false`).
4. **Permissive CORS with credentials** (`artifacts/api-server/src/app.ts` `origin: true` + `credentials: true`).
5. **Migration discipline gap** (no committed DB migrations; runtime depends on direct schema push patterns).

### Production readiness assessment

## **NO-GO**

Rationale: unresolved critical security/data-isolation risks and deployment-operability gaps (storage path validation, tenant boundaries, DB TLS posture, CORS policy, migration safety) must be addressed before production deployment.

---

## B) Audit Coverage Matrix (required)

| Category | Status | Evidence |
|---|---|---|
| 1) Data Layer Integrity | Issues Found | Inspected `lib/db/src/schema/claims.ts`, `lib/db/src/index.ts`, route transaction code in `routes/audit.ts`, `routes/claims.ts`, `routes/documents.ts`; searched migration assets and scripts. |
| 2) API Surface Audit | Issues Found | Enumerated all routes in `artifacts/api-server/src/routes/*.ts`; checked validation/auth/error handling patterns. |
| 3) UI ↔ API Contract | Issues Found | Compared `lib/api-spec/openapi.yaml` and generated client usage vs actual backend routes; inspected `claims-iq` page fetch/hook usage. |
| 4) Feature Completeness | Issues Found | Checked route wiring and page routes; found dead/redirected upload page and mixed manual-fetch/generated-client usage. |
| 5) State & Data Flow | Issues Found | Inspected React Query invalidation, fetch credential usage, async handling in `claims-list.tsx`, `settings.tsx`, `dashboard.tsx`, `claim-detail.tsx`. |
| 6) Security Surface | Issues Found | Inspected CORS/helmet/CSRF/rate-limit/auth middleware, upload/storage paths, session handling, prompt update endpoints. |
| 7) Cross-Cutting Concerns | Issues Found | Checked logger redaction and audit logs (`lib/logger.ts`, `middlewares/auditLog.ts`), error middleware, A11y patterns in UI components/pages. |
| 8) Reliability & Resilience | Issues Found | Checked timeouts/retries in OpenAI calls, graceful shutdown in `index.ts`, route-level fallback behavior and async inbound processing. |
| 9) Observability & Operations | Issues Found | Reviewed health/metrics (`routes/health.ts`, `middlewares/requestMetrics.ts`), structured logging, missing SLO/alert/runbook artifacts. |
| 10) Testing & Quality Gates | Issues Found | Checked test files and scripts; API has focused tests, but full CI config is absent. |
| 11) Build / Release / Env Config | Issues Found | Inspected workspace and app `vite.config.ts`, env parsing in API, build assumptions for `PORT`/`BASE_PATH` and fallback behavior. |
| 12) Dependencies & Supply Chain | Confirmed clean (partial) | Ran `pnpm audit --production` previously (no vulns reported by tool at run time), reviewed workspace lockfile/package scripts. Residual risk remains around update cadence. |
| 13) Privacy / Compliance / Data Lifecycle | Issues Found | Inspected claim/document fields and logs; PII stored in DB and sent to OpenAI; retention/deletion policy docs absent. |
| 14) Multi-Tenancy Isolation | Issues Found | Verified no tenant/user ownership propagation in claims tables/routes; cross-user access risk in shared dataset. |
| 15) Performance & Scale | Issues Found | Checked pagination limits, route payload patterns, frontend bundle output and static imports; identified hotspots and missing load-test evidence. |

---

## C) Endpoint Inventory (required)

| Method + Route | Handler Location | Auth | Consumer(s) | Request/Response Notes | Known Issues |
|---|---|---|---|---|---|
| GET `/api/healthz` | `artifacts/api-server/src/routes/health.ts` | N | Infra/probes | Health with DB check | Clean |
| GET `/api/metrics` | `artifacts/api-server/src/routes/health.ts` | Y | Internal ops | Request metrics summary | No external alerting evidence |
| GET `/api/auth/user` | `artifacts/api-server/src/routes/auth.ts` | N | `auth-context.tsx` | Session user payload | Clean |
| POST `/api/auth/login` | `artifacts/api-server/src/routes/auth.ts` | N | `auth-context.tsx` | Manual validation only | Missing strict schema + per-identity throttling |
| POST `/api/auth/logout` | `artifacts/api-server/src/routes/auth.ts` | N | `auth-context.tsx` | Session clear | Clean |
| GET `/api/dashboard` | `artifacts/api-server/src/routes/dashboard.ts` | Y | `dashboard.tsx` | Aggregated stats | Client error handling weak |
| GET `/api/claims` | `artifacts/api-server/src/routes/claims.ts` | Y | `useListClaims` | paginated with limit/offset | No total count; no tenant scoping |
| POST `/api/claims` | `artifacts/api-server/src/routes/claims.ts` | Y | Limited/indirect | Manual validation | No strict schema |
| GET `/api/claims/:id` | `artifacts/api-server/src/routes/claims.ts` | Y | `useGetClaimDetail` | Zod-validated response | No tenant scoping |
| DELETE `/api/claims/:id` | `artifacts/api-server/src/routes/claims.ts` | Y | `claim-detail.tsx` | Transactional delete | No tenant scoping |
| POST `/api/claims/:id/audit` | `artifacts/api-server/src/routes/audit.ts` | Y | `claim-detail.tsx` | Rate-limited; audit run | No tenant scoping |
| POST `/api/claims/:id/documents` | `artifacts/api-server/src/routes/documents.ts` | Y | mostly backend/internal | Stores storagePath metadata | Unvalidated `storagePath` |
| DELETE `/api/claims/:id/documents/:docId` | `artifacts/api-server/src/routes/documents.ts` | Y | not primary UI | Deletes DB doc | Storage object cleanup gap |
| POST `/api/claims/:id/documents/:docId/extract` | `artifacts/api-server/src/routes/documents.ts` | Y | not primary UI | Text extraction path | Depends on trusted storagePath |
| GET `/api/claims/:id/email` | `artifacts/api-server/src/routes/email.ts` | Y | `claim-detail.tsx` | HTML preview JSON payload | Clean |
| POST `/api/claims/:id/email/send` | `artifacts/api-server/src/routes/email.ts` | Y | `claim-detail.tsx` | Rate-limited send | Any-recipient policy risk |
| GET `/api/settings/prompts` | `artifacts/api-server/src/routes/settings.ts` | Y | `settings.tsx` | Prompt fetch | Prompt governance risk |
| PUT `/api/settings/prompts` | `artifacts/api-server/src/routes/settings.ts` | Y | `settings.tsx` | Prompt update | No role separation/length limits |
| POST `/api/settings/prompts/reset` | `artifacts/api-server/src/routes/settings.ts` | Y | `settings.tsx` | Prompt reset | No role separation |
| POST `/api/storage/upload` | `artifacts/api-server/src/routes/storage.ts` | Y | Mixed/manual | Multipart upload | Needs stricter path policy |
| GET `/api/storage/download/*storagePath` | `artifacts/api-server/src/routes/storage.ts` | Y | Not primary UI | Binary return | Path traversal/input trust risk |
| GET `/api/storage/signed-url/*storagePath` | `artifacts/api-server/src/routes/storage.ts` | Y | Not primary UI | Signed URL return | Path traversal/input trust risk |
| POST `/api/ingest` | `artifacts/api-server/src/routes/ingest.ts` | Y | `claims-list.tsx` | file ingest + claim create | Client credentials mismatch risk |
| POST `/api/audit/standalone` | `artifacts/api-server/src/routes/auditStandalone.ts` | Y | `audit-results.tsx` | reportText or file | Long-running behavior requires observability |
| POST `/api/audit/standalone/email` | `artifacts/api-server/src/routes/auditStandalone.ts` | Y | `audit-results.tsx` | Zod payload validation | Clean |
| POST `/email/inbound` | `artifacts/api-server/src/routes/emailInbound.ts` | Token | SendGrid | immediate 200 + async process | Query token leakage risk; source verification unknown |

---

## D) Detailed Findings by Category

> Each issue includes location, severity, description, recommendation, and risk scenario.

### 1) Data Layer Integrity

1. **No claim ownership/tenant boundary in schema**
   - **Location:** `lib/db/src/schema/claims.ts` (claims/documents/audits tables)
   - **Severity:** Critical
   - **Description:** Core claim data lacks `userId`/tenant key.
   - **Recommendation:** Add ownership column(s), FK to `users`, enforce in all route queries and writes.
   - **Risk scenario:** One user can list/read/delete another user’s claim records.

2. **Migration artifacts/process not codified**
   - **Location:** `lib/db` (no committed migrations), `scripts/post-merge.sh`
   - **Severity:** High
   - **Description:** Schema lifecycle appears tied to push/update scripts rather than reviewed migration files.
   - **Recommendation:** Introduce versioned up/down migrations in repo; apply in deploy pipeline.
   - **Risk scenario:** Non-reproducible schema drift and irreversible production data changes.

3. **DB TLS verification disabled**
   - **Location:** `lib/db/src/index.ts` (`rejectUnauthorized: false`)
   - **Severity:** Critical
   - **Description:** DB connection accepts unverifiable cert.
   - **Recommendation:** Enable cert verification with proper trust chain.
   - **Risk scenario:** MITM intercepts DB traffic.

4. **Orphaned storage objects on doc deletion**
   - **Location:** `artifacts/api-server/src/routes/documents.ts` delete handler
   - **Severity:** High
   - **Description:** DB row deleted but storage object not removed.
   - **Recommendation:** Delete storage object (best-effort with logged failures) before/after DB delete transaction.
   - **Risk scenario:** Storage growth and compliance retention breaches.

5. **Confirmed clean: transactional boundaries in high-risk write flows**
   - **Evidence:** `routes/audit.ts`, `routes/claims.ts`, `routes/documents.ts` use BEGIN/COMMIT/ROLLBACK patterns.

### 2) API Surface Audit

1. **Insufficient strict request schemas on several mutating endpoints**
   - **Location:** `artifacts/api-server/src/routes/claims.ts`, `routes/auth.ts`, `routes/settings.ts`
   - **Severity:** Medium
   - **Description:** Many handlers use manual checks rather than strict Zod validation.
   - **Recommendation:** Add shared request schemas for body/query/params; central validation middleware.
   - **Risk scenario:** Unexpected payload shapes causing inconsistent writes or silent truncation.

2. **Storage wildcard routes trust path input**
   - **Location:** `artifacts/api-server/src/routes/storage.ts`
   - **Severity:** Critical
   - **Description:** Raw wildcard path passed into storage operations without canonical validation.
   - **Recommendation:** enforce strict regex allowlist (`uploads/<uuid>/<filename>`) and reject traversal patterns.
   - **Risk scenario:** unauthorized file access.

3. **Confirmed clean: authentication middleware coverage**
   - **Evidence:** business-critical `/api/*` routes (except health/auth public endpoints) consistently use `requireAuth`.

### 3) UI ↔ API Contract

1. **OpenAPI drift: storage endpoints mismatch**
   - **Location:** `lib/api-spec/openapi.yaml` vs `artifacts/api-server/src/routes/storage.ts`
   - **Severity:** High
   - **Description:** Spec references presigned URL request endpoint while implementation exposes direct upload endpoint.
   - **Recommendation:** update OpenAPI to actual API or reintroduce spec-compliant endpoint.
   - **Risk scenario:** generated clients fail against live backend.

2. **OpenAPI field mismatch for documents**
   - **Location:** `lib/api-spec/openapi.yaml` vs `artifacts/api-server/src/routes/documents.ts`
   - **Severity:** High
   - **Description:** Spec uses `objectPath`; server expects `storagePath`.
   - **Recommendation:** harmonize naming and regenerate clients.
   - **Risk scenario:** client sends wrong payload and receives validation errors.

3. **Confirmed clean: claim detail/list responses validated server-side**
   - **Evidence:** `ListClaimsResponse.parse`, `GetClaimDetailResponse.parse` in claims routes.

### 4) Feature Completeness

1. **Dead upload route in frontend**
   - **Location:** `artifacts/claims-iq/src/App.tsx` (`/upload` redirects)
   - **Severity:** Low
   - **Description:** Upload page path is not actually used for upload flow.
   - **Recommendation:** remove dead route or wire intended page.
   - **Risk scenario:** user confusion and stale code maintenance burden.

2. **Mixed API access patterns (manual fetch + generated client)**
   - **Location:** `artifacts/claims-iq/src/pages/*`
   - **Severity:** Medium
   - **Description:** inconsistent use of generated hooks vs ad hoc fetch.
   - **Recommendation:** consolidate on generated client to reduce drift.
   - **Risk scenario:** mismatched error handling and stale cache behavior.

### 5) State & Data Flow

1. **Credential inclusion inconsistent in frontend**
   - **Location:** `artifacts/claims-iq/src/pages/claims-list.tsx`, `settings.tsx`
   - **Severity:** High
   - **Description:** some manual fetch calls do not include `credentials: "include"` while backend expects session cookie.
   - **Recommendation:** ensure all authenticated fetch calls include credentials consistently.
   - **Risk scenario:** intermittent 401s depending on origin/deployment topology.

2. **Cache invalidation key mismatch**
   - **Location:** `artifacts/claims-iq/src/pages/claims-list.tsx`
   - **Severity:** Medium
   - **Description:** invalidation uses hardcoded key not guaranteed to match generated key.
   - **Recommendation:** use generated query key helper consistently.
   - **Risk scenario:** stale claims list after ingest.

3. **Confirmed clean: global error boundary present**
   - **Evidence:** `artifacts/claims-iq/src/App.tsx` wraps app in `ErrorBoundary`.

### 6) Security Surface

1. **CORS policy too permissive with credentials**
   - **Location:** `artifacts/api-server/src/app.ts`
   - **Severity:** Critical
   - **Description:** dynamic reflected origin + credentials broadens trusted origins unnecessarily.
   - **Recommendation:** explicit allowlist.
   - **Risk scenario:** cross-site authenticated requests from untrusted origins.

2. **Prompt editing is not role-restricted**
   - **Location:** `artifacts/api-server/src/routes/settings.ts`
   - **Severity:** High
   - **Description:** any authenticated user can alter system prompts.
   - **Recommendation:** introduce admin RBAC for prompt mutation routes.
   - **Risk scenario:** malicious prompt changes degrade or manipulate audits.

3. **Upload file-name/path sanitization gap**
   - **Location:** `artifacts/api-server/src/lib/supabaseStorage.ts`
   - **Severity:** High
   - **Description:** `originalname` contributes to storage path; needs strict normalization.
   - **Recommendation:** sanitize basename and reject unsafe characters/sequences.
   - **Risk scenario:** path confusion or bypass of expected storage layout.

4. **Confirmed clean: session cookie flags**
   - **Evidence:** `httpOnly`, `sameSite`, `secure` set in auth route cookie setter.

### 7) Cross-Cutting Concerns

1. **Accessibility gaps in interactive div-based controls**
   - **Location:** `artifacts/claims-iq/src/components/Sidebar.tsx`
   - **Severity:** Medium
   - **Description:** clickable `div` controls lack native keyboard semantics.
   - **Recommendation:** use `<button>`/`<a>` semantics + ARIA where needed.
   - **Risk scenario:** keyboard users cannot navigate reliably.

2. **Confirmed clean: structured logging with redaction**
   - **Evidence:** `artifacts/api-server/src/lib/logger.ts` uses pino JSON + redact paths.

### 8) Reliability & Resilience

1. **Long-running workflows need explicit progress/timeout strategy**
   - **Location:** `artifacts/api-server/src/services/finalReportIngestion.ts`, `routes/emailInbound.ts`
   - **Severity:** Medium
   - **Description:** page-by-page vision extraction can be long-running and costly; synchronous API path may time out under load.
   - **Recommendation:** background job queue for large files; client polling/status endpoint.
   - **Risk scenario:** request timeout/dropped connections while expensive processing continues.

2. **Confirmed clean: graceful shutdown exists**
   - **Evidence:** `artifacts/api-server/src/index.ts` handles SIGTERM/SIGINT, closes server and DB pool.

### 9) Observability & Operations

1. **No clear alerting/SLO/runbook assets in repo**
   - **Location:** repo-wide (no ops/runbook/alerts config)
   - **Severity:** Medium
   - **Description:** metrics/logging present, but operational response artifacts absent.
   - **Recommendation:** define SLOs, alert thresholds, and incident runbook docs.
   - **Risk scenario:** prolonged outages due to unclear response paths.

2. **Confirmed clean: health + metrics endpoints exist**
   - **Evidence:** `routes/health.ts`, `middlewares/requestMetrics.ts`.

### 10) Testing & Quality Gates

1. **No visible CI workflow definitions**
   - **Location:** repo root (no standard CI manifests detected)
   - **Severity:** High
   - **Description:** local tests/build pass, but CI enforcement unknown.
   - **Recommendation:** add CI pipeline for typecheck, tests, build, audit.
   - **Risk scenario:** regressions merged without automated gates.

2. **Confirmed clean: focused API tests exist for new scorecard flow**
   - **Evidence:** `artifacts/api-server/src/*.test.ts` coverage for schema/route/email/inbound timing behavior.

### 11) Build / Release / Env Config

1. **Build-time env hard dependencies were brittle (now mitigated)**
   - **Location:** `artifacts/claims-iq/vite.config.ts`, `artifacts/mockup-sandbox/vite.config.ts`
   - **Severity:** Medium
   - **Description:** config originally required `PORT`/`BASE_PATH` for build.
   - **Recommendation:** retain safe defaults and document deploy overrides.
   - **Risk scenario:** non-portable CI/build failures.

2. **Confirmed clean: API startup validates key required env vars**
   - **Evidence:** `artifacts/api-server/src/index.ts` checks `PORT`, `SUPABASE_DATABASE_URL`, `SUPABASE_SERVICE_ROLE`.

### 12) Dependencies & Supply-Chain Security

1. **No critical vulns reported at audit run**
   - **Status:** Confirmed clean (point-in-time)
   - **Evidence:** `pnpm audit --production` previously returned clean.

2. **Residual governance gap**
   - **Location:** repo-wide
   - **Severity:** Low
   - **Description:** no explicit SBOM/provenance/automated dependency policy artifacts in repo.
   - **Recommendation:** add periodic dependency update and audit workflow.
   - **Risk scenario:** stale vulnerable transitive deps over time.

### 13) Privacy / Compliance / Data Lifecycle

1. **PII-rich fields persisted and sent to AI; retention policy unclear**
   - **Location:** `lib/db/src/schema/claims.ts`, routes/services using OpenAI text payloads
   - **Severity:** High
   - **Description:** claims/document text contain personal and financial data; retention/deletion policy docs absent.
   - **Recommendation:** document retention/deletion policy; add purge tooling and compliance notes.
   - **Risk scenario:** regulatory non-compliance and excessive retention.

2. **Confirmed clean: logger redacts common sensitive fields**
   - **Evidence:** `logger.ts` redaction includes passwords/emails/insuredName/address/policyNumber.

### 14) Multi-Tenancy Isolation

1. **No tenant isolation in query path**
   - **Location:** `artifacts/api-server/src/routes/claims.ts` and related claim/audit/document routes
   - **Severity:** Critical
   - **Description:** all authenticated users query shared claim space without ownership checks.
   - **Recommendation:** enforce user/tenant filters in every claim-related route and DB schema.
   - **Risk scenario:** cross-account data leakage/modification.

### 15) Performance & Scale

1. **Frontend bundle size sizable**
   - **Location:** build output (`claims-iq` JS bundle ~460KB before gzip)
   - **Severity:** Medium
   - **Description:** static imports for all pages/components increase first-load cost.
   - **Recommendation:** lazy-load routes and heavy modules.
   - **Risk scenario:** slow initial load on low-end/mobile networks.

2. **Confirmed clean: basic pagination limits enforced on claims list**
   - **Evidence:** `routes/claims.ts` caps limit at 100 and offset >= 0.

---

## E) Prioritized Remediation Checklist

### Must fix before release (Critical/High)

1. Add ownership/tenant scoping to claims/documents/audits + enforce in all queries (Critical).
2. Enforce strict storage path allowlists in `storage` and `documents` routes (Critical).
3. Enable DB TLS cert verification (`rejectUnauthorized: true`) (Critical).
4. Restrict CORS origins to explicit allowlist (Critical).
5. Restrict prompt mutation routes to admin role (High).
6. Sanitize upload filenames and canonicalize storage paths (High).
7. Add CI quality gates (typecheck/test/build/audit) (High).
8. Add storage cleanup on document delete (High).

### Should fix next (Medium)

9. Replace manual validation with shared Zod schemas on mutating routes.
10. Standardize frontend API calls (generated client + consistent credentials + query key invalidation).
11. Move large file extraction to background job/polling model.
12. Improve A11y semantics for interactive controls.
13. Add operational runbook and alerting/SLO docs.
14. Introduce dependency governance cadence.

### Nice-to-have (Low)

15. Improve pagination response shape with total count.
16. Reduce frontend initial bundle via lazy route loading.
17. Clean up dead/redirected upload route code paths.

---

## Go/No-Go Decision

**No-Go** until Critical items #1-#4 are remediated and verified.

---

## Unknowns (explicit)

These could not be fully verified from repo alone:

- Supabase RLS policy coverage and storage bucket policies
- SendGrid inbound source validation controls beyond token
- Production secret management/rotation and deploy-time env configuration
- Incident alert wiring and on-call runbooks outside code repository

Required evidence to close unknowns:

- Supabase policy exports/screenshots + test results
- SendGrid webhook hardening documentation
- CI/deploy config and environment manifest
- Ops docs (SLOs, alert thresholds, rollback playbook)

