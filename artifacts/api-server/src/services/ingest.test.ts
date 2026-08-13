import assert from "node:assert/strict";
import test from "node:test";
import {
  parseClaimMetadataFallback,
  parseClaimMetadataResponse,
} from "./ingest";

test("claim metadata parser accepts fenced JSON and fills missing fields", () => {
  const parsed = parseClaimMetadataResponse(`Here is the result:
\`\`\`json
{
  "claimNumber": "CLM-123",
  "insuredName": "Synthetic Insured",
  "carrier": "Andover",
}
\`\`\``);
  assert.equal(parsed?.claimNumber, "CLM-123");
  assert.equal(parsed?.insuredName, "Synthetic Insured");
  assert.equal(parsed?.carrier, "Andover");
  assert.equal(parsed?.policyNumber, "");
});

test("claim metadata parser extracts the first bounded object", () => {
  const parsed = parseClaimMetadataResponse(
    `Metadata follows: {"claimNumber":"A-1","insuredName":"Example"} End.`,
  );
  assert.equal(parsed?.claimNumber, "A-1");
  assert.equal(parsed?.insuredName, "Example");
});

test("claim metadata parser rejects non-object provider output", () => {
  assert.equal(parseClaimMetadataResponse("not-json"), null);
  assert.equal(parseClaimMetadataResponse("[1,2,3]"), null);
});

test("deterministic fallback recovers standard claim labels", () => {
  const parsed = parseClaimMetadataFallback(`
    Insured: Cristina Santamaria
    Claim Number: CLM-00061867
    Policy Number: HP13176360
    Date of Loss: 1/31/2026
    Peril: Ice Damming
    Loss Location: 83 Old Farm Rd
    Deductible: $1,000.00
  `);
  assert.equal(parsed.claimNumber, "CLM-00061867");
  assert.equal(parsed.insuredName, "Cristina Santamaria");
  assert.equal(parsed.policyNumber, "HP13176360");
  assert.equal(parsed.lossType, "Ice Damming");
  assert.equal(parsed.deductible, "$1,000.00");
});

