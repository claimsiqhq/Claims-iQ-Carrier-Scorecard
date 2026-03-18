import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import logger from "../lib/logger";
import { runCarrierScorecardAudit, type CarrierScorecardAuditResult } from "../services/carrierScorecardAudit";
import { sendCarrierScorecardEmail } from "../services/email";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
});

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function getRequestId(req: Request): string {
  const header = req.headers["x-request-id"];
  return typeof header === "string" && header.trim().length > 0 ? header : randomUUID();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseSenderEmail(from: unknown): string | undefined {
  if (typeof from !== "string") return undefined;
  const match = from.match(EMAIL_RE);
  return match?.[0]?.toLowerCase();
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "***";
  const prefix = name.slice(0, 2);
  return `${prefix}***@${domain}`;
}

async function extractInboundReportText(req: Request): Promise<string> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const pdf = files.find((f) => {
    const mime = (f.mimetype || "").toLowerCase();
    return mime === "application/pdf" || f.originalname.toLowerCase().endsWith(".pdf");
  });

  if (pdf) {
    const parsed = await pdfParse(pdf.buffer);
    return parsed.text?.trim() ?? "";
  }

  const bodyText = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (bodyText.length > 0) return bodyText;

  const html = typeof req.body?.html === "string" ? req.body.html : "";
  return html ? stripHtml(html) : "";
}

interface InboundRouteDeps {
  runAudit: (input: { reportText: string; requestId: string }) => Promise<CarrierScorecardAuditResult>;
  sendAuditEmail: (input: { to: string; subject: string; audit: CarrierScorecardAuditResult }) => Promise<void>;
}

const defaultDeps: InboundRouteDeps = {
  runAudit: runCarrierScorecardAudit,
  sendAuditEmail: sendCarrierScorecardEmail,
};

export function createEmailInboundRouter(deps: InboundRouteDeps = defaultDeps): IRouter {
  const router: IRouter = Router();

  router.post("/email/inbound", upload.any(), async (req, res) => {
    const requestId = getRequestId(req);
    const expectedToken = process.env.SENDGRID_INBOUND_PARSE_TOKEN?.trim();
    const token = typeof req.query.token === "string" ? req.query.token : "";

    if (!expectedToken) {
      logger.warn({ requestId }, "Inbound parse disabled: token not configured");
      res.status(503).send("inbound parse not configured");
      return;
    }

    if (token !== expectedToken) {
      logger.warn({ requestId }, "Inbound parse rejected: invalid token");
      res.status(401).send("unauthorized");
      return;
    }

    const sender = parseSenderEmail(req.body?.from);
    const senderMasked = sender ? maskEmail(sender) : undefined;
    const subject = typeof req.body?.subject === "string" ? req.body.subject.slice(0, 120) : "Carrier Scorecard Audit";

    res.status(200).send("ok");

    setImmediate(async () => {
      try {
        if (!sender) {
          logger.error({ requestId, inbound_parse_processing: "failure" }, "Inbound parse missing sender");
          return;
        }

        const reportText = await extractInboundReportText(req);
        if (!reportText) {
          logger.error({
            requestId,
            inbound_parse_processing: "failure",
            sender: senderMasked,
          }, "Inbound parse missing report text");
          return;
        }

        const audit = await deps.runAudit({ reportText, requestId });
        await deps.sendAuditEmail({
          to: sender,
          subject: `Carrier Scorecard Audit Reply: ${subject}`,
          audit,
        });

        logger.info({
          requestId,
          inbound_parse_processing: "success",
          sendgrid: "success",
          sender: senderMasked,
          score_total: audit.overall.total_score,
          percent: audit.overall.percent,
          grade: audit.overall.grade,
        }, "Inbound parse processed and reply sent");
      } catch (err) {
        logger.error({
          err,
          requestId,
          inbound_parse_processing: "failure",
          sendgrid: "failure",
          sender: senderMasked,
        }, "Inbound parse processing failed");
      }
    });
  });

  return router;
}

export default createEmailInboundRouter();
