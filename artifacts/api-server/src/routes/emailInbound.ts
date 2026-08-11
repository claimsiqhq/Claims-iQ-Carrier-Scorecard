import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createRequire } from "node:module";
import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { eq, sql } from "drizzle-orm";
import {
  acquireTenantDatabase,
  claimActivity,
  claims,
  documents,
  identityDb,
  processingJobs,
  sessionsTable,
  type WorkspaceDatabase,
} from "@workspace/db";
import { storedSessionId } from "../lib/auth";
import {
  createTenantStorageCapability,
  type CanonicalDocumentReference,
  type TenantStorageCapability,
} from "../lib/supabaseStorage";
import { env } from "../env";
import logger from "../lib/logger";

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_RAW_BODY_BYTES = 20 * 1024 * 1024;
const ROUTE_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;
const EMAIL_RE = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 4 },
});

type RawInboundRequest = Request & {
  rawInboundBody?: Buffer;
  inboundBodyTooLarge?: boolean;
};

export interface InboundEmailRoute {
  routeId: string;
  organizationId: string;
  recipientAddress: string;
  providerPublicKey: string;
}

export interface AuthorizedInboundSender {
  organizationId: string;
  userId: string;
  authVersion: number;
}

export interface DurableInboundResult {
  duplicate: boolean;
  claimId?: string;
  documentId?: string;
  jobId?: string;
}

export interface DurableInboundInput {
  route: InboundEmailRoute;
  sender: AuthorizedInboundSender;
  providerMessageId: string;
  senderEmail: string;
  recipientAddress: string;
  subject: string;
  source: {
    fileName: string;
    contentType: string;
    body: Buffer;
  };
}

export interface InboundRouteDeps {
  resolveRoute(input: {
    routeKey: string;
    webhookSecret: string;
  }): Promise<InboundEmailRoute | null>;
  verifyProviderSignature(input: {
    publicKey: string;
    rawBody: Buffer;
    signature: string;
    timestamp: string;
  }): boolean | Promise<boolean>;
  authorizeSender(input: {
    routeId: string;
    senderEmail: string;
  }): Promise<AuthorizedInboundSender | null>;
  persistAndEnqueue(input: DurableInboundInput): Promise<DurableInboundResult>;
}

function rowsFromResult<Row>(result: unknown): Row[] {
  const rows = (result as { rows?: Row[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

export function hashInboundRouteSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function getRequestId(req: Request): string {
  const header = req.headers["x-request-id"];
  return typeof header === "string" && header.trim()
    ? header.trim().slice(0, 200)
    : randomUUID();
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractEmails(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...value.matchAll(EMAIL_RE)].map((match) => match[0]!.toLowerCase());
}

function uniqueEmails(values: unknown[]): string[] {
  return [...new Set(values.flatMap(extractEmails))];
}

function envelopeRecipients(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as { to?: unknown };
    if (Array.isArray(parsed.to)) {
      return uniqueEmails(parsed.to);
    }
    return extractEmails(parsed.to);
  } catch {
    return [];
  }
}

export function deterministicRecipientAddresses(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const fields = body as Record<string, unknown>;
  return [
    ...new Set([
      ...extractEmails(fields.to),
      ...envelopeRecipients(fields.envelope),
    ]),
  ];
}

export function providerMessageIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;
  const candidates: string[] = [];
  for (const key of ["message_id", "message-id"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) {
      candidates.push(value.trim());
    }
  }
  if (typeof fields.headers === "string") {
    for (const match of fields.headers.matchAll(/^Message-ID:\s*(.+)$/gim)) {
      if (match[1]?.trim()) candidates.push(match[1].trim());
    }
  }
  const unique = [...new Set(candidates)];
  if (
    unique.length !== 1
    || unique[0]!.length > 998
    || /[\u0000-\u001f\u007f]/.test(unique[0]!)
  ) {
    return null;
  }
  return unique[0]!;
}

function captureRawInboundBody(
  req: RawInboundRequest,
  _res: Response,
  next: NextFunction,
): void {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  req.on("data", (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.length;
    if (byteLength <= MAX_RAW_BODY_BYTES) chunks.push(buffer);
    else req.inboundBodyTooLarge = true;
  });
  req.on("end", () => {
    if (!req.inboundBodyTooLarge) {
      req.rawInboundBody = Buffer.concat(chunks);
    }
  });
  next();
}

function webhookSecret(req: Request): string | null {
  const header = req.headers["x-inbound-token"];
  const query = typeof req.query.token === "string" ? req.query.token : undefined;
  const values = [typeof header === "string" ? header : undefined, query]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0]! : null;
}

type EventWebhookVerifier = {
  convertPublicKeyToECDSA(publicKey: string): unknown;
  verifySignature(
    publicKey: unknown,
    payload: Buffer,
    signature: string,
    timestamp: string,
  ): boolean;
};

type EventWebhookConstructor = new () => EventWebhookVerifier;

const require = createRequire(import.meta.url);

export function isInboundSignatureTimestampFresh(
  value: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  maximumAgeSeconds = env.SENDGRID_INBOUND_SIGNATURE_MAX_AGE_SECONDS,
): boolean {
  const timestamp = Number(value);
  return (
    Number.isInteger(timestamp)
    && Number.isInteger(nowSeconds)
    && Number.isInteger(maximumAgeSeconds)
    && maximumAgeSeconds >= 0
    && Math.abs(nowSeconds - timestamp) <= maximumAgeSeconds
  );
}

function verifySendGridSignature(input: {
  publicKey: string;
  rawBody: Buffer;
  signature: string;
  timestamp: string;
}): boolean {
  if (!isInboundSignatureTimestampFresh(input.timestamp)) {
    return false;
  }
  try {
    const EventWebhook = (
      require("@sendgrid/eventwebhook") as {
        EventWebhook: EventWebhookConstructor;
      }
    ).EventWebhook;
    const verifier = new EventWebhook();
    const publicKey = verifier.convertPublicKeyToECDSA(input.publicKey);
    return verifier.verifySignature(
      publicKey,
      input.rawBody,
      input.signature,
      input.timestamp,
    );
  } catch {
    return false;
  }
}

async function resolveDatabaseRoute(input: {
  routeKey: string;
  webhookSecret: string;
}): Promise<InboundEmailRoute | null> {
  const result = await identityDb.execute(sql`
    SELECT
      route_id,
      organization_id,
      recipient_address,
      provider_public_key
    FROM private.resolve_inbound_email_route(
      ${hashInboundRouteSecret(input.routeKey)},
      ${hashInboundRouteSecret(input.webhookSecret)}
    )
  `);
  const row = rowsFromResult<{
    route_id: string;
    organization_id: string;
    recipient_address: string;
    provider_public_key: string;
  }>(result)[0];
  return row
    ? {
        routeId: row.route_id,
        organizationId: row.organization_id,
        recipientAddress: row.recipient_address,
        providerPublicKey: row.provider_public_key,
      }
    : null;
}

async function authorizeDatabaseSender(input: {
  routeId: string;
  senderEmail: string;
}): Promise<AuthorizedInboundSender | null> {
  const result = await identityDb.execute(sql`
    SELECT organization_id, user_id, auth_version
    FROM private.authorize_inbound_email_sender(
      ${input.routeId}::uuid,
      ${input.senderEmail}
    )
  `);
  const row = rowsFromResult<{
    organization_id: string;
    user_id: string;
    auth_version: number;
  }>(result)[0];
  return row
    ? {
        organizationId: row.organization_id,
        userId: row.user_id,
        authVersion: Number(row.auth_version),
      }
    : null;
}

async function createOneTimeInboundSession(input: {
  userId: string;
  authVersion: number;
  routeId: string;
}): Promise<{ sessionId: string; expiresAt: Date }> {
  const sessionId = storedSessionId(randomBytes(32).toString("hex"));
  const expiresAt = new Date(
    Date.now() + env.INBOUND_EMAIL_SESSION_TTL_SECONDS * 1000,
  );
  await identityDb.insert(sessionsTable).values({
    sid: sessionId,
    sess: {
      purpose: "inbound_email",
      oneTime: true,
      routeId: input.routeId,
    },
    expire: expiresAt,
    userId: input.userId,
    authVersion: input.authVersion,
  });
  return { sessionId, expiresAt };
}

async function existingInboundDelivery(
  database: WorkspaceDatabase,
  routeId: string,
  providerMessageId: string,
): Promise<boolean> {
  const result = await database.execute(sql`
    SELECT id
    FROM public.inbound_email_deliveries
    WHERE route_id = ${routeId}::uuid
      AND provider_message_id = ${providerMessageId}
    LIMIT 1
  `);
  return rowsFromResult(result).length > 0;
}

async function enqueueWithTenantSession(
  input: DurableInboundInput,
  database: WorkspaceDatabase,
  storage: TenantStorageCapability,
): Promise<DurableInboundResult> {
  const claimId = randomUUID();
  const documentId = randomUUID();
  const jobId = randomUUID();
  const deliveryId = randomUUID();
  let uploadedReference: CanonicalDocumentReference | null = null;

  try {
    const result = await database.transaction(async (tx) => {
      if (
        await existingInboundDelivery(
          tx as WorkspaceDatabase,
          input.route.routeId,
          input.providerMessageId,
        )
      ) {
        return { duplicate: true } satisfies DurableInboundResult;
      }

      const storagePath = await storage.uploadDocument({
        claimId,
        documentId,
        fileName: input.source.fileName,
        contentType: input.source.contentType,
        body: input.source.body,
      });
      uploadedReference = { claimId, documentId, storagePath };
      if (!(await storage.documentExists(uploadedReference))) {
        throw new Error("Inbound source object could not be verified");
      }

      await tx.insert(claims).values({
        id: claimId,
        organizationId: input.route.organizationId,
        ownerUserId: input.sender.userId,
        claimNumber: `EML-${hashInboundRouteSecret(input.providerMessageId)
          .slice(0, 12)
          .toUpperCase()}`,
        insuredName: "Inbound email pending",
        status: "processing",
        systemStatus: "processing",
        aiStatus: "queued",
        humanReviewStatus: "unassigned",
      });
      await tx.insert(documents).values({
        id: documentId,
        organizationId: input.route.organizationId,
        claimId,
        uploadedByUserId: input.sender.userId,
        type: "claim_file",
        fileUrl: storagePath,
        metadata: {
          organizationId: input.route.organizationId,
          claimId,
          documentId,
          storagePath,
          fileName: input.source.fileName,
          contentType: input.source.contentType,
          size: input.source.body.length,
          source: "sendgrid_inbound",
          senderEmail: input.senderEmail,
          recipientAddress: input.recipientAddress,
          providerMessageId: input.providerMessageId,
        },
      });
      await tx.insert(processingJobs).values({
        id: jobId,
        organizationId: input.route.organizationId,
        claimId,
        documentId,
        requestedByUserId: input.sender.userId,
        type: "ingest",
        status: "queued",
        stage: "uploaded",
        progress: 0,
        idempotencyKey:
          `inbound:${input.route.routeId}:`
          + hashInboundRouteSecret(input.providerMessageId),
        payload: {
          source: "sendgrid_inbound",
          inboundDeliveryId: deliveryId,
          senderEmail: input.senderEmail,
          recipientAddress: input.recipientAddress,
          subject: input.subject,
        },
      });
      await tx.insert(claimActivity).values({
        organizationId: input.route.organizationId,
        claimId,
        actorUserId: input.sender.userId,
        activityType: "inbound_email_queued",
        metadata: {
          documentId,
          processingJobId: jobId,
          inboundDeliveryId: deliveryId,
        },
      });
      await tx.execute(sql`
        INSERT INTO public.inbound_email_deliveries (
          id,
          organization_id,
          route_id,
          provider_message_id,
          sender_email,
          recipient_address,
          requested_by_user_id,
          claim_id,
          document_id,
          processing_job_id,
          status,
          subject
        )
        VALUES (
          ${deliveryId}::uuid,
          ${input.route.organizationId}::uuid,
          ${input.route.routeId}::uuid,
          ${input.providerMessageId},
          ${input.senderEmail},
          ${input.recipientAddress},
          ${input.sender.userId},
          ${claimId}::uuid,
          ${documentId}::uuid,
          ${jobId}::uuid,
          'queued',
          ${input.subject}
        )
      `);
      return {
        duplicate: false,
        claimId,
        documentId,
        jobId,
      } satisfies DurableInboundResult;
    });
    if (!result.duplicate) uploadedReference = null;
    return result;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (
      code === "23505"
      && await existingInboundDelivery(
        database,
        input.route.routeId,
        input.providerMessageId,
      )
    ) {
      return { duplicate: true };
    }
    throw error;
  } finally {
    if (uploadedReference) {
      await storage.deleteDocument(uploadedReference).catch((cleanupError) => {
        logger.error(
          {
            errorName:
              cleanupError instanceof Error
                ? cleanupError.name
                : "UnknownError",
          },
          "Failed to clean up unqueued inbound object",
        );
      });
    }
  }
}

async function persistAndEnqueueDatabaseInbound(
  input: DurableInboundInput,
): Promise<DurableInboundResult> {
  const session = await createOneTimeInboundSession({
    userId: input.sender.userId,
    authVersion: input.sender.authVersion,
    routeId: input.route.routeId,
  });
  let lease:
    | Awaited<ReturnType<typeof acquireTenantDatabase>>
    | undefined;
  try {
    lease = await acquireTenantDatabase({
      userId: input.sender.userId,
      sessionId: session.sessionId,
      organizationId: input.route.organizationId,
    });
    const storage = createTenantStorageCapability({
      organizationId: input.route.organizationId,
      userId: input.sender.userId,
      sessionId: session.sessionId,
      maxExpiresAt: session.expiresAt,
    });
    return await enqueueWithTenantSession(
      input,
      lease.database,
      storage,
    );
  } finally {
    try {
      await lease?.release();
    } finally {
      await identityDb
        .delete(sessionsTable)
        .where(eq(sessionsTable.sid, session.sessionId));
    }
  }
}

const defaultDeps: InboundRouteDeps = {
  resolveRoute: resolveDatabaseRoute,
  verifyProviderSignature: verifySendGridSignature,
  authorizeSender: authorizeDatabaseSender,
  persistAndEnqueue: persistAndEnqueueDatabaseInbound,
};

function inboundSource(req: Request): DurableInboundInput["source"] | null {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const pdf = files.find((file) => {
    const mime = (file.mimetype || "").toLowerCase();
    return (
      mime === "application/pdf"
      || file.originalname.toLowerCase().endsWith(".pdf")
    );
  });
  if (pdf) {
    return {
      fileName: pdf.originalname || "inbound-report.pdf",
      contentType: "application/pdf",
      body: pdf.buffer,
    };
  }

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const html = typeof req.body?.html === "string" ? req.body.html : "";
  const fallback = text || (html ? stripHtml(html) : "");
  return fallback
    ? {
        fileName: "inbound-report.txt",
        contentType: "text/plain; charset=utf-8",
        body: Buffer.from(fallback, "utf8"),
      }
    : null;
}

export function createEmailInboundRouter(
  deps: InboundRouteDeps = defaultDeps,
): IRouter {
  const router: IRouter = Router();

  router.post(
    "/email/inbound/:routeKey",
    captureRawInboundBody,
    upload.any(),
    async (req: RawInboundRequest, res) => {
      const requestId = getRequestId(req);
      const routeKey = Array.isArray(req.params.routeKey)
        ? req.params.routeKey[0] ?? ""
        : req.params.routeKey ?? "";
      const secret = webhookSecret(req);

      try {
        if (!ROUTE_KEY_RE.test(routeKey) || !secret) {
          res.status(401).send("unauthorized");
          return;
        }
        if (req.inboundBodyTooLarge || !req.rawInboundBody) {
          res.status(413).send("inbound payload too large");
          return;
        }

        const route = await deps.resolveRoute({
          routeKey,
          webhookSecret: secret,
        });
        if (!route) {
          res.status(401).send("unauthorized");
          return;
        }

        const recipients = deterministicRecipientAddresses(req.body);
        if (
          recipients.length !== 1
          || recipients[0] !== route.recipientAddress
        ) {
          res.status(403).send("recipient route mismatch");
          return;
        }

        const signature = req.headers[
          "x-twilio-email-event-webhook-signature"
        ];
        const timestamp = req.headers[
          "x-twilio-email-event-webhook-timestamp"
        ];
        if (typeof signature !== "string" || typeof timestamp !== "string") {
          res.status(401).send("missing provider signature");
          return;
        }
        const verified = await deps.verifyProviderSignature({
          publicKey: route.providerPublicKey,
          rawBody: req.rawInboundBody,
          signature,
          timestamp,
        });
        if (!verified) {
          res.status(401).send("invalid provider signature");
          return;
        }

        const senders = uniqueEmails([req.body?.from]);
        const providerMessageId = providerMessageIdFromBody(req.body);
        const source = inboundSource(req);
        if (senders.length !== 1 || !providerMessageId || !source) {
          res.status(400).send("invalid inbound message");
          return;
        }
        const senderEmail = senders[0]!;
        const sender = await deps.authorizeSender({
          routeId: route.routeId,
          senderEmail,
        });
        if (
          !sender
          || sender.organizationId !== route.organizationId
        ) {
          res.status(403).send("sender is not authorized for ingestion");
          return;
        }

        const subject =
          typeof req.body?.subject === "string"
            ? req.body.subject.trim().slice(0, 500)
            : "";
        const durable = await deps.persistAndEnqueue({
          route,
          sender,
          providerMessageId,
          senderEmail,
          recipientAddress: recipients[0]!,
          subject,
          source,
        });
        if (durable.duplicate) {
          res.status(409).json({ error: "duplicate provider message" });
          return;
        }

        logger.info(
          {
            requestId,
            routeId: route.routeId,
            organizationId: route.organizationId,
            sender: maskEmail(senderEmail),
            claimId: durable.claimId,
            documentId: durable.documentId,
            jobId: durable.jobId,
            inbound_parse_processing: "queued",
          },
          "Inbound email durably queued",
        );
        res.status(202).json({
          accepted: true,
          claimId: durable.claimId,
          jobId: durable.jobId,
        });
      } catch (error) {
        logger.error(
          {
            requestId,
            errorName: error instanceof Error ? error.name : "UnknownError",
            inbound_parse_processing: "failure",
          },
          "Inbound email authentication or durable enqueue failed",
        );
        res.status(503).send("inbound email was not queued");
      }
    },
  );

  return router;
}

export default createEmailInboundRouter();
