import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sessionsTable, usersTable } from "./auth";
import { organizations } from "./organizations";

export const platformTenantAccessLeases = pgTable(
  "platform_tenant_access_leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    platformUserId: varchar("platform_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    sessionId: varchar("session_id").notNull(),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: varchar("revoked_by_user_id").references(
      () => usersTable.id,
      { onDelete: "restrict" },
    ),
    revocationReason: text("revocation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_platform_tenant_access_leases_org_id").on(
      table.organizationId,
      table.id,
    ),
    foreignKey({
      columns: [table.platformUserId, table.sessionId],
      foreignColumns: [sessionsTable.userId, sessionsTable.sid],
      name: "fk_platform_tenant_access_leases_session_owner",
    }).onDelete("cascade"),
    check(
      "ck_platform_tenant_access_leases_reason",
      sql`nullif(btrim(${table.reason}), '') is not null`,
    ),
    check(
      "ck_platform_tenant_access_leases_expiry",
      sql`${table.expiresAt} > ${table.createdAt}
        and ${table.expiresAt} <= ${table.createdAt} + interval '1 hour'`,
    ),
    check(
      "ck_platform_tenant_access_leases_revocation",
      sql`(
        ${table.revokedAt} is null
        and ${table.revokedByUserId} is null
        and ${table.revocationReason} is null
      ) or (
        ${table.revokedAt} is not null
        and ${table.revokedByUserId} is not null
        and nullif(btrim(${table.revocationReason}), '') is not null
        and ${table.revokedAt} >= ${table.createdAt}
      )`,
    ),
    index("idx_platform_tenant_access_leases_active").on(
      table.organizationId,
      table.platformUserId,
      table.sessionId,
      table.expiresAt,
    ),
    index("idx_platform_tenant_access_leases_session").on(table.sessionId),
  ],
);

export const platformAuditEvents = pgTable(
  "platform_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorUserId: varchar("actor_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    sessionId: varchar("session_id").notNull(),
    accessLeaseId: uuid("access_lease_id"),
    eventType: text("event_type").notNull(),
    reason: text("reason").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_platform_audit_events_org_id").on(
      table.organizationId,
      table.id,
    ),
    check(
      "ck_platform_audit_events_event_type",
      sql`${table.eventType} ~ '^[a-z][a-z0-9_]*$'`,
    ),
    check(
      "ck_platform_audit_events_reason",
      sql`nullif(btrim(${table.reason}), '') is not null`,
    ),
    check(
      "ck_platform_audit_events_metadata",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    index("idx_platform_audit_events_org_created").on(
      table.organizationId,
      table.createdAt,
    ),
    index("idx_platform_audit_events_lease").on(table.accessLeaseId),
  ],
);

export type PlatformTenantAccessLease =
  typeof platformTenantAccessLeases.$inferSelect;
export type PlatformAuditEvent = typeof platformAuditEvents.$inferSelect;
