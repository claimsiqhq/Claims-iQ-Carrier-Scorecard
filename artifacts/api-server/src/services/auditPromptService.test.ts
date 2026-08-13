import assert from "node:assert/strict";
import test from "node:test";
import {
  AuditPromptConfigurationError,
  normalizeAuditUserPromptTemplate,
} from "./auditPromptService";

test("legacy report-only prompts receive server-owned question placeholders", () => {
  const normalized = normalizeAuditUserPromptTemplate(
    "Review this carrier file.\n\n{{REPORT}}",
  );
  assert.match(normalized, /\{\{DA_QUESTIONS\}\}/);
  assert.match(normalized, /\{\{FA_QUESTIONS\}\}/);
  assert.match(normalized, /\{\{REPORT\}\}/);
  assert.ok(
    normalized.indexOf("{{DA_QUESTIONS}}")
      < normalized.indexOf("{{REPORT}}"),
  );
});

test("complete prompt templates are not rewritten", () => {
  const template =
    "{{DA_QUESTIONS}}\n{{FA_QUESTIONS}}\n{{REPORT}}";
  assert.equal(normalizeAuditUserPromptTemplate(template), template);
});

test("report injection remains mandatory", () => {
  assert.throws(
    () => normalizeAuditUserPromptTemplate("Review this file."),
    AuditPromptConfigurationError,
  );
});

