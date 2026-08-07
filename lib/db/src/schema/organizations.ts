import { sql } from "drizzle-orm";
import {
  boolean,
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

export const organizationRoleEnum = pgEnum("organization_role", [
  "owner",
  "admin",
  "auditor",
  "reviewer",
  "member",
  "viewer",
]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdByUserId: varchar("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("uq_organizations_slug").on(table.slug),
    index("idx_organizations_default").on(table.isDefault),
  ],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: organizationRoleEnum("role").notNull().default("member"),
    permissions: jsonb("permissions")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isDefault: boolean("is_default").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("uq_organization_memberships_org_user").on(
      table.organizationId,
      table.userId,
    ),
    uniqueIndex("uq_organization_memberships_user_default")
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
    index("idx_organization_memberships_user").on(table.userId),
    index("idx_organization_memberships_org_role").on(
      table.organizationId,
      table.role,
    ),
  ],
);

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    resourceType: text("resource_type").notNull().default("claims"),
    filters: jsonb("filters")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    sort: jsonb("sort")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    columns: jsonb("columns").$type<string[]>(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("uq_saved_views_user_name").on(
      table.organizationId,
      table.userId,
      table.name,
    ),
    index("idx_saved_views_org_user").on(table.organizationId, table.userId),
  ],
);

export const organizationAuditEvents = pgTable(
  "organization_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: varchar("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_organization_audit_events_org_created").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const organizationSettings = pgTable("organization_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  inAppNotificationsEnabled: boolean("in_app_notifications_enabled")
    .notNull()
    .default(true),
  emailNotificationsEnabled: boolean("email_notifications_enabled")
    .notNull()
    .default(false),
  retentionDays: integer("retention_days"),
  purgeMode: text("purge_mode").notNull().default("manual"),
  updatedByUserId: varchar("updated_by_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Organization = typeof organizations.$inferSelect;
export type OrganizationMembership = typeof organizationMemberships.$inferSelect;
export type OrganizationRole = OrganizationMembership["role"];
export type SavedView = typeof savedViews.$inferSelect;
export type OrganizationAuditEvent = typeof organizationAuditEvents.$inferSelect;
export type OrganizationSettings = typeof organizationSettings.$inferSelect;
