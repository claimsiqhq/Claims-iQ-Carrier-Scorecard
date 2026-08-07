import pino from "pino";

const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;

function sanitizeRequestPath(rawUrl: string | undefined): string {
  const path = (rawUrl ?? "").split("?")[0] ?? "";
  if (/\/storage\/(?:download|signed-url)\//.test(path)) {
    return path.replace(
      /(\/storage\/(?:download|signed-url))\/.*/,
      "$1/:authorized-path",
    );
  }
  return path.replace(UUID_SEGMENT, "/:id");
}

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "development"
    ? { target: "pino/file", options: { destination: 1 } }
    : undefined,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "email",
      "insuredName",
      "propertyAddress",
      "policyNumber",
      "claimId",
      "documentId",
      "userId",
      "organizationId",
      "fileName",
      "file_name",
      "storagePath",
      "storage_path",
      "contentPreview",
      "reportText",
      "extractedText",
      "*.password",
      "*.email",
      "*.insuredName",
      "*.propertyAddress",
      "*.policyNumber",
      "*.claimId",
      "*.documentId",
      "*.userId",
      "*.organizationId",
      "*.fileName",
      "*.file_name",
      "*.storagePath",
      "*.storage_path",
      "*.contentPreview",
      "*.reportText",
      "*.extractedText",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      path: sanitizeRequestPath(req.url),
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});

export default logger;
