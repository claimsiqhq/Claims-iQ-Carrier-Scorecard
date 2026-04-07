import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { promptSettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SYSTEM_PROMPT as DEFAULT_SYSTEM, USER_PROMPT_TEMPLATE as DEFAULT_USER } from "../services/prompts";
import { requireAdmin } from "../middlewares/requireAdmin";
import logger from "../lib/logger";

const router: IRouter = Router();

router.get("/settings/prompts", requireAdmin, async (_req, res) => {
  try {
    const rows = await db.select().from(promptSettings);

    const systemRow = rows.find((r) => r.key === "system_prompt");
    const userRow = rows.find((r) => r.key === "user_prompt_template");

    res.json({
      system_prompt: systemRow?.value ?? DEFAULT_SYSTEM,
      user_prompt_template: userRow?.value ?? DEFAULT_USER,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching prompt settings");
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/settings/prompts", requireAdmin, async (req, res) => {
  try {
    const { system_prompt, user_prompt_template } = req.body;

    if (typeof system_prompt !== "string" || typeof user_prompt_template !== "string") {
      res.status(400).json({ error: "Both system_prompt and user_prompt_template are required" });
      return;
    }

    if (system_prompt.trim().length === 0 || user_prompt_template.trim().length === 0) {
      res.status(400).json({ error: "Prompts cannot be empty" });
      return;
    }

    if (!user_prompt_template.includes("{{REPORT}}")) {
      res.status(400).json({ error: "User prompt must contain {{REPORT}} placeholder" });
      return;
    }

    await db.transaction(async (tx) => {
      for (const { key, value } of [
        { key: "system_prompt", value: system_prompt },
        { key: "user_prompt_template", value: user_prompt_template },
      ]) {
        await tx
          .insert(promptSettings)
          .values({ key, value })
          .onConflictDoUpdate({
            target: promptSettings.key,
            set: { value, updatedAt: new Date() },
          });
      }
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Error saving prompt settings");
    res.status(500).json({ error: "Failed to save settings" });
  }
});

router.post("/settings/prompts/reset", requireAdmin, async (_req, res) => {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(promptSettings).where(eq(promptSettings.key, "system_prompt"));
      await tx.delete(promptSettings).where(eq(promptSettings.key, "user_prompt_template"));
    });

    res.json({
      success: true,
      system_prompt: DEFAULT_SYSTEM,
      user_prompt_template: DEFAULT_USER,
    });
  } catch (err) {
    logger.error({ err }, "Error resetting prompt settings");
    res.status(500).json({ error: "Failed to reset settings" });
  }
});

export default router;
