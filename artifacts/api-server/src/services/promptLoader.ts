import { db, promptSettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import logger from "../lib/logger";
import { getDefaultPrompt, type PromptKey } from "./promptDefaults";

export async function getPrompt(key: PromptKey): Promise<string> {
  try {
    const [row] = await db
      .select({ value: promptSettings.value })
      .from(promptSettings)
      .where(eq(promptSettings.key, key))
      .limit(1);

    if (row?.value && row.value.trim().length > 0) {
      return row.value;
    }
  } catch (err) {
    logger.warn({ err, promptKey: key }, "Prompt lookup failed, using default");
  }

  return getDefaultPrompt(key);
}
