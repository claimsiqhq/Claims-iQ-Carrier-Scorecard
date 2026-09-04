import { ANDOVER_RULESET } from "./andoverRuleset";
import { ASSURANT_RULESET } from "./assurantRuleset";
import type { CarrierRulesetConfig } from "./carrierRulesetConfig";

/**
 * Prints the JSON literal for a carrier ruleset exactly as it must be embedded
 * in a SQL migration. Migrations never hand-type ruleset JSON; they paste the
 * output of this command, and the api-server drift test
 * (`artifacts/api-server/src/migrations/assurantTenantRulesets.test.ts`)
 * fails if the embedded JSON and the TypeScript source ever diverge.
 *
 *   pnpm --filter @workspace/scripts run ruleset:json andover
 *   pnpm --filter @workspace/scripts run ruleset:json assurant
 */
const RULESETS: Readonly<Record<string, CarrierRulesetConfig>> = {
  andover: ANDOVER_RULESET,
  assurant: ASSURANT_RULESET,
};

const requested = process.argv[2];
const ruleset = requested ? RULESETS[requested] : undefined;

if (!ruleset) {
  process.stderr.write(
    `Usage: ruleset:json <${Object.keys(RULESETS).join("|")}>\n`,
  );
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(ruleset, null, 2)}\n`);
