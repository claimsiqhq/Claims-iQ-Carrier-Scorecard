import { Router, type IRouter } from "express";
import {
  audits,
  carrierRulesets,
  carrierRulesetVersions,
  claims,
  db,
  organizationAuditEvents,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { listActiveCarriers } from "../services/carrierRulesetService";
import { carrierRulesetConfigSchema } from "../services/carrierRulesetTypes";
import { requireOrganizationPermission } from "../middlewares/organizationContext";
import logger from "../lib/logger";

const router: IRouter = Router();

function validateCarrierProfile(input: {
  displayName: unknown;
  ruleset: unknown;
  sourceReferences?: unknown;
}) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (!displayName) errors.push("Display name is required.");

  const parsed = carrierRulesetConfigSchema.safeParse(input.ruleset);
  if (!parsed.success) {
    errors.push(
      ...parsed.error.issues.map((issue) =>
        `${issue.path.join(".") || "ruleset"}: ${issue.message}`
      ),
    );
  }

  const sourceReferences = Array.isArray(input.sourceReferences)
    ? input.sourceReferences.filter(
        (reference): reference is { label: string; url?: string; reference?: string } =>
          Boolean(
            reference
            && typeof reference === "object"
            && "label" in reference
            && typeof reference.label === "string"
            && reference.label.trim(),
          ),
      )
    : [];
  if (sourceReferences.length === 0) {
    warnings.push("No carrier-policy source references are attached.");
  }
  if (parsed.success && !parsed.data.system_prompt_override?.trim()) {
    warnings.push("The organization audit prompt is used without a carrier override.");
  }

  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    displayName,
    ruleset: parsed.success ? parsed.data : null,
    sourceReferences,
  };
}

function serializeVersion(version: typeof carrierRulesetVersions.$inferSelect) {
  return {
    ...version,
    createdAt: version.createdAt.toISOString(),
    publishedAt: version.publishedAt?.toISOString() ?? null,
  };
}

router.get("/carriers", requireAuth, async (_req, res) => {
  const carriers = await listActiveCarriers();
  res.json(carriers);
});

router.get("/carriers/all", requireAdmin, async (_req, res) => {
  try {
    const [rows, versions] = await Promise.all([
      db.select().from(carrierRulesets),
      db
        .select()
        .from(carrierRulesetVersions)
        .orderBy(desc(carrierRulesetVersions.versionNumber)),
    ]);
    res.json(
      rows.map((row) => {
        const carrierVersions = versions.filter(
          (version) => version.carrierKey === row.carrierKey,
        );
        const latest = carrierVersions[0];
        const published = carrierVersions.find(
          (version) => version.status === "published",
        );
        return {
          ...row,
          hasDraft: carrierVersions.some((version) => version.status === "draft"),
          latestVersion: latest ? serializeVersion(latest) : null,
          publishedVersion: published ? serializeVersion(published) : null,
        };
      }),
    );
  } catch {
    res.status(500).json({ error: "Failed to load carriers" });
  }
});

router.get("/carriers/:key", requireAdmin, async (req, res) => {
  const key = req.params.key as string;
  const [[row], versions] = await Promise.all([
    db
      .select()
      .from(carrierRulesets)
      .where(eq(carrierRulesets.carrierKey, key))
      .limit(1),
    db
      .select()
      .from(carrierRulesetVersions)
      .where(eq(carrierRulesetVersions.carrierKey, key))
      .orderBy(desc(carrierRulesetVersions.versionNumber)),
  ]);
  if (!row) {
    res.status(404).json({ error: "Carrier not found" });
    return;
  }
  const latest = versions[0];
  const published = versions.find((version) => version.status === "published");
  res.json({
    ...row,
    displayName: latest?.displayName ?? row.displayName,
    logoUrl: latest?.logoUrl ?? row.logoUrl,
    ruleset: latest?.ruleset ?? row.ruleset,
    active: row.active && latest?.status === "published",
    sourceReferences: latest?.sourceReferences ?? [],
    changeSummary: latest?.changeSummary ?? null,
    latestVersion: latest ? serializeVersion(latest) : null,
    publishedVersion: published ? serializeVersion(published) : null,
    hasDraft: versions.some((version) => version.status === "draft"),
  });
});

router.put("/carriers/:key", requireAdmin, async (req, res) => {
  const key = req.params.key as string;
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(key)) {
    res.status(400).json({ error: "Carrier key is invalid" });
    return;
  }
  const { displayName, logoUrl, ruleset, active, changeSummary, sourceReferences } =
    req.body ?? {};
  const validation = validateCarrierProfile({
    displayName,
    ruleset,
    sourceReferences,
  });
  if (typeof changeSummary !== "string" || !changeSummary.trim()) {
    validation.errors.push("A change summary is required.");
  }
  if (validation.errors.length > 0 || !validation.ruleset) {
    res.status(400).json({
      error: "Carrier ruleset validation failed",
      validation: {
        errors: validation.errors,
        warnings: validation.warnings,
      },
    });
    return;
  }
  const validatedRuleset = validation.ruleset;

  try {
    const version = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
      );
      const [current] = await tx
        .select()
        .from(carrierRulesets)
        .where(eq(carrierRulesets.carrierKey, key))
        .limit(1);
      const [published] = await tx
        .select()
        .from(carrierRulesetVersions)
        .where(
          and(
            eq(carrierRulesetVersions.carrierKey, key),
            eq(carrierRulesetVersions.status, "published"),
          ),
        )
        .limit(1);
      const [numberRow] = await tx
        .select({
          next: sql<number>`coalesce(max(${carrierRulesetVersions.versionNumber}), 0)::int + 1`,
        })
        .from(carrierRulesetVersions)
        .where(eq(carrierRulesetVersions.carrierKey, key));

      if (!current) {
        await tx.insert(carrierRulesets).values({
          carrierKey: key,
          displayName: validation.displayName,
          logoUrl: typeof logoUrl === "string" && logoUrl.trim() ? logoUrl.trim() : null,
          ruleset: validatedRuleset,
          active: Boolean(active),
        });
      } else if (active || !current.active) {
        await tx
          .update(carrierRulesets)
          .set({
            displayName: validation.displayName,
            logoUrl: typeof logoUrl === "string" && logoUrl.trim() ? logoUrl.trim() : null,
            ruleset: validatedRuleset,
            active: Boolean(active),
            updatedAt: new Date(),
          })
          .where(eq(carrierRulesets.carrierKey, key));
      }

      if (active && published) {
        await tx
          .update(carrierRulesetVersions)
          .set({ status: "archived" })
          .where(eq(carrierRulesetVersions.id, published.id));
      }

      const [created] = await tx
        .insert(carrierRulesetVersions)
        .values({
          carrierKey: key,
          versionNumber: numberRow.next,
          versionLabel: validatedRuleset.version,
          status: active ? "published" : "draft",
          displayName: validation.displayName,
          logoUrl: typeof logoUrl === "string" && logoUrl.trim() ? logoUrl.trim() : null,
          ruleset: validatedRuleset,
          validation: {
            errors: validation.errors,
            warnings: validation.warnings,
          },
          changeSummary:
            typeof changeSummary === "string" && changeSummary.trim()
              ? changeSummary.trim()
              : null,
          sourceReferences: validation.sourceReferences,
          createdByUserId: req.user!.id,
          approvedByUserId: active ? req.user!.id : null,
          supersedesVersionId: published?.id ?? null,
          publishedAt: active ? new Date() : null,
        })
        .returning();

      if (active && current) {
        await tx
          .update(carrierRulesets)
          .set({
            displayName: validation.displayName,
            logoUrl: typeof logoUrl === "string" && logoUrl.trim() ? logoUrl.trim() : null,
            ruleset: validatedRuleset,
            active: true,
            updatedAt: new Date(),
          })
          .where(eq(carrierRulesets.carrierKey, key));
      }

      if (req.organization) {
        await tx.insert(organizationAuditEvents).values({
          organizationId: req.organization.organizationId,
          actorUserId: req.user!.id,
          eventType: active
            ? "carrier_ruleset.published"
            : "carrier_ruleset.draft_created",
          targetType: "carrier_ruleset_version",
          targetId: created.id,
          metadata: {
            carrierKey: key,
            versionNumber: created.versionNumber,
            versionLabel: created.versionLabel,
          },
        });
      }
      return created;
    });
    res.json({ success: true, version: serializeVersion(version) });
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError", carrierKey: key },
      "Carrier ruleset save failed",
    );
    res.status(500).json({ error: "Carrier ruleset could not be saved" });
  }
});

router.get("/carriers/:key/versions", requireAdmin, async (req, res) => {
  const key = String(req.params.key || "");
  try {
    const versions = await db
      .select()
      .from(carrierRulesetVersions)
      .where(eq(carrierRulesetVersions.carrierKey, key))
      .orderBy(desc(carrierRulesetVersions.versionNumber));
    const [impact] = req.organization
      ? await db
          .select({ count: sql<number>`count(*)::int` })
          .from(claims)
          .where(
            and(
              eq(claims.organizationId, req.organization.organizationId),
              sql`lower(regexp_replace(coalesce(${claims.carrier}, ''), '[^a-z0-9]+', '_', 'g')) = ${key}`,
            ),
          )
      : [{ count: 0 }];
    res.json({
      versions: versions.map(serializeVersion),
      affectedClaimCount: impact.count,
    });
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError", carrierKey: key },
      "Carrier version history failed",
    );
    res.status(500).json({ error: "Carrier version history could not be loaded" });
  }
});

router.post(
  "/carriers/:key/versions/:versionId/publish",
  requireAdmin,
  async (req, res) => {
    const key = String(req.params.key || "");
    const versionId = String(req.params.versionId || "");
    try {
      const publishedVersion = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
        );
        const [draft] = await tx
          .select()
          .from(carrierRulesetVersions)
          .where(
            and(
              eq(carrierRulesetVersions.id, versionId),
              eq(carrierRulesetVersions.carrierKey, key),
              eq(carrierRulesetVersions.status, "draft"),
            ),
          )
          .limit(1);
        if (!draft) return null;

        const validation = validateCarrierProfile({
          displayName: draft.displayName,
          ruleset: draft.ruleset,
          sourceReferences: draft.sourceReferences,
        });
        if (!draft.changeSummary?.trim()) {
          validation.errors.push("A change summary is required before publication.");
        }
        if (validation.errors.length || !validation.ruleset) {
          throw Object.assign(new Error("Draft validation failed"), {
            code: "draft_validation_failed",
            validation,
          });
        }

        const [currentPublished] = await tx
          .select()
          .from(carrierRulesetVersions)
          .where(
            and(
              eq(carrierRulesetVersions.carrierKey, key),
              eq(carrierRulesetVersions.status, "published"),
            ),
          )
          .limit(1);
        if (currentPublished) {
          await tx
            .update(carrierRulesetVersions)
            .set({ status: "archived" })
            .where(eq(carrierRulesetVersions.id, currentPublished.id));
        }
        const [published] = await tx
          .update(carrierRulesetVersions)
          .set({
            status: "published",
            approvedByUserId: req.user!.id,
            supersedesVersionId: currentPublished?.id ?? null,
            publishedAt: new Date(),
          })
          .where(eq(carrierRulesetVersions.id, draft.id))
          .returning();
        await tx
          .update(carrierRulesets)
          .set({
            displayName: published.displayName,
            logoUrl: published.logoUrl,
            ruleset: published.ruleset,
            active: true,
            updatedAt: new Date(),
          })
          .where(eq(carrierRulesets.carrierKey, key));
        if (req.organization) {
          await tx.insert(organizationAuditEvents).values({
            organizationId: req.organization.organizationId,
            actorUserId: req.user!.id,
            eventType: "carrier_ruleset.published",
            targetType: "carrier_ruleset_version",
            targetId: published.id,
            metadata: {
              carrierKey: key,
              versionNumber: published.versionNumber,
              versionLabel: published.versionLabel,
            },
          });
        }
        return published;
      });
      if (!publishedVersion) {
        res.status(404).json({ error: "Draft carrier version not found" });
        return;
      }
      res.json({ version: serializeVersion(publishedVersion) });
    } catch (error) {
      if (
        error
        && typeof error === "object"
        && "code" in error
        && error.code === "draft_validation_failed"
      ) {
        res.status(400).json({
          error: "Draft carrier ruleset is invalid",
          validation: "validation" in error ? error.validation : undefined,
        });
        return;
      }
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError", carrierKey: key },
        "Carrier publish failed",
      );
      res.status(500).json({ error: "Carrier version could not be published" });
    }
  },
);

router.post(
  "/carriers/:key/versions/:versionId/rollback",
  requireAdmin,
  async (req, res) => {
    const key = String(req.params.key || "");
    const versionId = String(req.params.versionId || "");
    try {
      const rolledBack = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
        );
        const [source] = await tx
          .select()
          .from(carrierRulesetVersions)
          .where(
            and(
              eq(carrierRulesetVersions.id, versionId),
              eq(carrierRulesetVersions.carrierKey, key),
            ),
          )
          .limit(1);
        if (!source || source.status === "draft") return null;
        const [current] = await tx
          .select()
          .from(carrierRulesetVersions)
          .where(
            and(
              eq(carrierRulesetVersions.carrierKey, key),
              eq(carrierRulesetVersions.status, "published"),
            ),
          )
          .limit(1);
        if (!current || current.id === source.id) return null;
        const [numberRow] = await tx
          .select({
            next: sql<number>`coalesce(max(${carrierRulesetVersions.versionNumber}), 0)::int + 1`,
          })
          .from(carrierRulesetVersions)
          .where(eq(carrierRulesetVersions.carrierKey, key));

        await tx
          .update(carrierRulesetVersions)
          .set({ status: "archived" })
          .where(eq(carrierRulesetVersions.id, current.id));
        const [published] = await tx
          .insert(carrierRulesetVersions)
          .values({
            carrierKey: key,
            versionNumber: numberRow.next,
            versionLabel: source.versionLabel,
            status: "published",
            displayName: source.displayName,
            logoUrl: source.logoUrl,
            ruleset: source.ruleset,
            validation: source.validation,
            changeSummary: `Rollback to version ${source.versionNumber}: ${source.versionLabel}`,
            sourceReferences: source.sourceReferences,
            createdByUserId: req.user!.id,
            approvedByUserId: req.user!.id,
            supersedesVersionId: current.id,
            publishedAt: new Date(),
          })
          .returning();
        await tx
          .update(carrierRulesets)
          .set({
            displayName: published.displayName,
            logoUrl: published.logoUrl,
            ruleset: published.ruleset,
            active: true,
            updatedAt: new Date(),
          })
          .where(eq(carrierRulesets.carrierKey, key));
        if (req.organization) {
          await tx.insert(organizationAuditEvents).values({
            organizationId: req.organization.organizationId,
            actorUserId: req.user!.id,
            eventType: "carrier_ruleset.rolled_back",
            targetType: "carrier_ruleset_version",
            targetId: published.id,
            metadata: {
              carrierKey: key,
              sourceVersionNumber: source.versionNumber,
              versionNumber: published.versionNumber,
            },
          });
        }
        return published;
      });
      if (!rolledBack) {
        res.status(409).json({ error: "Only an earlier published version can be restored" });
        return;
      }
      res.json({ version: serializeVersion(rolledBack) });
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError", carrierKey: key },
        "Carrier rollback failed",
      );
      res.status(500).json({ error: "Carrier version could not be restored" });
    }
  },
);

router.post(
  "/carriers/:key/test",
  requireAdmin,
  requireOrganizationPermission("claims:read"),
  async (req, res) => {
    const key = String(req.params.key || "");
    const claimId = typeof req.body?.claimId === "string" ? req.body.claimId : "";
    const versionId =
      typeof req.body?.versionId === "string" ? req.body.versionId : undefined;
    if (!claimId) {
      res.status(400).json({ error: "claimId is required" });
      return;
    }
    const [claim] = await db
      .select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        carrier: claims.carrier,
        currentScore: audits.overallScore,
        currentRisk: audits.riskLevel,
      })
      .from(claims)
      .leftJoin(audits, eq(audits.id, claims.currentAuditId))
      .where(
        and(
          eq(claims.id, claimId),
          eq(claims.organizationId, req.organization!.organizationId),
        ),
      )
      .limit(1);
    if (!claim) {
      res.status(404).json({ error: "Representative claim not found" });
      return;
    }
    const [version] = await db
      .select()
      .from(carrierRulesetVersions)
      .where(
        and(
          eq(carrierRulesetVersions.carrierKey, key),
          ...(versionId ? [eq(carrierRulesetVersions.id, versionId)] : []),
        ),
      )
      .orderBy(desc(carrierRulesetVersions.versionNumber))
      .limit(1);
    if (!version) {
      res.status(404).json({ error: "Carrier ruleset version not found" });
      return;
    }
    const validation = validateCarrierProfile({
      displayName: version.displayName,
      ruleset: version.ruleset,
      sourceReferences: version.sourceReferences,
    });
    const ruleset = validation.ruleset;
    res.json({
      mode: "deterministic_preflight",
      claim: {
        id: claim.id,
        claimNumber: claim.claimNumber,
        carrier: claim.carrier,
        currentScore: claim.currentScore,
        currentRisk: claim.currentRisk,
      },
      version: {
        id: version.id,
        versionNumber: version.versionNumber,
        versionLabel: version.versionLabel,
        status: version.status,
      },
      compatible:
        validation.errors.length === 0
        && String(claim.carrier || "").trim().length > 0,
      validation: {
        errors: validation.errors,
        warnings: validation.warnings,
      },
      coverage: {
        deskAdjusterQuestions: ruleset?.da_questions.length ?? 0,
        fieldAdjusterQuestions: ruleset?.fa_questions.length ?? 0,
        categories: ruleset?.scorecard_categories.length ?? 0,
        configuredPoints:
          (ruleset?.da_questions.reduce((sum, question) => sum + question.weight, 0) ?? 0)
          + (ruleset?.fa_questions.reduce((sum, question) => sum + question.weight, 0) ?? 0),
      },
      note:
        "This deterministic preflight does not call the AI provider or alter the representative claim.",
    });
  },
);

router.delete("/carriers/:key", requireAdmin, async (req, res) => {
  const key = req.params.key as string;
  const [updated] = await db
    .update(carrierRulesets)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(carrierRulesets.carrierKey, key))
    .returning({ carrierKey: carrierRulesets.carrierKey });
  if (!updated) {
    res.status(404).json({ error: "Carrier not found" });
    return;
  }
  if (req.organization) {
    await db.insert(organizationAuditEvents).values({
      organizationId: req.organization.organizationId,
      actorUserId: req.user!.id,
      eventType: "carrier_ruleset.deactivated",
      targetType: "carrier",
      targetId: key,
    });
  }
  res.json({ success: true, deactivated: true });
});

export default router;
