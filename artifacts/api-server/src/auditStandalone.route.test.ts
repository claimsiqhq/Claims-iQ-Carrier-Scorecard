import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import auditStandaloneRouter from "./routes/auditStandalone";

test("standalone audit route returns 400 when no text or file is provided", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    req.user = {
      id: "user-1",
      email: "user@example.com",
      firstName: "Test",
      lastName: "User",
      profileImageUrl: null,
    };
    next();
  });
  app.use(auditStandaloneRouter);

  const res = await request(app)
    .post("/audit/standalone")
    .send({});

  assert.equal(res.status, 400);
  assert.match(String(res.body.error ?? ""), /reportText|PDF/i);
});
