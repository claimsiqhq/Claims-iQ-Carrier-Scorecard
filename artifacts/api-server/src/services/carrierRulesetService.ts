import {
  carrierEntities,
  carrierRulesets,
  carrierRulesetVersions,
  db,
  withPlatformDatabaseContext,
} from "@workspace/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import logger from "../lib/logger";
import { DA_QUESTIONS, FA_QUESTIONS } from "./questionBank";
import { CARRIER_SCORECARD_CATEGORIES } from "./carrierScorecardAudit";
import type { CarrierRulesetConfig } from "./carrierRulesetTypes";
import { carrierRulesetConfigSchema } from "./carrierRulesetTypes";

type CarrierEntityRow = typeof carrierEntities.$inferSelect;
type CarrierRulesetRow = typeof carrierRulesets.$inferSelect;
type CarrierRulesetVersionRow = typeof carrierRulesetVersions.$inferSelect;

export class CarrierRulesetUnavailableError extends Error {
  readonly code = "carrier_ruleset_unavailable";
  readonly carrierKey: string;

  constructor(carrierKey: string, message?: string) {
    super(message ?? `No valid published ruleset is available for ${carrierKey}.`);
    this.name = "CarrierRulesetUnavailableError";
    this.carrierKey = carrierKey;
  }
}

export class CarrierEntitySelectionError extends Error {
  readonly code:
    | "carrier_entity_required"
    | "carrier_entity_unavailable"
    | "foreign_carrier_entity";
  readonly status = 400;

  constructor(
    code: CarrierEntitySelectionError["code"],
    message: string,
  ) {
    super(message);
    this.name = "CarrierEntitySelectionError";
    this.code = code;
  }
}

export class ForeignCarrierMismatchError extends Error {
  readonly code = "foreign_carrier_mismatch";

  constructor(readonly detectedCarrier: string) {
    super(
      `Detected carrier "${detectedCarrier}" is not an allowed carrier entity for this organization.`,
    );
    this.name = "ForeignCarrierMismatchError";
  }
}

export interface TenantCarrierEntity {
  id: string;
  organizationId: string;
  entityKey: string;
  displayName: string;
  legalName: string | null;
  isPrimary: boolean;
  active: boolean;
}

export interface CarrierEntityOption extends TenantCarrierEntity {
  key: string;
  carrierKey: string;
  logoUrl: string | null;
}

export interface OrganizationCarrierProfile {
  id: string;
  organizationId: string;
  carrierKey: string;
  displayName: string;
  logoUrl: string | null;
  active: boolean;
  ruleset: unknown;
  entities: TenantCarrierEntity[];
  hasDraft: boolean;
  latestVersion: CarrierRulesetVersionRow | null;
  publishedVersion: CarrierRulesetVersionRow | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface OrganizationCarrierPolicy {
  organizationId: string;
  carrierKey: string;
  displayName: string;
  logoUrl: string | null;
  ruleset: CarrierRulesetConfig;
  version: CarrierRulesetVersionRow;
}

function getDefaultRuleset(): CarrierRulesetConfig {
  return {
    version: "1.0",
    da_questions: DA_QUESTIONS,
    fa_questions: FA_QUESTIONS,
    scorecard_categories: CARRIER_SCORECARD_CATEGORIES.map((c) => ({ ...c })),
  };
}

export function normalizeCarrierKey(carrier: string): string {
  return carrier
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCarrierLabel(value: string): string {
  return normalizeCarrierKey(value).replace(/-/g, " ");
}

const KNOWN_ENTITY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  allstate: [
    "allstate",
    "allstate insurance",
    "allstate insurance company",
  ],
  andover: [
    "andover",
    "andover companies",
    "the andover companies",
  ],
  "bay-state-insurance-company": [
    "bay state",
    "bay state insurance",
    "bay state insurance company",
  ],
  "cambridge-mutual": [
    "cambridge mutual",
    "cambridge mutual fire insurance company",
  ],
  "merrimack-mutual": [
    "merrimack mutual",
    "merrimack mutual fire insurance company",
  ],
  wawanesa: [
    "wawanesa",
    "wawanesa insurance",
    "wawanesa mutual insurance company",
  ],
};

function labelMatchesAlias(label: string, alias: string): boolean {
  return (
    label === alias ||
    label.startsWith(`${alias} `) ||
    label.endsWith(` ${alias}`)
  );
}

function knownEntityKeyForLabel(label: string): string | null {
  const matches = Object.entries(KNOWN_ENTITY_ALIASES)
    .flatMap(([entityKey, aliases]) =>
      aliases.map((alias) => ({
        entityKey,
        alias: normalizeCarrierLabel(alias),
      })),
    )
    .sort((left, right) => right.alias.length - left.alias.length);
  return (
    matches.find(({ alias }) => labelMatchesAlias(label, alias))?.entityKey ??
    null
  );
}

function entityMatchesLabel(
  entity: TenantCarrierEntity,
  normalizedLabel: string,
): boolean {
  const directAliases = [
    entity.entityKey,
    entity.displayName,
    entity.legalName ?? "",
    ...(KNOWN_ENTITY_ALIASES[entity.entityKey] ?? []),
  ]
    .map(normalizeCarrierLabel)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  return directAliases.some((alias) =>
    labelMatchesAlias(normalizedLabel, alias),
  );
}

export function activeCarrierEntitiesForOrganization(
  organizationId: string,
  entities: readonly TenantCarrierEntity[],
): TenantCarrierEntity[] {
  return entities.filter(
    (entity) =>
      entity.organizationId === organizationId && entity.active,
  );
}

export function selectRequestedCarrierEntity(
  organizationId: string,
  entities: readonly TenantCarrierEntity[],
  requestedCarrierEntityId?: string | null,
): TenantCarrierEntity {
  const allowed = activeCarrierEntitiesForOrganization(
    organizationId,
    entities,
  );
  if (requestedCarrierEntityId) {
    const selected = allowed.find(
      (entity) => entity.id === requestedCarrierEntityId,
    );
    if (!selected) {
      throw new CarrierEntitySelectionError(
        "foreign_carrier_entity",
        "The selected carrier entity is not active for this organization.",
      );
    }
    return selected;
  }
  if (allowed.length === 1) return allowed[0]!;
  if (allowed.length === 0) {
    throw new CarrierEntitySelectionError(
      "carrier_entity_unavailable",
      "No active carrier entity is configured for this organization.",
    );
  }
  throw new CarrierEntitySelectionError(
    "carrier_entity_required",
    "carrierEntityId is required when the organization has multiple active carrier entities.",
  );
}

export function resolveDetectedCarrierEntity(input: {
  organizationId: string;
  entities: readonly TenantCarrierEntity[];
  detectedCarrier?: string | null;
  requestedCarrierEntityId?: string | null;
}): TenantCarrierEntity {
  const allowed = activeCarrierEntitiesForOrganization(
    input.organizationId,
    input.entities,
  );
  const selected = selectRequestedCarrierEntity(
    input.organizationId,
    allowed,
    input.requestedCarrierEntityId,
  );
  const detectedCarrier = input.detectedCarrier?.trim();
  if (!detectedCarrier) return selected;

  const normalizedLabel = normalizeCarrierLabel(detectedCarrier);
  const knownEntityKey = knownEntityKeyForLabel(normalizedLabel);
  const detectedEntity =
    (knownEntityKey
      ? allowed.find((entity) => entity.entityKey === knownEntityKey)
      : undefined) ??
    allowed.find((entity) => entityMatchesLabel(entity, normalizedLabel));
  if (detectedEntity) return detectedEntity;
  if (knownEntityKey) {
    throw new ForeignCarrierMismatchError(detectedCarrier);
  }
  return selected;
}

export async function listActiveCarrierEntities(
  organizationId: string,
): Promise<TenantCarrierEntity[]> {
  return db
    .select({
      id: carrierEntities.id,
      organizationId: carrierEntities.organizationId,
      entityKey: carrierEntities.entityKey,
      displayName: carrierEntities.displayName,
      legalName: carrierEntities.legalName,
      isPrimary: carrierEntities.isPrimary,
      active: carrierEntities.active,
    })
    .from(carrierEntities)
    .where(
      and(
        eq(carrierEntities.organizationId, organizationId),
        eq(carrierEntities.active, true),
      ),
    )
    .orderBy(desc(carrierEntities.isPrimary), asc(carrierEntities.displayName));
}

export async function getOrganizationCarrierProfile(
  organizationId: string,
): Promise<OrganizationCarrierProfile | null> {
  const [profile] = await db
    .select()
    .from(carrierRulesets)
    .where(eq(carrierRulesets.organizationId, organizationId))
    .limit(1);
  if (!profile) return null;

  const [versions, entities] = await Promise.all([
    db
      .select()
      .from(carrierRulesetVersions)
      .where(
        and(
          eq(carrierRulesetVersions.organizationId, organizationId),
          eq(carrierRulesetVersions.carrierKey, profile.carrierKey),
        ),
      )
      .orderBy(desc(carrierRulesetVersions.versionNumber)),
    db
      .select()
      .from(carrierEntities)
      .where(eq(carrierEntities.organizationId, organizationId))
      .orderBy(desc(carrierEntities.isPrimary), asc(carrierEntities.displayName)),
  ]);
  const latestVersion = versions[0] ?? null;
  const publishedVersion =
    versions.find((version) => version.status === "published") ?? null;

  return {
    id: profile.id,
    organizationId,
    carrierKey: profile.carrierKey,
    displayName: latestVersion?.displayName ?? profile.displayName,
    logoUrl: latestVersion?.logoUrl ?? profile.logoUrl,
    active: Boolean(
      profile.active &&
        publishedVersion &&
        entities.some((entity) => entity.active),
    ),
    ruleset: latestVersion?.ruleset ?? profile.ruleset,
    entities,
    hasDraft: versions.some((version) => version.status === "draft"),
    latestVersion,
    publishedVersion,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export async function getOrganizationCarrierPolicy(
  organizationId: string,
  options: { allowDefault?: boolean } = {},
): Promise<OrganizationCarrierPolicy> {
  const allowDefault = options.allowDefault ?? false;
  try {
    const [profile] = await db
      .select({
        carrierKey: carrierRulesets.carrierKey,
        displayName: carrierRulesets.displayName,
        logoUrl: carrierRulesets.logoUrl,
      })
      .from(carrierRulesets)
      .where(
        and(
          eq(carrierRulesets.organizationId, organizationId),
          eq(carrierRulesets.active, true),
        ),
      )
      .limit(1);
    if (!profile) {
      if (allowDefault) {
        return {
          organizationId,
          carrierKey: "default",
          displayName: "Default",
          logoUrl: null,
          ruleset: getDefaultRuleset(),
          version: {} as CarrierRulesetVersionRow,
        };
      }
      throw new CarrierRulesetUnavailableError(
        organizationId,
        "No active carrier profile is configured for this organization.",
      );
    }

    const [version] = await db
      .select()
      .from(carrierRulesetVersions)
      .where(
        and(
          eq(carrierRulesetVersions.organizationId, organizationId),
          eq(carrierRulesetVersions.carrierKey, profile.carrierKey),
          eq(carrierRulesetVersions.status, "published"),
        ),
      )
      .limit(1);
    const parsed = carrierRulesetConfigSchema.safeParse(version?.ruleset);
    if (!version || !parsed.success) {
      if (parsed.error) {
        logger.warn(
          {
            organizationId,
            carrierKey: profile.carrierKey,
            issueCount: parsed.error.issues.length,
          },
          "Organization carrier ruleset validation failed",
        );
      }
      if (allowDefault) {
        return {
          organizationId,
          carrierKey: profile.carrierKey,
          displayName: profile.displayName,
          logoUrl: profile.logoUrl,
          ruleset: getDefaultRuleset(),
          version: version ?? ({} as CarrierRulesetVersionRow),
        };
      }
      throw new CarrierRulesetUnavailableError(
        profile.carrierKey,
        `No valid published ruleset is available for ${profile.carrierKey}.`,
      );
    }
    return {
      organizationId,
      carrierKey: profile.carrierKey,
      displayName: version.displayName,
      logoUrl: version.logoUrl,
      ruleset: parsed.data,
      version,
    };
  } catch (error) {
    if (error instanceof CarrierRulesetUnavailableError) throw error;
    logger.warn(
      { error, organizationId },
      "Organization carrier ruleset lookup failed",
    );
    if (allowDefault) {
      return {
        organizationId,
        carrierKey: "default",
        displayName: "Default",
        logoUrl: null,
        ruleset: getDefaultRuleset(),
        version: {} as CarrierRulesetVersionRow,
      };
    }
    throw new CarrierRulesetUnavailableError(
      organizationId,
      "The organization carrier ruleset could not be loaded.",
    );
  }
}

export async function getCarrierRuleset(
  organizationId: string,
  options: { allowDefault?: boolean } = {},
): Promise<CarrierRulesetConfig> {
  return (await getOrganizationCarrierPolicy(organizationId, options)).ruleset;
}

export async function listActiveCarriers(
  organizationId: string,
): Promise<CarrierEntityOption[]> {
  const profile = await getOrganizationCarrierProfile(organizationId);
  if (!profile?.active || !profile.publishedVersion) return [];
  return profile.entities
    .filter((entity) => entity.active)
    .map((entity) => ({
    ...entity,
    key: entity.entityKey,
    carrierKey: profile.carrierKey,
    logoUrl: profile.publishedVersion!.logoUrl,
  }));
}

export async function resolveRequestedCarrierEntity(
  organizationId: string,
  requestedCarrierEntityId?: string | null,
): Promise<TenantCarrierEntity> {
  const [, entities] = await Promise.all([
    getOrganizationCarrierPolicy(organizationId),
    listActiveCarrierEntities(organizationId),
  ]);
  return selectRequestedCarrierEntity(
    organizationId,
    entities,
    requestedCarrierEntityId,
  );
}

function rowsFromResult<Row>(result: unknown): Row[] {
  const rows = (result as { rows?: Row[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

export interface PlatformCarrierActor {
  userId: string;
  sessionId: string;
}

export async function platformUpsertCarrierProfile(input: {
  actor: PlatformCarrierActor;
  organizationId: string;
  carrierKey: string;
  displayName: string;
  ruleset: CarrierRulesetConfig;
  logoUrl: string | null;
  primaryEntityKey: string;
  primaryEntityName: string;
  primaryLegalName: string | null;
  changeReason: string;
}): Promise<string> {
  return withPlatformDatabaseContext(input.actor, async (database) => {
    const result = await database.execute(sql`
      SELECT private.platform_upsert_carrier_profile(
        ${input.organizationId}::uuid,
        ${input.carrierKey},
        ${input.displayName},
        ${JSON.stringify(input.ruleset)}::jsonb,
        ${input.logoUrl},
        ${input.primaryEntityKey},
        ${input.primaryEntityName},
        ${input.primaryLegalName},
        ${input.changeReason}
      ) AS profile_id
    `);
    const profileId = rowsFromResult<{ profile_id: string }>(result)[0]?.profile_id;
    if (!profileId) throw new Error("Platform carrier profile upsert returned no ID.");
    return profileId;
  });
}

export async function platformUpsertCarrierEntity(input: {
  actor: PlatformCarrierActor;
  organizationId: string;
  entityId?: string | null;
  entityKey: string;
  displayName: string;
  legalName?: string | null;
  isPrimary: boolean;
  active: boolean;
  changeReason: string;
}): Promise<string> {
  return withPlatformDatabaseContext(input.actor, async (database) => {
    const result = await database.execute(sql`
      SELECT private.platform_upsert_carrier_entity(
        ${input.organizationId}::uuid,
        ${input.entityId ?? null}::uuid,
        ${input.entityKey},
        ${input.displayName},
        ${input.legalName ?? null},
        ${input.isPrimary},
        ${input.active},
        ${input.changeReason}
      ) AS entity_id
    `);
    const entityId = rowsFromResult<{ entity_id: string }>(result)[0]?.entity_id;
    if (!entityId) throw new Error("Platform carrier entity upsert returned no ID.");
    return entityId;
  });
}

export async function platformCreateCarrierRulesetVersion(input: {
  actor: PlatformCarrierActor;
  organizationId: string;
  versionLabel: string;
  displayName: string;
  logoUrl: string | null;
  ruleset: CarrierRulesetConfig;
  validation: { errors: string[]; warnings: string[] };
  changeSummary: string;
  sourceReferences: Array<{
    label: string;
    url?: string;
    reference?: string;
  }>;
  changeReason: string;
}): Promise<string> {
  return withPlatformDatabaseContext(input.actor, async (database) => {
    const result = await database.execute(sql`
      SELECT private.platform_create_carrier_ruleset_version(
        ${input.organizationId}::uuid,
        ${input.versionLabel},
        ${input.displayName},
        ${input.logoUrl},
        ${JSON.stringify(input.ruleset)}::jsonb,
        ${JSON.stringify(input.validation)}::jsonb,
        ${input.changeSummary},
        ${JSON.stringify(input.sourceReferences)}::jsonb,
        ${input.changeReason}
      ) AS version_id
    `);
    const versionId = rowsFromResult<{ version_id: string }>(result)[0]?.version_id;
    if (!versionId) throw new Error("Platform ruleset version creation returned no ID.");
    return versionId;
  });
}

export async function platformPublishCarrierRulesetVersion(input: {
  actor: PlatformCarrierActor;
  organizationId: string;
  versionId: string;
  changeReason: string;
}): Promise<boolean> {
  return withPlatformDatabaseContext(input.actor, async (database) => {
    const result = await database.execute(sql`
      SELECT private.platform_publish_carrier_ruleset_version(
        ${input.organizationId}::uuid,
        ${input.versionId}::uuid,
        ${input.changeReason}
      ) AS published
    `);
    return Boolean(
      rowsFromResult<{ published: boolean }>(result)[0]?.published,
    );
  });
}

export function profileBelongsToOrganization(
  organizationId: string,
  profile: Pick<CarrierRulesetRow, "organizationId">,
): boolean {
  return profile.organizationId === organizationId;
}
