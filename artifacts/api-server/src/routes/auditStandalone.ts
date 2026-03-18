import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth";
import logger from "../lib/logger";
import {
  carrierScorecardNormalizedSchema,
  runCarrierScorecardAudit,
} from "../services/carrierScorecardAudit";
import { sendCarrierScorecardEmail } from "../services/email";
import { extractAndPersistFinalReport } from "../services/finalReportIngestion";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getRequestId(req: Request): string {
  const header = req.headers["x-request-id"];
  return typeof header === "string" && header.trim().length > 0 ? header : randomUUID();
}

const router: IRouter = Router();

router.post("/audit/standalone", requireAuth, upload.single("file"), async (req, res) => {
  const requestId = getRequestId(req);

  try {
    let persisted;
    try {
      persisted = await extractAndPersistFinalReport({
        source: "standalone_ui",
        requestId,
        uploaderUserId: req.user?.id,
        file: req.file ?? undefined,
        reportText: typeof req.body?.reportText === "string" ? req.body.reportText : undefined,
      });
    } catch (extractErr) {
      const reason = extractErr instanceof Error ? extractErr.message : "Vision extraction failed";
      logger.error({ err: extractErr, requestId }, "Standalone extraction failed");
      res.status(422).json({ error: `Could not extract text from the PDF using Vision extraction: ${reason}` });
      return;
    }

    const reportText = persisted.reportText;
    if (!reportText) {
      res.status(400).json({ error: "Provide reportText or upload one PDF file." });
      return;
    }

    logger.info({
      requestId,
      extraction_method: persisted.extractionMethod,
      report_chars: reportText.length,
      document_id: persisted.documentId,
      storage_path: persisted.storagePath,
    }, "Extraction complete; starting carrier scorecard audit");

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
