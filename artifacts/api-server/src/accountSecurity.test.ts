import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccountToken,
  hashAccountToken,
  hashPassword,
  isAccountToken,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from "./lib/accountSecurity";

test("normalizes account email addresses consistently", () => {
  assert.equal(normalizeEmail("  Reviewer@CompleteIQ.com "), "reviewer@completeiq.com");
  assert.equal(normalizeEmail(undefined), "");
});

test("enforces the password length and bcrypt byte boundaries", () => {
  assert.match(validatePassword("short") ?? "", /at least 12/);
  assert.equal(validatePassword("a secure passphrase"), null);
  assert.match(validatePassword("é".repeat(37)) ?? "", /72 UTF-8 bytes/);
});

test("hashes passwords without retaining plaintext", async () => {
  const password = "correct horse battery staple";
  const hash = await hashPassword(password);
  assert.notEqual(hash, password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("incorrect password", hash), false);
});

test("creates opaque tokens and stores only deterministic hashes", () => {
  const token = createAccountToken();
  assert.equal(isAccountToken(token.raw), true);
  assert.equal(token.hash, hashAccountToken(token.raw));
  assert.notEqual(token.hash, token.raw);
  assert.equal(token.hash.length, 64);
});
