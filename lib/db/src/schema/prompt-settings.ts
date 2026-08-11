import { pgTable, text, uuid, timestamp, unique } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const promptSettings = pgTable(
  "prompt_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("uq_prompt_settings_org_id").on(table.organizationId, table.id),
    unique("uq_prompt_settings_org_key").on(table.organizationId, table.key),
  ],
);

export type PromptSetting = typeof promptSettings.$inferSelect;
