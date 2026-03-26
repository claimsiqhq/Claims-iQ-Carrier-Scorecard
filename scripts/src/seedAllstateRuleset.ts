import { db, carrierRulesets } from "@workspace/db";
import { pool } from "@workspace/db";
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
  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
