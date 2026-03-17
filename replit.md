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
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (seed, etc.)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database

Uses Supabase PostgreSQL via `SUPABASE_DATABASE_URL` secret. SSL configured with `rejectUnauthorized: false` for Supabase pooler connections.

### Tables (created via Supabase SQL, Drizzle maps to them):
- `claims` — id (uuid), claim_number, insured_name, carrier, date_of_loss, status
- `documents` — id (uuid), claim_id (FK), type, file_url, extracted_text, metadata (jsonb)
- `audits` — id (uuid), claim_id (FK), overall_score, risk_level, approval_status, executive_summary, raw_response (jsonb)
- `audit_sections` — id (uuid), audit_id (FK), section, score
- `audit_findings` — id (uuid), audit_id (FK), type, severity, title, description, source_document_id (FK), metadata (jsonb)
- `audit_structured` — id (uuid), audit_id (FK), deferred_items, invoice_adjustments, scope_deviations, unknowns, carrier_questions (all jsonb)
- `audit_versions` — id (uuid), claim_id (FK), audit_id (FK), version_number

### Drizzle Schema: `lib/db/src/schema/claims.ts`

## API Routes

All routes prefixed with `/api`:
- `GET /api/healthz` — Health check
- `GET /api/claims` — List all claims
- `GET /api/claims/:id` — Get claim detail with documents, audit, sections, findings

## Frontend Pages

- `/` — Dashboard with claim stats and quick links
- `/claims` — Claims list with status badges
- `/claims/:id` — 3-column audit dashboard (claim details | scorecard + findings | document viewer)

## Secrets

- `SUPABASE_DATABASE_URL` — PostgreSQL connection string for Supabase
- `SUPABASE_ANON_KEY` — Supabase anon key
- `SUPABASE_SERVICE_ROLE` — Supabase service role key
- `SESSION_SECRET` — Session secret

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite

## Key Commands

- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API client + Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/scripts run seed` — Seed database with sample claims data
- `pnpm --filter @workspace/claims-iq run dev` — Start frontend dev server
- `pnpm --filter @workspace/api-server run dev` — Start API server
