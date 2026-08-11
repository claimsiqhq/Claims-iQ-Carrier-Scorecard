import logger from "./lib/logger";
import { env, validateStorageEnvironment } from "./env";

const requiredEnvVars = [
  "GEMINI_API_KEY",
] as const;

async function main(): Promise<void> {
  const missing = requiredEnvVars.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
  validateStorageEnvironment();

  const [{ closeRuntimePools }, { startDurableWorker, stopDurableWorker }] =
    await Promise.all([
      import("@workspace/db"),
      import("./services/processingWorker"),
    ]);

  logger.info(
    { provider: "gemini", model: env.GEMINI_MODEL },
    "Starting Complete iQ processing worker",
  );
  startDurableWorker();

  let shuttingDown = false;
  async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Stopping Complete iQ processing worker");

    try {
      await stopDurableWorker();
      await closeRuntimePools();
      logger.info("Complete iQ processing worker stopped");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Complete iQ processing worker shutdown failed");
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => {
    void gracefulShutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void gracefulShutdown("SIGINT");
  });
}

void main().catch((err) => {
  logger.fatal({ err }, "Processing worker startup failed");
  process.exitCode = 1;
});
