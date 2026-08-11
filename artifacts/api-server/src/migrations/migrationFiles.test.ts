import assert from "node:assert/strict";
import test from "node:test";
import { isMigrationFilename, removeOuterTransaction } from "./migrationFiles";

test("migration discovery accepts only root migration filename formats", () => {
  assert.equal(isMigrationFilename("0001_phase2.sql"), true);
  assert.equal(
    isMigrationFilename("20260810232004_carrier_tenant_data_cutover.sql"),
    true,
  );
  assert.equal(
    isMigrationFilename("validate_carrier_tenant_cutover.sql"),
    false,
  );
  assert.equal(isMigrationFilename("testing"), false);
  assert.equal(
    isMigrationFilename("20260810232004_cutover.sql.disabled"),
    false,
  );
});

test("commented migration transactions remain inside the migrator transaction", () => {
  const migration = `-- migration comment
-- second comment

BEGIN;

SELECT 1;

COMMIT;
`;
  assert.equal(
    removeOuterTransaction(migration),
    `-- migration comment
-- second comment

SELECT 1;`,
  );
});

test("non-transactional or incomplete SQL is not rewritten", () => {
  assert.equal(removeOuterTransaction("SELECT 1;"), "SELECT 1;");
  assert.equal(
    removeOuterTransaction("-- comment\nBEGIN;\nSELECT 1;"),
    "-- comment\nBEGIN;\nSELECT 1;",
  );
});
