import { pgTable, text, uuid, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const carrierRulesets = pgTable("carrier_rulesets", {
  id: uuid("id").primaryKey().defaultRandom(),
  carrierKey: text("carrier_key").notNull().unique(),
  displayName: text("display_name").notNull(),
  logoUrl: text("logo_url"),
  active: boolean("active").notNull().default(true),
  ruleset: jsonb("ruleset").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CarrierRuleset = typeof carrierRulesets.$inferSelect;
