import { Router, type IRouter, type Request, type Response } from "express";
import {
  acquireTenantDatabase,
  audits,
  carrierRulesetVersions,
  claims,
  db,
  runWithTenantDatabase,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  getOrganizationCarrierProfile,
  platformCreateCarrierRulesetVersion,
  platformPublishCarrierRulesetVersion,
  platformUpsertCarrierEntity,
  platformUpsertCarrierProfile,
  type OrganizationCarrierProfile,
  type PlatformCarrierActor,
} from "../services/carrierRulesetService";
import { carrierRulesetConfigSchema } from "../services/carrierRulesetTypes";
import logger from "../lib/logger";

const router: IRouter = Router();
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARRIER_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,79}$/;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function normalizedCarrierKey(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function platformContext(
  req: Request,
  res: Response,
): {
  actor: PlatformCarrierActor;
  organizationId: string;
} | null {
  if (
    !req.isAuthenticated() ||
    req.user.platformRole !== "admin" ||
    !req.databaseSessionId
  ) {
    res.status(403).json({ error: "Platform administrator access required" });
    return null;
  }
  if (
    !req.organization ||
    req.organization.accessMode !== "platform_lease" ||
    !req.activePlatformTenantAccess
  ) {
    res.status(403).json({
      error: "A current platform tenant access lease is required",
    });
    return null;
  }
  return {
    actor: {
      userId: req.user.id,
      sessionId: req.databaseSessionId,
    },
    organizationId: req.organization.organizationId,
  };
}

async function withPlatformTenantDatabase<T>(
  req: Request,
  res: Response,
  callback: (organizationId: string) => Promise<T>,
): Promise<T | undefined> {
  const context = platformContext(req, res);
  if (!context) return undefined;
  const lease = await acquireTenantDatabase({
    userId: context.actor.userId,
    sessionId: context.actor.sessionId,
    organizationId: context.organizationId,
  });
  try {
    return await runWithTenantDatabase(lease, () =>
      callback(context.organizationId),
    );
  } finally {
    await lease.release();
  }
}

function serializeVersion(
  version: typeof carrierRulesetVersions.$inferSelect,
) {
  return {
    ...version,
    createdAt: version.createdAt.toISOString(),
    publishedAt: version.publishedAt?.toISOString() ?? null,
  };
}

function serializeProfile(profile: OrganizationCarrierProfile) {
  return {
    ...profile,
    latestVersion: profile.latestVersion
      ? serializeVersion(profile.latestVersion)
      : null,
    publishedVersion: profile.publishedVersion
      ? serializeVersion(profile.publishedVersion)
      : null,
    createdAt: profile.createdAt?.toISOString() ?? null,
    updatedAt: profile.updatedAt?.toISOString() ?? null,
    entities: profile.entities.map((entity) => ({
      ...entity,
      createdAt:
        "createdAt" in entity && entity.createdAt instanceof Date
          ? entity.createdAt.toISOString()
          : undefined,
      updatedAt:
        "updatedAt" in entity && entity.updatedAt instanceof Date
          ? entity.updatedAt.toISOString()
          : undefined,
    })),
  };
}

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
      ...parsed.error.issues.map(
        (issue) =>
          `${issue.path.join(".") || "ruleset"}: ${issue.message}`,
      ),
    );
  }

  const sourceReferences = Array.isArray(input.sourceReferences)
    ? input.sourceReferences.filter(
        (
          reference,
        ): reference is {
          label: string;
          url?: string;
          reference?: string;
        } =>
          Boolean(
            reference &&
              typeof reference === "object" &&
              "label" in reference &&
              typeof reference.label === "string" &&
              reference.label.trim(),
          ),
      )
    : [];
  if (sourceReferences.length === 0) {
    warnings.push("No carrier-policy source references are attached.");
  }
  if (parsed.success && !parsed.data.system_prompt_override?.trim()) {
    warnings.push(
      "The organization audit prompt is used without a carrier override.",
    );
  }
  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    displayName,
    ruleset: parsed.success ? parsed.data : null,
    sourceReferences,
  };
}

function rejectOrganizationOverride(req: Request, res: Response): boolean {
  if (
    req.body &&
    typeof req.body === "object" &&
    ("organizationId" in req.body ||
      "tenantId" in req.body ||
      "ownerOrganizationId" in req.body)
  ) {
    res.status(400).json({
      error:
        "Organization selection is session-bound and cannot be supplied in the request body.",
    });
    return true;
  }
  return false;
}

function platformFailure(error: unknown, res: Response): void {
  logger.error(
    { errorName: error instanceof Error ? error.name : "UnknownError" },
    "Platform carrier administration request failed",
  );
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (["22023", "23503", "23514"].includes(code)) {
    res.status(400).json({ error: "Carrier administration input was rejected" });
    return;
  }
  if (code === "55000" || code === "23505") {
    res.status(409).json({ error: "Carrier administration state conflict" });
    return;
  }
  res.status(500).json({ error: "Carrier administration request failed" });
}

router.use("/platform/carriers", requireAdmin);

router.get("/platform/carriers", async (req, res) => {
  try {
    const profile = await withPlatformTenantDatabase(
      req,
      res,
      getOrganizationCarrierProfile,
    );
    if (profile === undefined) return;
    res.json(profile ? [serializeProfile(profile)] : []);
  } catch (error) {
    platformFailure(error, res);
  }
});

router.get("/platform/carriers/:key", async (req, res) => {
  try {
    const key = normalizedCarrierKey(firstParam(req.params.key));
    const profile = await withPlatformTenantDatabase(
      req,
      res,
      getOrganizationCarrierProfile,
    );
    if (profile === undefined) return;
    if (!profile || profile.carrierKey !== key) {
      res.status(404).json({ error: "Carrier profile not found" });
      return;
    }
    res.json(serializeProfile(profile));
  } catch (error) {
    platformFailure(error, res);
  }
});

router.put("/platform/carriers/:key", async (req, res) => {
  if (rejectOrganizationOverride(req, res)) return;
  const context = platformContext(req, res);
  if (!context) return;
  const rawKey = firstParam(req.params.key);
  if (!CARRIER_KEY_RE.test(rawKey)) {
    res.status(400).json({ error: "Carrier key is invalid" });
    return;
  }
  const key = normalizedCarrierKey(rawKey);
  const {
    displayName,
    logoUrl,
    ruleset,
    active,
    changeSummary,
    sourceReferences,
  } = req.body ?? {};
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

  try {
    const existing = await withPlatformTenantDatabase(
      req,
      res,
      getOrganizationCarrierProfile,
    );
    if (existing === undefined) return;
    if (existing && existing.carrierKey !== key) {
      res.status(409).json({
        error: "The organization already has a different carrier profile",
      });
      return;
    }
    if (!existing) {
      await platformUpsertCarrierProfile({
        actor: context.actor,
        organizationId: context.organizationId,
        carrierKey: key,
        displayName: validation.displayName,
        ruleset: validation.ruleset,
        logoUrl:
          typeof logoUrl === "string" && logoUrl.trim()
            ? logoUrl.trim()
            : null,
        primaryEntityKey: key,
        primaryEntityName: validation.displayName,
        primaryLegalName: null,
        changeReason: changeSummary.trim(),
      });
    }
    const versionId = await platformCreateCarrierRulesetVersion({
      actor: context.actor,
      organizationId: context.organizationId,
      versionLabel: validation.ruleset.version,
      displayName: validation.displayName,
      logoUrl:
        typeof logoUrl === "string" && logoUrl.trim() ? logoUrl.trim() : null,
      ruleset: validation.ruleset,
      validation: {
        errors: validation.errors,
        warnings: validation.warnings,
      },
      changeSummary: changeSummary.trim(),
      sourceReferences: validation.sourceReferences,
      changeReason: changeSummary.trim(),
    });
    if (active === true) {
      await platformPublishCarrierRulesetVersion({
        actor: context.actor,
        organizationId: context.organizationId,
        versionId,
        changeReason: changeSummary.trim(),
      });
    }
    const version = await withPlatformTenantDatabase(
      req,
      res,
      async (organizationId) => {
        const [saved] = await db
          .select()
          .from(carrierRulesetVersions)
          .where(
            and(
              eq(carrierRulesetVersions.organizationId, organizationId),
              eq(carrierRulesetVersions.id, versionId),
            ),
          )
          .limit(1);
        return saved ?? null;
      },
    );
    if (version === undefined) return;
    if (!version) {
      throw new Error("Created carrier version could not be read back.");
    }
    res.json({ success: true, version: serializeVersion(version) });
  } catch (error) {
    platformFailure(error, res);
  }
});

router.get("/platform/carriers/:key/versions", async (req, res) => {
  try {
    const key = normalizedCarrierKey(firstParam(req.params.key));
    const result = await withPlatformTenantDatabase(
      req,
      res,
      async (organizationId) => {
        const [versions, [impact]] = await Promise.all([
          db
            .select()
            .from(carrierRulesetVersions)
            .where(
              and(
                eq(carrierRulesetVersions.organizationId, organizationId),
                eq(carrierRulesetVersions.carrierKey, key),
              ),
            )
            .orderBy(desc(carrierRulesetVersions.versionNumber)),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(claims)
            .where(eq(claims.organizationId, organizationId)),
        ]);
        return {
          versions,
          affectedClaimCount: Number(impact?.count ?? 0),
        };
      },
    );
    if (result === undefined) return;
    res.json({
      versions: result.versions.map(serializeVersion),
      affectedClaimCount: result.affectedClaimCount,
    });
  } catch (error) {
    platformFailure(error, res);
  }
});

router.post(
  "/platform/carriers/:key/versions/:versionId/publish",
  async (req, res) => {
    if (rejectOrganizationOverride(req, res)) return;
    const context = platformContext(req, res);
    if (!context) return;
    const key = normalizedCarrierKey(firstParam(req.params.key));
    const versionId = firstParam(req.params.versionId);
    if (!UUID_RE.test(versionId)) {
      res.status(400).json({ error: "Invalid version ID" });
      return;
    }
    try {
      const version = await withPlatformTenantDatabase(
        req,
        res,
        async (organizationId) => {
          const [row] = await db
            .select()
            .from(carrierRulesetVersions)
            .where(
              and(
                eq(carrierRulesetVersions.organizationId, organizationId),
                eq(carrierRulesetVersions.carrierKey, key),
                eq(carrierRulesetVersions.id, versionId),
              ),
            )
            .limit(1);
          return row ?? null;
        },
      );
      if (version === undefined) return;
      if (!version) {
        res.status(404).json({ error: "Carrier ruleset version not found" });
        return;
      }
      if (version.status !== "draft") {
        res.status(409).json({ error: "Only a draft version can be published" });
        return;
      }
      const validation = validateCarrierProfile({
        displayName: version.displayName,
        ruleset: version.ruleset,
        sourceReferences: version.sourceReferences,
      });
      const changeReason = version.changeSummary?.trim();
      if (!changeReason) {
        validation.errors.push(
          "A change summary is required before publication.",
        );
      }
      if (validation.errors.length || !validation.ruleset) {
        res.status(400).json({
          error: "Draft carrier ruleset is invalid",
          validation,
        });
        return;
      }
      const published = await platformPublishCarrierRulesetVersion({
        actor: context.actor,
        organizationId: context.organizationId,
        versionId,
        changeReason: changeReason!,
      });
      if (!published) {
        res.status(409).json({ error: "Carrier version was not published" });
        return;
      }
      const updated = await withPlatformTenantDatabase(
        req,
        res,
        async (organizationId) => {
          const [row] = await db
            .select()
            .from(carrierRulesetVersions)
            .where(
              and(
                eq(carrierRulesetVersions.organizationId, organizationId),
                eq(carrierRulesetVersions.id, versionId),
              ),
            )
            .limit(1);
          return row ?? null;
        },
      );
      if (updated === undefined) return;
      if (!updated) throw new Error("Published version could not be read back.");
      res.json({ version: serializeVersion(updated) });
    } catch (error) {
      platformFailure(error, res);
    }
  },
);

router.post(
  "/platform/carriers/:key/versions/:versionId/rollback",
  async (req, res) => {
    if (rejectOrganizationOverride(req, res)) return;
    const context = platformContext(req, res);
    if (!context) return;
    const key = normalizedCarrierKey(firstParam(req.params.key));
    const sourceVersionId = firstParam(req.params.versionId);
    if (!UUID_RE.test(sourceVersionId)) {
      res.status(400).json({ error: "Invalid version ID" });
      return;
    }
    try {
      const source = await withPlatformTenantDatabase(
        req,
        res,
        async (organizationId) => {
          const [row] = await db
            .select()
            .from(carrierRulesetVersions)
            .where(
              and(
                eq(carrierRulesetVersions.organizationId, organizationId),
                eq(carrierRulesetVersions.carrierKey, key),
                eq(carrierRulesetVersions.id, sourceVersionId),
              ),
            )
            .limit(1);
          return row ?? null;
        },
      );
      if (source === undefined) return;
      if (!source || source.status === "draft") {
        res.status(409).json({
          error: "Only an earlier published version can be restored",
        });
        return;
      }
      const ruleset = carrierRulesetConfigSchema.safeParse(source.ruleset);
      if (!ruleset.success) {
        res.status(400).json({ error: "Historical ruleset is invalid" });
        return;
      }
      const reason = `Rollback to version ${source.versionNumber}: ${source.versionLabel}`;
      const versionId = await platformCreateCarrierRulesetVersion({
        actor: context.actor,
        organizationId: context.organizationId,
        versionLabel: source.versionLabel,
        displayName: source.displayName,
        logoUrl: source.logoUrl,
        ruleset: ruleset.data,
        validation: source.validation,
        changeSummary: reason,
        sourceReferences: source.sourceReferences,
        changeReason: reason,
      });
      await platformPublishCarrierRulesetVersion({
        actor: context.actor,
        organizationId: context.organizationId,
        versionId,
        changeReason: reason,
      });
      const restored = await withPlatformTenantDatabase(
        req,
        res,
        async (organizationId) => {
          const [row] = await db
            .select()
            .from(carrierRulesetVersions)
            .where(
              and(
                eq(carrierRulesetVersions.organizationId, organizationId),
                eq(carrierRulesetVersions.id, versionId),
              ),
            )
            .limit(1);
          return row ?? null;
        },
      );
      if (restored === undefined) return;
      if (!restored) throw new Error("Rollback version could not be read back.");
      res.json({ version: serializeVersion(restored) });
    } catch (error) {
      platformFailure(error, res);
    }
  },
);

router.post("/platform/carriers/:key/test", async (req, res) => {
  if (rejectOrganizationOverride(req, res)) return;
  const key = normalizedCarrierKey(firstParam(req.params.key));
  const claimId = typeof req.body?.claimId === "string" ? req.body.claimId : "";
  const versionId =
    typeof req.body?.versionId === "string" ? req.body.versionId : undefined;
  if (!UUID_RE.test(claimId) || (versionId && !UUID_RE.test(versionId))) {
    res.status(400).json({ error: "Valid claimId and versionId are required" });
    return;
  }
  try {
    const result = await withPlatformTenantDatabase(
      req,
      res,
      async (organizationId) => {
        const [[claim], [version]] = await Promise.all([
          db
            .select({
              id: claims.id,
              claimNumber: claims.claimNumber,
              carrier: claims.carrier,
              currentScore: audits.overallScore,
              currentRisk: audits.riskLevel,
            })
            .from(claims)
            .leftJoin(
              audits,
              and(
                eq(audits.id, claims.currentAuditId),
                eq(audits.organizationId, claims.organizationId),
              ),
            )
            .where(
              and(
                eq(claims.id, claimId),
                eq(claims.organizationId, organizationId),
              ),
            )
            .limit(1),
          db
            .select()
            .from(carrierRulesetVersions)
            .where(
              and(
                eq(carrierRulesetVersions.organizationId, organizationId),
                eq(carrierRulesetVersions.carrierKey, key),
                ...(versionId
                  ? [eq(carrierRulesetVersions.id, versionId)]
                  : []),
              ),
            )
            .orderBy(desc(carrierRulesetVersions.versionNumber))
            .limit(1),
        ]);
        return { claim, version };
      },
    );
    if (result === undefined) return;
    if (!result.claim) {
      res.status(404).json({ error: "Representative claim not found" });
      return;
    }
    if (!result.version) {
      res.status(404).json({ error: "Carrier ruleset version not found" });
      return;
    }
    const validation = validateCarrierProfile({
      displayName: result.version.displayName,
      ruleset: result.version.ruleset,
      sourceReferences: result.version.sourceReferences,
    });
    const ruleset = validation.ruleset;
    res.json({
      mode: "deterministic_preflight",
      claim: {
        id: result.claim.id,
        claimNumber: result.claim.claimNumber,
        carrier: result.claim.carrier,
        currentScore: result.claim.currentScore,
        currentRisk: result.claim.currentRisk,
      },
      version: {
        id: result.version.id,
        versionNumber: result.version.versionNumber,
        versionLabel: result.version.versionLabel,
        status: result.version.status,
      },
      compatible: validation.errors.length === 0,
      validation: {
        errors: validation.errors,
        warnings: validation.warnings,
      },
      coverage: {
        deskAdjusterQuestions: ruleset?.da_questions.length ?? 0,
        fieldAdjusterQuestions: ruleset?.fa_questions.length ?? 0,
        categories: ruleset?.scorecard_categories.length ?? 0,
        configuredPoints:
          (ruleset?.da_questions.reduce(
            (sum, question) => sum + question.weight,
            0,
          ) ?? 0) +
          (ruleset?.fa_questions.reduce(
            (sum, question) => sum + question.weight,
            0,
          ) ?? 0),
      },
      note:
        "This deterministic preflight does not call the AI provider or alter the representative claim.",
    });
  } catch (error) {
    platformFailure(error, res);
  }
});

router.post("/platform/carriers/:key/entities", async (req, res) => {
  if (rejectOrganizationOverride(req, res)) return;
  const context = platformContext(req, res);
  if (!context) return;
  const {
    entityKey,
    displayName,
    legalName,
    isPrimary = false,
    active = true,
    changeReason,
  } = req.body ?? {};
  if (
    typeof entityKey !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entityKey) ||
    typeof displayName !== "string" ||
    !displayName.trim() ||
    typeof changeReason !== "string" ||
    !changeReason.trim()
  ) {
    res.status(400).json({ error: "Valid carrier entity fields are required" });
    return;
  }
  try {
    const entityId = await platformUpsertCarrierEntity({
      actor: context.actor,
      organizationId: context.organizationId,
      entityKey,
      displayName: displayName.trim(),
      legalName:
        typeof legalName === "string" && legalName.trim()
          ? legalName.trim()
          : null,
      isPrimary: Boolean(isPrimary),
      active: Boolean(active),
      changeReason: changeReason.trim(),
    });
    res.status(201).json({ id: entityId });
  } catch (error) {
    platformFailure(error, res);
  }
});

router.put(
  "/platform/carriers/:key/entities/:entityId",
  async (req, res) => {
    if (rejectOrganizationOverride(req, res)) return;
    const context = platformContext(req, res);
    if (!context) return;
    const entityId = firstParam(req.params.entityId);
    const {
      entityKey,
      displayName,
      legalName,
      isPrimary,
      active,
      changeReason,
    } = req.body ?? {};
    if (
      !UUID_RE.test(entityId) ||
      typeof entityKey !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entityKey) ||
      typeof displayName !== "string" ||
      !displayName.trim() ||
      typeof isPrimary !== "boolean" ||
      typeof active !== "boolean" ||
      typeof changeReason !== "string" ||
      !changeReason.trim()
    ) {
      res.status(400).json({ error: "Valid carrier entity fields are required" });
      return;
    }
    try {
      const savedId = await platformUpsertCarrierEntity({
        actor: context.actor,
        organizationId: context.organizationId,
        entityId,
        entityKey,
        displayName: displayName.trim(),
        legalName:
          typeof legalName === "string" && legalName.trim()
            ? legalName.trim()
            : null,
        isPrimary,
        active,
        changeReason: changeReason.trim(),
      });
      res.json({ id: savedId });
    } catch (error) {
      platformFailure(error, res);
    }
  },
);

router.delete("/platform/carriers/:key", async (req, res) => {
  if (rejectOrganizationOverride(req, res)) return;
  const context = platformContext(req, res);
  if (!context) return;
  const key = normalizedCarrierKey(firstParam(req.params.key));
  try {
    const profile = await withPlatformTenantDatabase(
      req,
      res,
      getOrganizationCarrierProfile,
    );
    if (profile === undefined) return;
    if (!profile || profile.carrierKey !== key) {
      res.status(404).json({ error: "Carrier profile not found" });
      return;
    }
    for (const entity of profile.entities) {
      if (!entity.active) continue;
      await platformUpsertCarrierEntity({
        actor: context.actor,
        organizationId: context.organizationId,
        entityId: entity.id,
        entityKey: entity.entityKey,
        displayName: entity.displayName,
        legalName: entity.legalName,
        isPrimary: entity.isPrimary,
        active: false,
        changeReason: "Platform carrier profile deactivated",
      });
    }
    res.json({ success: true, deactivated: true });
  } catch (error) {
    platformFailure(error, res);
  }
});

export default router;
