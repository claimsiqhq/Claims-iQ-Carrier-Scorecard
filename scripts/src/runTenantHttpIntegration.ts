import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const image =
  process.env.TENANT_INTEGRATION_POSTGRES_IMAGE ?? "postgres:16-alpine";
const password = `tenant-integration-${randomBytes(12).toString("hex")}`;
const database = "claims_iq_tenant_integration";
const containerName = `claims-iq-tenant-integration-${process.pid}`;

function run(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    capture?: boolean;
  } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let stdout = "";
    if (options.capture) {
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
        return;
      }
      reject(
        new Error(
          `${command} exited ${code ?? `from signal ${signal ?? "unknown"}`}`,
        ),
      );
    });
  });
}

async function waitForPostgres(databaseUrl: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
  }
  throw new Error("Disposable PostgreSQL did not become ready", {
    cause: lastError,
  });
}

async function runSuite(databaseUrl: string): Promise<void> {
  await run(
    "pnpm",
    ["--filter", "@workspace/api-server", "run", "test:tenant-integration"],
    {
      env: {
        ...process.env,
        TENANT_INTEGRATION_DATABASE_URL: databaseUrl,
        TENANT_INTEGRATION_ALLOW_RESET: "1",
      },
    },
  );
}

const suppliedDatabaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL?.trim();

if (suppliedDatabaseUrl) {
  await runSuite(suppliedDatabaseUrl);
} else {
  const dockerAvailable =
    spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
  if (!dockerAvailable) {
    throw new Error(
      "Docker is unavailable. Set TENANT_INTEGRATION_DATABASE_URL to a disposable PostgreSQL 16+ database.",
    );
  }

  let containerStarted = false;
  try {
    await run("docker", [
      "run",
      "--rm",
      "--detach",
      "--name",
      containerName,
      "--env",
      `POSTGRES_PASSWORD=${password}`,
      "--env",
      `POSTGRES_DB=${database}`,
      "--publish",
      "127.0.0.1::5432",
      image,
    ]);
    containerStarted = true;

    const portOutput = await run(
      "docker",
      ["port", containerName, "5432/tcp"],
      { capture: true },
    );
    const portMatch = portOutput.match(/:(\d+)\s*$/m);
    if (!portMatch?.[1]) {
      throw new Error(
        `Could not determine the Docker PostgreSQL port: ${portOutput}`,
      );
    }
    const databaseUrl =
      `postgresql://postgres:${encodeURIComponent(password)}` +
      `@127.0.0.1:${portMatch[1]}/${database}`;
    await waitForPostgres(databaseUrl);
    await runSuite(databaseUrl);
  } finally {
    if (containerStarted) {
      await run("docker", ["rm", "--force", containerName]).catch(
        () => undefined,
      );
    }
  }
}
