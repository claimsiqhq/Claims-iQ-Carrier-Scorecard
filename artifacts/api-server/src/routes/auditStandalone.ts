import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import { requireAuth } from "../middlewares/requireAuth";
import logger from "../lib/logger";
import {
  carrierScorecardNormalizedSchema,
  runCarrierScorecardAudit,
} from "../services/carrierScorecardAudit";
import { sendCarrierScorecardEmail } from "../services/email";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getRequestId(req: Request): string {
  const header = req.headers["x-request-id"];
  return typeof header === "string" && header.trim().length > 0 ? header : randomUUID();
}

async function extractStandaloneReportText(req: Request): Promise<string> {
  const bodyText = typeof req.body?.reportText === "string" ? req.body.reportText.trim() : "";
  if (bodyText.length > 0) return bodyText;

  const file = req.file;
  if (!file) return "";

  if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
    try {
      const parsed = await pdfParse(file.buffer);
      return parsed.text?.trim() ?? "";
    } catch {
      return "";
    }
  }

  return file.buffer.toString("utf-8").trim();
}

const router: IRouter = Router();

router.post("/audit/standalone", requireAuth, upload.single("file"), async (req, res) => {
  const requestId = getRequestId(req);

  try {
    const reportText = await extractStandaloneReportText(req);
    if (!reportText) {
      res.status(400).json({ error: "Provide reportText or upload one PDF file." });
      return;
    }

    const audit = await runCarrierScorecardAudit({
      reportText,
      requestId,
    });

    res.json(audit);
  } catch (err) {
    logger.error({ err, requestId }, "Standalone carrier audit route failed");
    res.status(500).json({ error: "Failed to run standalone carrier audit." });
  }
});

router.post("/audit/standalone/email", requireAuth, async (req, res) => {
  const requestId = getRequestId(req);

  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  const subject = typeof req.body?.subject === "string" && req.body.subject.trim().length > 0
    ? req.body.subject.trim()
    : "Carrier Scorecard Audit";

  if (!to || !EMAIL_RE.test(to)) {
    res.status(400).json({ error: "Valid recipient email is required." });
    return;
  }

  const parsedAudit = carrierScorecardNormalizedSchema.safeParse(req.body?.audit);
  if (!parsedAudit.success) {
    res.status(400).json({ error: "Invalid carrier scorecard payload." });
    return;
  }

  try {
    await sendCarrierScorecardEmail({
      to,
      subject,
      audit: parsedAudit.data,
    });
    logger.info({ requestId, sendgrid: "success" }, "Standalone carrier scorecard email sent");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, requestId, sendgrid: "failure" }, "Standalone carrier scorecard email failed");
    res.status(500).json({ error: "Failed to send carrier scorecard email." });
  }
});

export default router;
