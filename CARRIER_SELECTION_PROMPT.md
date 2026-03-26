# Claude Code Prompt: Carrier Selection & Carrier-Specific Rulesets

## Context

You are working on the **Claims iQ Carrier Scorecard** application. The stack is:
- **Backend**: Node.js + Express + TypeScript (`artifacts/api-server/src/`)
- **Frontend**: React + Vite + TypeScript + shadcn/ui (`artifacts/claims-iq/src/`)
- **Database**: Supabase (PostgreSQL) via Drizzle ORM (`lib/db/src/`)
- **AI**: OpenAI API (`lib/integrations-openai-ai-server/`)

The app currently scores insurance claim files using two parallel systems:
1. A question-based DA/FA scorecard (`services/scoringEngine.ts`, `services/questionBank.ts`)
2. An OpenAI-driven carrier scorecard with 7 fixed categories (`services/carrierScorecardAudit.ts`)

**The `claims` table already has a `carrier` field (text).** The `claims.carrier` value is passed into `runFinalAudit()` as `carrier_name` but is NOT yet used to select carrier-specific questions, categories, or prompts.

## Feature: Carrier Selection + Carrier-Specific Rulesets

### What to build

1. **A `carrier_rulesets` table** in Supabase storing per-carrier question banks, scoring categories, and prompt overrides as JSONB.
2. **A carrier ruleset service** that loads a carrier's ruleset from the DB, falling back to the current defaults if none is configured.
3. **Thread `carrier` through the entire audit pipeline** so that the right questions and categories are used automatically based on `claim.carrier`.
4. **A carriers API** (`GET /api/carriers`, `GET /api/carriers/:key`, `PUT /api/carriers/:key`) for managing rulesets.
5. **A carrier selector on the upload page** (`pages/upload.tsx`) so users can choose the carrier when creating a claim.
6. **Seed the Allstate ruleset** (full spec provided below) as the first carrier configuration.

---

## Step 1: Database — New `carrier_rulesets` Table

Create a new file: `lib/db/src/schema/carrierRulesets.ts`

```typescript
import { pgTable, text, uuid, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const carrierRulesets = pgTable("carrier_rulesets", {
  id: uuid("id").primaryKey().defaultRandom(),
  carrierKey: text("carrier_key").notNull().unique(), // e.g. "allstate", "amfam", "travelers"
  displayName: text("display_name").notNull(),        // e.g. "Allstate"
  logoUrl: text("logo_url"),
  active: boolean("active").notNull().default(true),
  ruleset: jsonb("ruleset").notNull(),                // CarrierRuleset JSON (see type below)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CarrierRuleset = typeof carrierRulesets.$inferSelect;
```

Export it from `lib/db/src/schema/index.ts` and `lib/db/src/index.ts`.

Write the Drizzle migration:

```sql
CREATE TABLE IF NOT EXISTS carrier_rulesets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  logo_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  ruleset JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Step 2: Carrier Ruleset TypeScript Types

Create: `artifacts/api-server/src/services/carrierRulesetTypes.ts`

```typescript
import type { Question } from "./questionBank";

export interface CarrierScorecardCategory {
  id: string;
  label: string;
  max_score: number; // always 5
}

export interface CarrierRulesetConfig {
  version: string;                          // e.g. "1.0"
  da_questions: Question[];
  fa_questions: Question[];
  scorecard_categories: CarrierScorecardCategory[];
  system_prompt_override?: string;          // optional — replaces default SYSTEM_PROMPT
  carrier_scorecard_prompt_override?: string; // optional — replaces carrier_scorecard_v1 prompt
}
```

---

## Step 3: Carrier Ruleset Service

Create: `artifacts/api-server/src/services/carrierRulesetService.ts`

```typescript
import { db, carrierRulesets } from "@workspace/db";
import { eq } from "drizzle-orm";
import logger from "../lib/logger";
import { DA_QUESTIONS, FA_QUESTIONS } from "./questionBank";
import { CARRIER_SCORECARD_CATEGORIES } from "./carrierScorecardAudit";
import type { CarrierRulesetConfig } from "./carrierRulesetTypes";

// Default fallback — uses the existing hardcoded questions/categories
function getDefaultRuleset(): CarrierRulesetConfig {
  return {
    version: "1.0",
    da_questions: DA_QUESTIONS,
    fa_questions: FA_QUESTIONS,
    scorecard_categories: CARRIER_SCORECARD_CATEGORIES.map((c) => ({ ...c })),
  };
}

// Normalize carrier key: lowercase, trim, replace spaces with underscores
export function normalizeCarrierKey(carrier: string): string {
  return carrier.trim().toLowerCase().replace(/\s+/g, "_");
}

// Load a carrier's ruleset from DB. Falls back to defaults if not found.
export async function getCarrierRuleset(carrierName: string): Promise<CarrierRulesetConfig> {
  if (!carrierName) return getDefaultRuleset();

  const key = normalizeCarrierKey(carrierName);

  try {
    const [row] = await db
      .select({ ruleset: carrierRulesets.ruleset })
      .from(carrierRulesets)
      .where(eq(carrierRulesets.carrierKey, key))
      .limit(1);

    if (row?.ruleset) {
      return row.ruleset as CarrierRulesetConfig;
    }
  } catch (err) {
    logger.warn({ err, carrierKey: key }, "Carrier ruleset lookup failed, using defaults");
  }

  return getDefaultRuleset();
}

// List all active carriers (for the UI selector)
export async function listActiveCarriers(): Promise<{ key: string; displayName: string; logoUrl: string | null }[]> {
  try {
    const rows = await db
      .select({
        key: carrierRulesets.carrierKey,
        displayName: carrierRulesets.displayName,
        logoUrl: carrierRulesets.logoUrl,
      })
      .from(carrierRulesets)
      .where(eq(carrierRulesets.active, true));
    return rows;
  } catch (err) {
    logger.warn({ err }, "Failed to list carriers");
    return [];
  }
}
```

---

## Step 4: Thread Carrier Through the Audit Pipeline

### 4a. Update `runQuestionAudit.ts`

Change the function signature to accept a `carrier` parameter and use the carrier's ruleset:

```typescript
// Before:
export async function runQuestionAudit(reportText: string): Promise<QuestionAuditOutput>

// After:
export async function runQuestionAudit(reportText: string, carrier?: string): Promise<QuestionAuditOutput>
```

At the top of the function body, replace the static question imports with:

```typescript
import { getCarrierRuleset } from "./carrierRulesetService";

// Inside function:
const ruleset = await getCarrierRuleset(carrier ?? "");
const daQuestions = ruleset.da_questions;
const faQuestions = ruleset.fa_questions;
const systemPrompt = ruleset.system_prompt_override ?? SYSTEM_PROMPT;
```

Use `daQuestions` and `faQuestions` everywhere `DA_QUESTIONS` and `FA_QUESTIONS` were used. Use `systemPrompt` in the OpenAI call.

### 4b. Update `carrierScorecardAudit.ts`

Change `runCarrierScorecardAudit` to accept and use carrier-specific categories:

```typescript
// Add carrier param:
export async function runCarrierScorecardAudit(input: {
  reportText: string;
  requestId: string;
  carrier?: string;        // NEW
}): Promise<CarrierScorecardAuditResult>
```

Inside the function, load carrier categories:

```typescript
import { getCarrierRuleset } from "./carrierRulesetService";

const ruleset = await getCarrierRuleset(input.carrier ?? "");
const categories = ruleset.scorecard_categories;
const promptOverride = ruleset.carrier_scorecard_prompt_override;
const systemPrompt = promptOverride ?? await getPrompt("carrier_scorecard_v1");
```

Update `buildCarrierScorecardFallback` and `normalizeCarrierScorecard` to accept a `categories` parameter instead of relying on the module-level constant.

### 4c. Update `services/audit.ts`

Pass `carrier_name` through to both `runQuestionAudit` and `runCarrierScorecardAudit`:

```typescript
// Wherever runQuestionAudit is called:
await runQuestionAudit(reportText, claimContext.carrier_name)

// Wherever runCarrierScorecardAudit is called:
await runCarrierScorecardAudit({ reportText, requestId, carrier: claimContext.carrier_name })
```

---

## Step 5: Carriers API Route

Create: `artifacts/api-server/src/routes/carriers.ts`

```typescript
import { Router } from "express";
import { db, carrierRulesets } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { listActiveCarriers } from "../services/carrierRulesetService";

const router = Router();

// GET /api/carriers — list all active carriers for UI selector
router.get("/", async (req, res) => {
  const carriers = await listActiveCarriers();
  res.json(carriers);
});

// GET /api/carriers/:key — get full ruleset
router.get("/:key", requireAuth, async (req, res) => {
  const [row] = await db
    .select()
    .from(carrierRulesets)
    .where(eq(carrierRulesets.carrierKey, req.params.key))
    .limit(1);
  if (!row) return res.status(404).json({ error: "Carrier not found" });
  res.json(row);
});

// PUT /api/carriers/:key — upsert a carrier ruleset (admin only)
router.put("/:key", requireAuth, async (req, res) => {
  const { displayName, logoUrl, ruleset, active } = req.body;
  await db
    .insert(carrierRulesets)
    .values({ carrierKey: req.params.key, displayName, logoUrl, ruleset, active })
    .onConflictDoUpdate({
      target: carrierRulesets.carrierKey,
      set: { displayName, logoUrl, ruleset, active, updatedAt: new Date() },
    });
  res.json({ success: true });
});

export default router;
```

Register this router in `routes/index.ts`:
```typescript
import carriersRouter from "./carriers";
app.use("/api/carriers", carriersRouter);
```

---

## Step 6: Frontend — Carrier Selector on Upload Page

In `artifacts/claims-iq/src/pages/upload.tsx`:

1. On component mount, fetch `GET /api/carriers` and store results in state as `carriers: { key: string; displayName: string }[]`.

2. Add a `Select` (from `components/ui/select.tsx`) to the claim creation form:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// In form state:
const [selectedCarrier, setSelectedCarrier] = useState<string>("");

// In JSX (below insured name, above file upload):
<div className="space-y-2">
  <label className="text-sm font-medium">Carrier</label>
  <Select value={selectedCarrier} onValueChange={setSelectedCarrier}>
    <SelectTrigger>
      <SelectValue placeholder="Select carrier..." />
    </SelectTrigger>
    <SelectContent>
      {carriers.map((c) => (
        <SelectItem key={c.key} value={c.key}>{c.displayName}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

3. Pass `carrier: selectedCarrier` in the claim creation POST body so it saves to `claims.carrier`.

---

## Step 7: Seed the Allstate Ruleset

Create: `scripts/src/seedAllstateRuleset.ts`

Run this once to insert the Allstate ruleset into the DB. The full ruleset JSON is in `ALLSTATE_RULESET.md` in this directory.

```typescript
import { db, carrierRulesets } from "@workspace/db";
import { ALLSTATE_RULESET } from "./allstateRuleset";

async function seed() {
  await db
    .insert(carrierRulesets)
    .values({
      carrierKey: "allstate",
      displayName: "Allstate",
      active: true,
      ruleset: ALLSTATE_RULESET,
    })
    .onConflictDoUpdate({
      target: carrierRulesets.carrierKey,
      set: { ruleset: ALLSTATE_RULESET, updatedAt: new Date() },
    });
  console.log("Allstate ruleset seeded.");
  process.exit(0);
}

seed();
```

---

## Important Implementation Notes

- **Do not break existing behavior.** When `carrier` is empty or not found in the DB, fall back to the existing hardcoded `DA_QUESTIONS`, `FA_QUESTIONS`, and `CARRIER_SCORECARD_CATEGORIES`. The current functionality must remain the default.
- **The `carrier` field on `claims` is already text** — no schema migration needed there.
- **Type safety**: The `ruleset` JSONB column should be typed as `CarrierRulesetConfig` in application code. Add a Zod schema to validate it on read.
- **`CARRIER_SCORECARD_CATEGORIES` constant** in `carrierScorecardAudit.ts` should remain as the fallback default, but all internal functions that reference it must accept it as a parameter instead of importing the module-level constant directly.
- **Question `weight` values** in carrier rulesets use the same 0–100 integer point system as the existing `questionBank.ts` questions.
