import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Stable entity keys used by the carrier-tenant cutover. The rows themselves
 * are tenant-owned and are intentionally created by the later data migration.
 */
export const carrierEntityKeys = {
  allstate: "allstate",
  andover: "andover",
  bayStateInsuranceCompany: "bay-state-insurance-company",
  cambridgeMutual: "cambridge-mutual",
  merrimackMutual: "merrimack-mutual",
  wawanesa: "wawanesa",
} as const;

export const carrierEntities = pgTable(
  "carrier_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    entityKey: text("entity_key").notNull(),
    displayName: text("display_name").notNull(),
    legalName: text("legal_name"),
    isPrimary: boolean("is_primary").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("uq_carrier_entities_org_id").on(table.organizationId, table.id),
    unique("uq_carrier_entities_org_key").on(
      table.organizationId,
      table.entityKey,
    ),
    uniqueIndex("uq_carrier_entities_primary")
      .on(table.organizationId)
      .where(sql`${table.isPrimary} = true`),
    // The migration adds a deferred cross-table trigger that also requires
    // one primary entity whenever a tenant profile is configured.
    check(
      "ck_carrier_entities_normalized_key",
      sql`${table.entityKey} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "ck_carrier_entities_display_name",
      sql`nullif(btrim(${table.displayName}), '') is not null`,
    ),
    index("idx_carrier_entities_org_active").on(
      table.organizationId,
      table.active,
    ),
  ],
);

export type CarrierEntity = typeof carrierEntities.$inferSelect;
