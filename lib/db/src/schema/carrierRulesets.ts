import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { organizations } from "./organizations";

export const carrierRulesetVersionStateEnum = pgEnum(
  "carrier_ruleset_version_state",
  ["draft", "published", "archived"],
);

export const carrierRulesets = pgTable(
  "carrier_rulesets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable only during the expand/cutover window. The cutover assigns each
    // profile to its carrier organization before tightening this column.
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    carrierKey: text("carrier_key").notNull().unique(),
    displayName: text("display_name").notNull(),
    logoUrl: text("logo_url"),
    active: boolean("active").notNull().default(true),
    ruleset: jsonb("ruleset").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("uq_carrier_rulesets_org_id").on(table.organizationId, table.id),
    // Together with the migration's deferred profile/entity trigger, this
    // makes a configured organization own exactly one carrier profile.
    unique("uq_carrier_rulesets_organization").on(table.organizationId),
    unique("uq_carrier_rulesets_org_key").on(
      table.organizationId,
      table.carrierKey,
    ),
    index("idx_carrier_rulesets_organization").on(table.organizationId),
  ],
);

export const carrierRulesetVersions = pgTable(
  "carrier_ruleset_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Kept nullable until the parent ruleset ownership cutover is complete.
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    carrierKey: text("carrier_key")
      .notNull()
      .references(() => carrierRulesets.carrierKey, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    versionLabel: text("version_label").notNull(),
    status: carrierRulesetVersionStateEnum("status").notNull().default("draft"),
    displayName: text("display_name").notNull(),
    logoUrl: text("logo_url"),
    ruleset: jsonb("ruleset").notNull(),
    validation: jsonb("validation")
      .$type<{ errors: string[]; warnings: string[] }>()
      .notNull()
      .default(sql`'{"errors":[],"warnings":[]}'::jsonb`),
    changeSummary: text("change_summary"),
    sourceReferences: jsonb("source_references")
      .$type<Array<{ label: string; url?: string; reference?: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdByUserId: varchar("created_by_user_id").references(
      () => usersTable.id,
      {
        onDelete: "set null",
      },
    ),
    approvedByUserId: varchar("approved_by_user_id").references(
      () => usersTable.id,
      {
        onDelete: "set null",
      },
    ),
    supersedesVersionId: uuid("supersedes_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    unique("uq_carrier_ruleset_versions_org_id").on(
      table.organizationId,
      table.id,
    ),
    unique("uq_carrier_ruleset_versions_number").on(
      table.carrierKey,
      table.versionNumber,
    ),
    uniqueIndex("uq_carrier_ruleset_versions_published")
      .on(table.carrierKey)
      .where(sql`${table.status} = 'published'`),
    index("idx_carrier_ruleset_versions_key_created").on(
      table.carrierKey,
      table.createdAt,
    ),
    index("idx_carrier_ruleset_versions_org_key").on(
      table.organizationId,
      table.carrierKey,
    ),
    foreignKey({
      columns: [table.organizationId, table.carrierKey],
      foreignColumns: [
        carrierRulesets.organizationId,
        carrierRulesets.carrierKey,
      ],
      name: "fk_carrier_ruleset_versions_ruleset_tenant",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.supersedesVersionId],
      foreignColumns: [table.organizationId, table.id],
      name: "fk_carrier_ruleset_versions_supersedes_tenant",
    }),
  ],
);

export type CarrierRuleset = typeof carrierRulesets.$inferSelect;
export type CarrierRulesetVersion = typeof carrierRulesetVersions.$inferSelect;
