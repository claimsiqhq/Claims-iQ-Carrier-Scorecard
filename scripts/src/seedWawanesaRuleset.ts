import { db, carrierRulesets } from "@workspace/db";
import { pool } from "@workspace/db";
import { WAWANESA_RULESET } from "./wawanesaRuleset";

async function seed() {
  await db
    .insert(carrierRulesets)
    .values({
      carrierKey: "wawanesa",
      displayName: "Wawanesa",
      active: true,
      ruleset: WAWANESA_RULESET,
    })
    .onConflictDoUpdate({
      target: carrierRulesets.carrierKey,
      set: { ruleset: WAWANESA_RULESET, updatedAt: new Date() },
    });
  console.log("Wawanesa ruleset seeded.");
  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
