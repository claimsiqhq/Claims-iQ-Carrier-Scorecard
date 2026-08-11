import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import {
  createEmailInboundRouter,
  isInboundSignatureTimestampFresh,
  type InboundEmailRoute,
  type InboundRouteDeps,
} from "./routes/emailInbound";

const ORGANIZATION_A = "00000000-0000-4000-8000-000000000001";
const ORGANIZATION_B = "00000000-0000-4000-8000-000000000002";
const ROUTE_KEY = "tenant_a_route_key_1234";
const RECIPIENT_A = "claims-a@inbound.example.com";

const routeA: InboundEmailRoute = {
  routeId: "10000000-0000-4000-8000-000000000001",
  organizationId: ORGANIZATION_A,
  recipientAddress: RECIPIENT_A,
  providerPublicKey: "test-public-key",
};

function dependencies(
  overrides: Partial<InboundRouteDeps> = {},
): InboundRouteDeps {
  return {
    resolveRoute: async () => routeA,
    verifyProviderSignature: () => true,
    authorizeSender: async () => ({
      organizationId: ORGANIZATION_A,
      userId: "member-a",
      authVersion: 1,
    }),
    persistAndEnqueue: async () => ({
      duplicate: false,
      claimId: "20000000-0000-4000-8000-000000000001",
      documentId: "30000000-0000-4000-8000-000000000001",
      jobId: "40000000-0000-4000-8000-000000000001",
    }),
    ...overrides,
  };
}

function application(deps: InboundRouteDeps) {
  const app = express();
  app.use(createEmailInboundRouter(deps));
  return app;
}

function validRequest(app: express.Express) {
  return request(app)
    .post(`/email/inbound/${ROUTE_KEY}`)
    .set("x-inbound-token", "tenant-secret-a")
    .set("x-twilio-email-event-webhook-signature", "test-signature")
    .set(
      "x-twilio-email-event-webhook-timestamp",
      String(Math.floor(Date.now() / 1000)),
    )
    .field("to", RECIPIENT_A)
    .field("from", "Authorized Member <member-a@example.com>")
    .field("headers", "Message-ID: <message-1@example.com>")
    .field("subject", "Inbound scorecard review")
    .field("text", "Final report body text for durable processing.");
}

test("inbound email requires a tenant token and provider signature", async () => {
  let resolveCalls = 0;
  const app = application(dependencies({
    resolveRoute: async () => {
      resolveCalls += 1;
      return routeA;
    },
  }));

  const missingToken = await request(app)
    .post(`/email/inbound/${ROUTE_KEY}`)
    .field("to", RECIPIENT_A);
  assert.equal(missingToken.status, 401);
  assert.equal(resolveCalls, 0);

  const missingSignature = await request(app)
    .post(`/email/inbound/${ROUTE_KEY}`)
    .set("x-inbound-token", "tenant-secret-a")
    .field("to", RECIPIENT_A);
  assert.equal(missingSignature.status, 401);
  assert.equal(resolveCalls, 1);
});

test("provider signature timestamps reject stale, future, and malformed replay windows", () => {
  const now = 2_000_000_000;
  const maximumAge = 300;
  assert.equal(
    isInboundSignatureTimestampFresh(String(now - maximumAge), now, maximumAge),
    true,
  );
  assert.equal(
    isInboundSignatureTimestampFresh(
      String(now - maximumAge - 1),
      now,
      maximumAge,
    ),
    false,
  );
  assert.equal(
    isInboundSignatureTimestampFresh(
      String(now + maximumAge + 1),
      now,
      maximumAge,
    ),
    false,
  );
  assert.equal(
    isInboundSignatureTimestampFresh("not-a-timestamp", now, maximumAge),
    false,
  );
  assert.equal(
    isInboundSignatureTimestampFresh(`${now}.5`, now, maximumAge),
    false,
  );
});

test("inbound email rejects forged and multi-tenant recipients", async () => {
  let authorizeCalls = 0;
  const app = application(dependencies({
    authorizeSender: async () => {
      authorizeCalls += 1;
      return {
        organizationId: ORGANIZATION_A,
        userId: "member-a",
        authVersion: 1,
      };
    },
  }));

  const forged = await request(app)
    .post(`/email/inbound/${ROUTE_KEY}`)
    .set("x-inbound-token", "tenant-secret-a")
    .set("x-twilio-email-event-webhook-signature", "test-signature")
    .set("x-twilio-email-event-webhook-timestamp", "1")
    .field("to", "claims-b@inbound.example.com")
    .field("from", "member-a@example.com")
    .field("headers", "Message-ID: <forged-recipient@example.com>")
    .field("text", "Forged recipient content.");
  assert.equal(forged.status, 403);

  const multiple = await request(app)
    .post(`/email/inbound/${ROUTE_KEY}`)
    .set("x-inbound-token", "tenant-secret-a")
    .set("x-twilio-email-event-webhook-signature", "test-signature")
    .set("x-twilio-email-event-webhook-timestamp", "1")
    .field("to", `${RECIPIENT_A}, claims-b@inbound.example.com`)
    .field("from", "member-a@example.com")
    .field("headers", "Message-ID: <multi-recipient@example.com>")
    .field("text", "Multi-recipient content.");
  assert.equal(multiple.status, 403);

  const ambiguousEnvelope = await request(app)
    .post(`/email/inbound/${ROUTE_KEY}`)
    .set("x-inbound-token", "tenant-secret-a")
    .set("x-twilio-email-event-webhook-signature", "test-signature")
    .set("x-twilio-email-event-webhook-timestamp", "1")
    .field("to", RECIPIENT_A)
    .field("envelope", JSON.stringify({
      to: [RECIPIENT_A, "claims-b@inbound.example.com"],
    }))
    .field("from", "member-a@example.com")
    .field("headers", "Message-ID: <ambiguous-envelope@example.com>")
    .field("text", "Ambiguous envelope content.");
  assert.equal(ambiguousEnvelope.status, 403);
  assert.equal(authorizeCalls, 0);
});

test("inbound email rejects an unauthorized sender", async () => {
  let enqueueCalls = 0;
  const app = application(dependencies({
    authorizeSender: async () => null,
    persistAndEnqueue: async () => {
      enqueueCalls += 1;
      return { duplicate: false };
    },
  }));

  const response = await validRequest(app);
  assert.equal(response.status, 403);
  assert.equal(enqueueCalls, 0);
});

test("inbound email rejects sender spoofing and cross-tenant authorization", async () => {
  const observedSenders: string[] = [];
  let enqueueCalls = 0;
  const app = application(dependencies({
    authorizeSender: async ({ senderEmail }) => {
      observedSenders.push(senderEmail);
      if (senderEmail === "member-a@example.com") {
        return {
          organizationId: ORGANIZATION_B,
          userId: "foreign-member",
          authVersion: 1,
        };
      }
      return null;
    },
    persistAndEnqueue: async () => {
      enqueueCalls += 1;
      return { duplicate: false };
    },
  }));

  const displayNameSpoof = await request(app)
    .post(`/email/inbound/${ROUTE_KEY}`)
    .set("x-inbound-token", "tenant-secret-a")
    .set("x-twilio-email-event-webhook-signature", "test-signature")
    .set("x-twilio-email-event-webhook-timestamp", "1")
    .field("to", RECIPIENT_A)
    .field("from", "member-a@example.com <attacker@example.com>")
    .field("headers", "Message-ID: <spoofed-sender@example.com>")
    .field("text", "Spoofed sender content.");
  assert.equal(displayNameSpoof.status, 400);

  const unauthorized = await request(app)
    .post(`/email/inbound/${ROUTE_KEY}`)
    .set("x-inbound-token", "tenant-secret-a")
    .set("x-twilio-email-event-webhook-signature", "test-signature")
    .set("x-twilio-email-event-webhook-timestamp", "1")
    .field("to", RECIPIENT_A)
    .field("from", "Authorized Member <attacker@example.com>")
    .field("headers", "Message-ID: <unauthorized-sender@example.com>")
    .field("text", "Unauthorized sender content.");
  assert.equal(unauthorized.status, 403);

  const foreignMembership = await validRequest(app);
  assert.equal(foreignMembership.status, 403);
  assert.deepEqual(observedSenders, [
    "attacker@example.com",
    "member-a@example.com",
  ]);
  assert.equal(enqueueCalls, 0);
});

test("inbound email rejects duplicate provider-message replay", async () => {
  const seen = new Set<string>();
  const app = application(dependencies({
    persistAndEnqueue: async ({ providerMessageId }) => {
      if (seen.has(providerMessageId)) return { duplicate: true };
      seen.add(providerMessageId);
      return {
        duplicate: false,
        claimId: "20000000-0000-4000-8000-000000000001",
        documentId: "30000000-0000-4000-8000-000000000001",
        jobId: "40000000-0000-4000-8000-000000000001",
      };
    },
  }));

  const first = await validRequest(app);
  const replay = await validRequest(app);
  assert.equal(first.status, 202);
  assert.equal(replay.status, 409);
  assert.match(replay.text, /duplicate/i);
  assert.deepEqual([...seen], ["<message-1@example.com>"]);
});

test("inbound email rejects ambiguous provider message IDs before enqueue", async () => {
  let enqueueCalls = 0;
  const app = application(dependencies({
    persistAndEnqueue: async () => {
      enqueueCalls += 1;
      return { duplicate: false };
    },
  }));

  const response = await request(app)
    .post(`/email/inbound/${ROUTE_KEY}`)
    .set("x-inbound-token", "tenant-secret-a")
    .set("x-twilio-email-event-webhook-signature", "test-signature")
    .set("x-twilio-email-event-webhook-timestamp", "1")
    .field("to", RECIPIENT_A)
    .field("from", "member-a@example.com")
    .field("message_id", "<message-field@example.com>")
    .field("headers", "Message-ID: <message-header@example.com>")
    .field("text", "Conflicting provider identifiers.");
  assert.equal(response.status, 400);
  assert.equal(enqueueCalls, 0);
});

test("inbound email routes deterministically from recipient route", async () => {
  let observed:
    | {
        routeKey: string;
        webhookSecret: string;
        organizationId: string;
        recipientAddress: string;
      }
    | undefined;
  const app = application(dependencies({
    resolveRoute: async (input) => {
      observed = {
        ...input,
        organizationId: "",
        recipientAddress: "",
      };
      return routeA;
    },
    persistAndEnqueue: async (input) => {
      observed = {
        routeKey: observed!.routeKey,
        webhookSecret: observed!.webhookSecret,
        organizationId: input.route.organizationId,
        recipientAddress: input.recipientAddress,
      };
      return {
        duplicate: false,
        claimId: "20000000-0000-4000-8000-000000000001",
        documentId: "30000000-0000-4000-8000-000000000001",
        jobId: "40000000-0000-4000-8000-000000000001",
      };
    },
  }));

  const response = await validRequest(app);
  assert.equal(response.status, 202);
  assert.deepEqual(observed, {
    routeKey: ROUTE_KEY,
    webhookSecret: "tenant-secret-a",
    organizationId: ORGANIZATION_A,
    recipientAddress: RECIPIENT_A,
  });
});

test("inbound email does not acknowledge before durable enqueue", async () => {
  let resolveEnqueue:
    | ((value: {
        duplicate: false;
        claimId: string;
        documentId: string;
        jobId: string;
      }) => void)
    | undefined;
  const durable = new Promise<{
    duplicate: false;
    claimId: string;
    documentId: string;
    jobId: string;
  }>((resolve) => {
    resolveEnqueue = resolve;
  });
  const app = application(dependencies({
    persistAndEnqueue: async () => durable,
  }));

  let acknowledged = false;
  const responsePromise = validRequest(app).then((response) => {
    acknowledged = true;
    return response;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(acknowledged, false);

  resolveEnqueue!({
    duplicate: false,
    claimId: "20000000-0000-4000-8000-000000000001",
    documentId: "30000000-0000-4000-8000-000000000001",
    jobId: "40000000-0000-4000-8000-000000000001",
  });
  const response = await responsePromise;
  assert.equal(response.status, 202);
  assert.equal(acknowledged, true);
});

test("inbound email returns no 2xx when durable enqueue fails", async () => {
  const app = application(dependencies({
    persistAndEnqueue: async () => {
      throw new Error("synthetic durable transaction failure");
    },
  }));

  const response = await validRequest(app);
  assert.equal(response.status, 503);
  assert.equal(response.status >= 200 && response.status < 300, false);
  assert.match(response.text, /not queued/i);
});
