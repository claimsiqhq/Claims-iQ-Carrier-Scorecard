import logger from "./lib/logger";
import { env, validateStorageEnvironment } from "./env";

const requiredEnvVars = [
  "GEMINI_API_KEY",
] as const;

const optionalButWarnEnvVars = [
  { key: "SENDGRID_API_KEY", feature: "email sending" },
  { key: "SENDGRID_FROM_EMAIL", feature: "email sending" },
] as const;

function validateStartupEnvironment(): number {
  const rawPort = process.env.PORT?.trim();
  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const missing = requiredEnvVars.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
  validateStorageEnvironment();

  return port;
}

async function main(): Promise<void> {
  const port = validateStartupEnvironment();

  for (const { key, feature } of optionalButWarnEnvVars) {
    if (!process.env[key]?.trim()) {
      logger.warn(`${key} is not set — ${feature} will not work.`);
    }
  }

  // Load modules with environment-sensitive initialization only after validation.
  // This keeps Render startup failures concise and names every missing variable.
  const [
    { default: app },
    { closeRuntimePools },
    { startDurableWorker, stopDurableWorker },
  ] = await Promise.all([
    import("./app"),
    import("@workspace/db"),
    import("./services/processingWorker"),
  ]);

  logger.info(
    { provider: "gemini", model: env.GEMINI_MODEL },
    "AI provider configured",
  );

  const server = app.listen(port, "0.0.0.0", () => {
    logger.info({ host: "0.0.0.0", port }, "Server listening");
    if (process.env.DURABLE_WORKER_ENABLED !== "false") {
      startDurableWorker();
    }
  });

  let shuttingDown = false;
  function gracefulShutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down API server");

    const forceShutdownTimer = setTimeout(() => {
      logger.error("Forced shutdown after timeout.");
      process.exit(1);
    }, 30_000);

    server.close(async (serverError) => {
      if (serverError) {
        logger.error({ err: serverError }, "HTTP server shutdown failed");
      } else {
        logger.info("HTTP server closed.");
      }

      try {
        await stopDurableWorker();
        logger.info("Durable worker stopped.");
        await closeRuntimePools();
        logger.info("Database pools closed.");
        clearTimeout(forceShutdownTimer);
        process.exit(serverError ? 1 : 0);
      } catch (err) {
        logger.error({ err }, "API server shutdown failed");
        clearTimeout(forceShutdownTimer);
        process.exit(1);
      }
    });
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

void main().catch((err) => {
  logger.fatal({ err }, "API startup failed");
  process.exitCode = 1;
});
