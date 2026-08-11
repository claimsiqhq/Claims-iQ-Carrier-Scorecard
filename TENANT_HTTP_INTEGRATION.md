# Two-tenant HTTP integration suite

Run the real tenant-isolation suite from the repository root:

```sh
pnpm test:tenant-integration
```

By default, the runner starts a disposable `postgres:16-alpine` Docker
container on a random localhost port, runs the suite, and removes the
container. Docker must be installed and running.

To use an already-provisioned disposable PostgreSQL 16+ database instead:

```sh
TENANT_INTEGRATION_DATABASE_URL='postgresql://...' \
  pnpm test:tenant-integration
```

The database is destructive test infrastructure. Its database name must
clearly contain both `tenant` and `integration`; the suite drops and rebuilds
application schemas before applying the full migration/cutover chain. The
runner sets the required `TENANT_INTEGRATION_ALLOW_RESET=1` safeguard.

The test file remains opt-in during normal package tests. It reports a skip
when `TENANT_INTEGRATION_DATABASE_URL` is absent.

## Coverage

The suite uses the actual Express app and Supertest cookie agents. It creates
four restricted `NOINHERIT LOGIN` roles, each granted exactly one runtime
capability (`claims_iq_identity`, `claims_iq_tenant_api`,
`claims_iq_platform_admin`, or `claims_iq_worker`).

After applying the legacy baseline, every ordered production migration,
storage fixture/copy manifest, carrier cutover, and validation SQL, it seeds:

- independent Allstate and Andover users, memberships, carrier profiles and
  entities, invitations, saved views, and settings;
- complete claim/document/audit/finding/evidence/activity/job graphs in both
  tenants;
- platform-admin session/lease cases and global worker-claim jobs.

HTTP probes cover aggregate leakage, direct foreign identifiers, document and
audit routes, job operations, assignment/review/archive flows, administrative
IDs, foreign-key body attempts, forged organization headers, reverse-direction
isolation, platform lease replacement/revocation/expiry, and worker job
binding. The suite snapshots the foreign tenant before and after mutation
attempts.

No database or authorization repository is mocked. Foreign document, audit,
and email requests are rejected before external transport calls, so the suite
does not contact Supabase Storage, Gemini, SendGrid, or any other network
service.

## Defects caught by the suite

The suite caught and now guards two runtime defects: exact 60-minute leases
used inconsistent timestamp bases, and concurrent route queries shared one
unserialized request client. Lease creation now stores `created_at` and
`expires_at` from the same statement timestamp, while scoped clients serialize
queries without weakening their tenant session settings.
