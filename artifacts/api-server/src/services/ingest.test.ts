import assert from "node:assert/strict";
import test from "node:test";
import { parseClaimMetadataResponse } from "./ingest";

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

