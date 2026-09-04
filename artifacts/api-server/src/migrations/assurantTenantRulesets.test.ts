import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CarrierRulesetConfig } from "../services/carrierRulesetTypes";
import { carrierRulesetConfigSchema } from "../services/carrierRulesetTypes";
import { DA_QUESTIONS } from "../services/questionBank";
import { isMigrationFilename, removeOuterTransaction } from "./migrationFiles";

/**
 * Drift guard for 20260904161000_assurant_tenant_and_andover_realignment.sql.
 *
 * The migration embeds the Assurant 1.0 and Andover 2.0 rulesets as JSON
 * literals generated from scripts/src/*Ruleset.ts. These tests parse the
 * literals back out of the SQL and prove they still equal the TypeScript
 * sources, satisfy the server's ruleset schema, and carry the generic FA
 * scorecard weights (30 / 15 / 25 / 30).
 */

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const migrationPath = resolve(
  repoRoot,
  "lib/db/migrations/20260904161000_assurant_tenant_and_andover_realignment.sql",
);
const scriptsSourceDir = resolve(repoRoot, "scripts/src");

const GENERIC_FA_WEIGHTS: Readonly<Record<string, number>> = {
  fa_estimate_order: 30,
  fa_photo_quality: 15,
  fa_report: 25,
  fa_policy_provisions: 30,
};

const GENERIC_FA_CHECK_IDS = [
  "fa_estimate_no_duplicate_line_items",
  "fa_estimate_overhead_profit_correct",
  "fa_report_clear_and_grammatical",
  "fa_estimating_guidelines_followed",
];

/** Serializes exactly as the migration generator does, dropping undefined keys. */
function asJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function loadScriptRuleset(
  file: string,
  exportName: string,
): Promise<CarrierRulesetConfig> {
  // The scripts package is not a dependency of api-server, so the source is
  // loaded at runtime (tsx resolves the .ts module) and validated below.
  const moduleUrl = pathToFileURL(resolve(scriptsSourceDir, file)).href;
  const loaded = (await import(moduleUrl)) as Record<string, unknown>;
  const ruleset = loaded[exportName];
  assert.ok(ruleset, `${file} does not export ${exportName}`);
  return asJson(ruleset as CarrierRulesetConfig);
}

function extractEmbeddedRuleset(
  sql: string,
  tag: string,
): CarrierRulesetConfig {
  const literal = new RegExp(
    `\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$::jsonb`,
  ).exec(sql);
  assert.ok(literal, `migration does not embed a $${tag}$ literal`);
  return JSON.parse(literal[1] ?? "") as CarrierRulesetConfig;
}

function faWeightSums(ruleset: CarrierRulesetConfig): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const question of ruleset.fa_questions) {
    sums[question.categoryKey] =
      (sums[question.categoryKey] ?? 0) + question.weight;
  }
  return sums;
}

const migrationSql = await readFile(migrationPath, "utf8");
const embedded = {
  assurant: extractEmbeddedRuleset(migrationSql, "assurant_ruleset"),
  andover: extractEmbeddedRuleset(migrationSql, "andover_ruleset"),
};
const sources = {
  assurant: await loadScriptRuleset("assurantRuleset.ts", "ASSURANT_RULESET"),
  andover: await loadScriptRuleset("andoverRuleset.ts", "ANDOVER_RULESET"),
};
const carriers = ["assurant", "andover"] as const;

test("migration file is discoverable and runs inside the migrator transaction", () => {
  assert.equal(isMigrationFilename(basename(migrationPath)), true);
  const body = removeOuterTransaction(migrationSql);
  assert.notEqual(body, migrationSql, "outer BEGIN/COMMIT should be stripped");
  assert.doesNotMatch(body, /^\s*BEGIN;/m);
  assert.doesNotMatch(body, /COMMIT;\s*$/);
});

test("embedded Assurant ruleset equals scripts/src/assurantRuleset.ts", () => {
  assert.deepEqual(embedded.assurant, sources.assurant);
  assert.equal(embedded.assurant.version, "1.0");
});

test("embedded Andover ruleset equals scripts/src/andoverRuleset.ts", () => {
  assert.deepEqual(embedded.andover, sources.andover);
  assert.equal(embedded.andover.version, "2.0");
});

test("both rulesets satisfy the server ruleset schema", () => {
  for (const carrier of carriers) {
    const parsed = carrierRulesetConfigSchema.safeParse(embedded[carrier]);
    assert.ok(
      parsed.success,
      `${carrier}: ${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`,
    );
    // The schema strips nothing the sources rely on.
    assert.deepEqual(parsed.data, embedded[carrier]);
  }
});

test("FA categories carry the generic scorecard weights 30/15/25/30", () => {
  for (const carrier of carriers) {
    const ruleset = embedded[carrier];
    assert.deepEqual(faWeightSums(ruleset), GENERIC_FA_WEIGHTS, carrier);
    for (const [categoryKey, expected] of Object.entries(GENERIC_FA_WEIGHTS)) {
      const category = ruleset.scorecard_categories.find(
        (candidate) => candidate.id === categoryKey,
      );
      assert.ok(
        category,
        `${carrier}: scorecard category ${categoryKey} missing`,
      );
      assert.equal(
        category.max_score,
        expected,
        `${carrier}: ${categoryKey} max_score`,
      );
    }
    for (const id of GENERIC_FA_CHECK_IDS) {
      assert.ok(
        ruleset.fa_questions.some((question) => question.id === id),
        `${carrier}: generic check ${id} missing`,
      );
    }
  }
});

test("Assurant DA questions are the generic question bank, unchanged", () => {
  assert.deepEqual(embedded.assurant.da_questions, asJson(DA_QUESTIONS));
  for (const question of DA_QUESTIONS) {
    const category = embedded.assurant.scorecard_categories.find(
      (candidate) => candidate.id === question.categoryKey,
    );
    assert.ok(category, `category ${question.categoryKey} missing`);
    assert.equal(category.label, question.categoryName);
  }
});

test("Andover 2.0 keeps every 1.3 desk-adjuster check and count", () => {
  assert.equal(embedded.andover.da_questions.length, 21);
  assert.equal(embedded.andover.fa_questions.length, 17);
  const daSums: Record<string, number> = {};
  for (const question of embedded.andover.da_questions) {
    daSums[question.categoryKey] =
      (daSums[question.categoryKey] ?? 0) + question.weight;
  }
  assert.deepEqual(daSums, {
    da_file_stack: 10,
    da_payment_match: 20,
    da_report: 10,
    da_policy_provisions: 25,
    da_prior_losses: 10,
    da_denial_letters: 25,
  });
});

test("question ids are unique, prefixed by scorecard, and reference declared categories", () => {
  for (const carrier of carriers) {
    const ruleset = embedded[carrier];
    const questions = [...ruleset.fa_questions, ...ruleset.da_questions];
    const ids = questions.map((question) => question.id);
    assert.equal(new Set(ids).size, ids.length, `${carrier}: duplicate ids`);

    const categoryIds = new Set(
      ruleset.scorecard_categories.map((category) => category.id),
    );
    assert.equal(
      categoryIds.size,
      ruleset.scorecard_categories.length,
      `${carrier}: duplicate scorecard categories`,
    );
    for (const question of questions) {
      assert.ok(
        categoryIds.has(question.categoryKey),
        `${carrier}: ${question.id} references undeclared category ${question.categoryKey}`,
      );
      assert.equal(
        question.section,
        question.scorecard.toLowerCase(),
        `${carrier}: ${question.id} section/scorecard mismatch`,
      );
    }
    for (const question of ruleset.fa_questions) {
      assert.match(question.id, /^fa_/, `${carrier}: ${question.id}`);
      assert.equal(question.scorecard, "FA");
    }
    for (const question of ruleset.da_questions) {
      assert.equal(question.scorecard, "DA", `${carrier}: ${question.id}`);
    }
    // Assurant ids follow the snake_case convention throughout; Andover keeps
    // its production DA ids, which predate the prefix rule.
    if (carrier === "assurant") {
      for (const question of ruleset.da_questions) {
        assert.match(question.id, /^[a-z][a-z0-9_]*$/, question.id);
      }
    }
  }
});
