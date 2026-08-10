import assert from "node:assert/strict";
import test from "node:test";
import { renderAccountActionEmail } from "./services/accountEmails";

test("account action emails use the Complete iQ branded template", () => {
  const actionUrl = "https://scorecard.neurovista.ai/reset-password#token=test-token";
  const content = renderAccountActionEmail({
    eyebrow: "Complete iQ account security",
    title: "Reset your password",
    intro: "Choose a new password using the secure link.",
    actionLabel: "Reset password",
    actionUrl,
    expiryLabel: "This link expires in one hour.",
  });

  assert.match(content.html, /<!doctype html>/);
  assert.match(content.html, /Complete iQ Carrier Audit/);
  assert.match(content.html, /images\/complete-iq-signature\.png/);
  assert.match(content.html, /alt="Complete iQ"/);
  assert.match(content.html, /background:#382b55/);
  assert.match(content.html, /Secure, single-use link/);
  assert.match(content.html, new RegExp(actionUrl));
  assert.match(content.text, /COMPLETE iQ CARRIER AUDIT/);
  assert.match(content.text, new RegExp(actionUrl));
});

test("account action emails escape user-controlled copy", () => {
  const content = renderAccountActionEmail({
    eyebrow: "Invitation",
    title: "Join <script>alert(1)</script>",
    intro: "Welcome <strong>reviewer</strong>",
    actionLabel: "Accept",
    actionUrl: "https://example.com/action?first=1&second=2",
    expiryLabel: "Expires soon",
  });

  assert.doesNotMatch(content.html, /<script>/);
  assert.doesNotMatch(content.html, /<strong>reviewer/);
  assert.match(content.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(content.html, /first=1&amp;second=2/);
});
