import { db, carrierRulesets } from "@workspace/db";
import { pool } from "@workspace/db";
import { ANDOVER_RULESET } from "./andoverRuleset";

async function seed() {
  await db
    .insert(carrierRulesets)
    .values({
      carrierKey: "andover",
      displayName: "Andover",
      active: true,
      ruleset: ANDOVER_RULESET,
    })
    .onConflictDoUpdate({
      target: carrierRulesets.carrierKey,
      set: { ruleset: ANDOVER_RULESET, updatedAt: new Date() },
    });
  console.log("Andover ruleset seeded.");
  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
