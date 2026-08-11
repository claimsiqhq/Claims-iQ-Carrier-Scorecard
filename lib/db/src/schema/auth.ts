import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

export const platformRoleEnum = pgEnum("platform_role", ["platform_admin"]);

export const usersTable = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar("email").unique().notNull(),
  passwordHash: varchar("password_hash").notNull(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role").notNull().default("user"),
  platformRole: platformRoleEnum("platform_role"),
  authVersion: integer("auth_version").notNull().default(1),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
    userId: varchar("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    authVersion: integer("auth_version").notNull().default(0),
  },
  (table) => [
    unique("uq_sessions_user_sid").on(table.userId, table.sid),
    index("IDX_session_expire").on(table.expire),
    index("idx_sessions_user_id").on(table.userId),
  ],
);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
export type PlatformRole = User["platformRole"];
