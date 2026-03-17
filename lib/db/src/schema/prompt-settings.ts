import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";

export const promptSettings = pgTable("prompt_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type PromptSetting = typeof promptSettings.$inferSelect;
