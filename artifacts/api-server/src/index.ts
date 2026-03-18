import app from "./app";
import { pool } from "@workspace/db";
import logger from "./lib/logger";
import { env } from "./env";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const requiredEnvVars = [
  "SUPABASE_DATABASE_URL",
  "SUPABASE_SERVICE_ROLE",
];

const optionalButWarnEnvVars = [
  { key: "SENDGRID_API_KEY", feature: "email sending" },
  { key: "SENDGRID_INBOUND_PARSE_TOKEN", feature: "SendGrid inbound parse webhook" },
];

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Required environment variable ${key} is not set.`);
  }
}

for (const { key, feature } of optionalButWarnEnvVars) {
  if (!process.env[key]) {
    logger.warn(`${key} is not set — ${feature} will not work.`);
  }
}

logger.info({ carrierAuditModel: env.OPENAI_CARRIER_AUDIT_MODEL }, "Carrier audit model configured");

const server = app.listen(port, () => {
  logger.info({ port }, `Server listening on port ${port}`);
});

function gracefulShutdown(signal: string) {
  logger.info({ signal }, `Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    logger.info("HTTP server closed.");
    try {
      await pool.end();
      logger.info("Database pool closed.");
    } catch (err) {
      logger.error({ err }, "Error closing DB pool");
    }
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 30000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
