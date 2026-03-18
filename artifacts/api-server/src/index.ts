import app from "./app";
import { pool } from "@workspace/db";

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
];

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Required environment variable ${key} is not set.`);
  }
}

for (const { key, feature } of optionalButWarnEnvVars) {
  if (!process.env[key]) {
    console.warn(`WARNING: ${key} is not set — ${feature} will not work.`);
  }
}

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    console.log("HTTP server closed.");
    try {
      await pool.end();
      console.log("Database pool closed.");
    } catch (err) {
      console.error("Error closing DB pool:", err);
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 30000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
