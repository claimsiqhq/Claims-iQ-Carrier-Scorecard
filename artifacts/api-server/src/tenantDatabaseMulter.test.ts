import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import multer from "multer";
import request from "supertest";
import {
  createContextDatabaseProxy,
  runWithTenantDatabase,
  type ScopedDatabaseLease,
  type WorkspaceDatabase,
} from "@workspace/db";
import { withTenantDatabaseContext } from "./middlewares/organizationContext";

function stubLease(label: string): ScopedDatabaseLease {
  return {
    database: { select: () => label },
    client: {},
    pool: {},
    settings: {},
    isReleased: false,
    async release() {},
  } as unknown as ScopedDatabaseLease;
}

test("multer drops tenant ALS and withTenantDatabaseContext restores it", async () => {
  const operations = {
    select: () => "operations",
  } as unknown as WorkspaceDatabase;
  const facade = createContextDatabaseProxy(operations);
  const lease = stubLease("tenant");
  const upload = multer({ storage: multer.memoryStorage() });
  const app = express();

  app.post(
    "/lost",
    (_req, _res, next) => {
      runWithTenantDatabase(lease, next);
    },
    upload.single("file"),
    (_req, res) => {
      res.json({ plane: (facade.select as unknown as () => string)() });
    },
  );

  app.post(
    "/fixed",
    (req, _res, next) => {
      req.tenantDatabaseLease = lease;
      runWithTenantDatabase(lease, next);
    },
    upload.single("file"),
    withTenantDatabaseContext(async (_req, res) => {
      await new Promise((resolve) => setImmediate(resolve));
      res.json({ plane: (facade.select as unknown as () => string)() });
    }),
  );

  const lost = await request(app)
    .post("/lost")
    .attach("file", Buffer.from("%PDF-1.4"), "claim.pdf");
  const fixed = await request(app)
    .post("/fixed")
    .attach("file", Buffer.from("%PDF-1.4"), "claim.pdf");

  assert.equal(lost.status, 200);
  assert.equal(lost.body.plane, "operations");
  assert.equal(fixed.status, 200);
  assert.equal(fixed.body.plane, "tenant");
});

test("withTenantDatabaseContext fails closed when the request lease is missing", async () => {
  const app = express();
  app.post(
    "/ingest",
    withTenantDatabaseContext((_req, res) => {
      res.json({ ok: true });
    }),
  );

  const response = await request(app).post("/ingest");
  assert.equal(response.status, 500);
  assert.match(response.body.error, /tenant database context/i);
});
