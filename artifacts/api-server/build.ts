import path from "path";
import { fileURLToPath } from "url";
import { build as esbuild } from "esbuild";
import { rm, readFile } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times without risking some
// packages that are not bundle compatible
const allowlist = [
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  const distDir = path.resolve(__dirname, "dist");
  await rm(distDir, { recursive: true, force: true });

  console.log("building API, worker, and migration entrypoints...");
  const pkgPath = path.resolve(__dirname, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter(
    (dep) =>
      !allowlist.includes(dep) &&
      !pkg.dependencies?.[dep]?.startsWith("workspace:"),
  );

  await esbuild({
    entryPoints: {
      index: path.resolve(__dirname, "src/index.ts"),
      worker: path.resolve(__dirname, "src/worker.ts"),
      migrate: path.resolve(__dirname, "src/migrate.ts"),
      "migrate-carrier-tenant-storage": path.resolve(
        __dirname,
        "src/migrateCarrierTenantStorage.ts",
      ),
    },
    platform: "node",
    bundle: true,
    format: "cjs",
    outdir: distDir,
    entryNames: "[name]",
    outExtension: { ".js": ".cjs" },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    // Keep server output readable so Render startup errors point to actionable
    // code instead of printing a multi-megabyte minified source line.
    minify: false,
    sourcemap: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
