import {
  acquireTenantDatabase,
  identityDb,
  sessionsTable,
  withPlatformDatabaseContext,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type {
  ActivePlatformTenantAccess,
  StoredPlatformTenantAccess,
} from "../lib/auth";
import { env } from "../env";

export interface PlatformTenantSummary {
  id: string;
  name: string;
  slug: string | null;
}

export interface PlatformActor {
  userId: string;
  sessionId: string;
}

export interface PlatformAccessRepository {
  listTenants(actor: PlatformActor): Promise<PlatformTenantSummary[]>;
  findActiveAccess(
    actor: PlatformActor & {
      leaseId: string;
      organizationId: string;
      expiresAt: string;
    },
  ): Promise<ActivePlatformTenantAccess | null>;
  grantAccess(
    actor: PlatformActor & {
      organizationId: string;
      reason: string;
      ttlMinutes: number;
    },
  ): Promise<ActivePlatformTenantAccess>;
  revokeAccess(
    actor: PlatformActor & { leaseId: string; reason: string },
  ): Promise<void>;
  getSessionAccess(
    actor: PlatformActor,
  ): Promise<StoredPlatformTenantAccess | null>;
  setSessionAccess(
    actor: PlatformActor,
    access: StoredPlatformTenantAccess,
  ): Promise<boolean>;
  clearSessionAccess(actor: PlatformActor): Promise<void>;
}

interface PlatformTenantRow {
  organization_id: string;
  organization_name: string;
  organization_slug: string | null;
}

function rowsFromResult<Row>(result: unknown): Row[] {
  const rows = (result as { rows?: Row[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

function storedSessionAccess(sess: unknown): StoredPlatformTenantAccess | null {
  if (!sess || typeof sess !== "object") return null;
  const access = (
    sess as { platformTenantAccess?: Partial<StoredPlatformTenantAccess> }
  ).platformTenantAccess;
  if (
    typeof access?.leaseId !== "string" ||
    typeof access.organizationId !== "string" ||
    typeof access.expiresAt !== "string"
  ) {
    return null;
  }
  return {
    leaseId: access.leaseId,
    organizationId: access.organizationId,
    expiresAt: access.expiresAt,
  };
}

async function readActiveTenantAccess(
  actor: PlatformActor & {
    leaseId: string;
    organizationId: string;
    expiresAt: string;
  },
): Promise<ActivePlatformTenantAccess | null> {
  const lease = await acquireTenantDatabase({
    userId: actor.userId,
    sessionId: actor.sessionId,
    organizationId: actor.organizationId,
  });
  try {
    const result = await lease.database.execute(sql`
      SELECT private.has_tenant_access(
        ${actor.organizationId}::uuid
      ) AS has_access
    `);
    if (!rowsFromResult<{ has_access: boolean }>(result)[0]?.has_access) {
      return null;
    }
  } finally {
    await lease.release();
  }

  const expiresAt = new Date(actor.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    return null;
  }
  const summary = (await listPlatformTenantSummaries(actor)).find(
    (tenant) => tenant.id === actor.organizationId,
  );
  if (!summary) return null;
  return {
    leaseId: actor.leaseId,
    organizationId: summary.id,
    organizationName: summary.name,
    organizationSlug: summary.slug,
    expiresAt,
  };
}

async function listPlatformTenantSummaries(
  actor: PlatformActor,
): Promise<PlatformTenantSummary[]> {
  return withPlatformDatabaseContext(actor, async (database) => {
    const result = await database.execute(sql`
        SELECT organization_id, organization_name, organization_slug
        FROM private.platform_list_tenant_summaries()
      `);
    return rowsFromResult<PlatformTenantRow>(result).map((row) => ({
      id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
    }));
  });
}

const databaseRepository: PlatformAccessRepository = {
  async listTenants(actor) {
    return listPlatformTenantSummaries(actor);
  },

  async findActiveAccess(actor) {
    return readActiveTenantAccess(actor);
  },

  async grantAccess(actor) {
    const summary = (await listPlatformTenantSummaries(actor)).find(
      (tenant) => tenant.id === actor.organizationId,
    );
    if (!summary) {
      throw new PlatformAccessInputError(
        "The requested organization does not exist.",
      );
    }
    const grant = await withPlatformDatabaseContext(actor, async (database) => {
      const result = await database.execute(sql`
        SELECT
          private.platform_create_tenant_access(
            ${actor.organizationId}::uuid,
            ${actor.reason},
            ${actor.ttlMinutes}::integer * interval '1 minute'
          ) AS lease_id,
          statement_timestamp()
            + ${actor.ttlMinutes}::integer * interval '1 minute'
            AS expires_at
      `);
      const row = rowsFromResult<{
        lease_id: string;
        expires_at: Date | string;
      }>(result)[0];
      if (!row?.lease_id || !row.expires_at) {
        throw new Error("Platform tenant access grant returned no lease.");
      }
      return row;
    });
    const expiresAt =
      grant.expires_at instanceof Date
        ? grant.expires_at
        : new Date(grant.expires_at);
    return {
      leaseId: grant.lease_id,
      organizationId: summary.id,
      organizationName: summary.name,
      organizationSlug: summary.slug,
      expiresAt,
    };
  },

  async revokeAccess(actor) {
    await withPlatformDatabaseContext(actor, async (database) => {
      await database.execute(sql`
        SELECT private.platform_revoke_tenant_access(
          ${actor.leaseId}::uuid,
          ${actor.reason}
        )
      `);
    });
  },

  async getSessionAccess(actor) {
    const [row] = await identityDb
      .select({ sess: sessionsTable.sess })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.sid, actor.sessionId),
          eq(sessionsTable.userId, actor.userId),
        ),
      )
      .limit(1);
    return storedSessionAccess(row?.sess);
  },

  async setSessionAccess(actor, access) {
    const [updated] = await identityDb
      .update(sessionsTable)
      .set({
        sess: sql`jsonb_set(
          ${sessionsTable.sess},
          '{platformTenantAccess}',
          ${JSON.stringify(access)}::jsonb,
          true
        )`,
      })
      .where(
        and(
          eq(sessionsTable.sid, actor.sessionId),
          eq(sessionsTable.userId, actor.userId),
        ),
      )
      .returning({ sid: sessionsTable.sid });
    return Boolean(updated);
  },

  async clearSessionAccess(actor) {
    await identityDb
      .update(sessionsTable)
      .set({
        sess: sql`${sessionsTable.sess} - 'platformTenantAccess'`,
      })
      .where(
        and(
          eq(sessionsTable.sid, actor.sessionId),
          eq(sessionsTable.userId, actor.userId),
        ),
      );
  },
};

export interface PlatformTenantAccessService {
  listTenants(actor: PlatformActor): Promise<PlatformTenantSummary[]>;
  enterTenant(
    actor: PlatformActor & {
      organizationId: string;
      reason: string;
    },
  ): Promise<ActivePlatformTenantAccess>;
  exitTenant(actor: PlatformActor): Promise<void>;
  resolveActive(
    actor: PlatformActor & {
      leaseId: string;
      organizationId: string;
      expiresAt: string;
    },
  ): Promise<ActivePlatformTenantAccess | null>;
}

function tenantAccessTtlMinutes(): number {
  return env.PLATFORM_TENANT_ACCESS_TTL_MINUTES;
}

export function createPlatformTenantAccessService(
  repository: PlatformAccessRepository = databaseRepository,
): PlatformTenantAccessService {
  return {
    async listTenants(actor) {
      const tenants = await repository.listTenants(actor);
      return tenants.map(({ id, name, slug }) => ({ id, name, slug }));
    },

    async enterTenant(actor) {
      const organizationId = actor.organizationId.trim();
      const reason = actor.reason.trim();
      if (!organizationId) {
        throw new PlatformAccessInputError("Organization is required.");
      }
      if (!reason) {
        throw new PlatformAccessInputError(
          "A reason for tenant access is required.",
        );
      }
      if (reason.length > 500) {
        throw new PlatformAccessInputError(
          "Tenant access reason must be 500 characters or fewer.",
        );
      }

      const existingAccess = await repository.getSessionAccess(actor);
      if (existingAccess) {
        await repository.revokeAccess({
          ...actor,
          leaseId: existingAccess.leaseId,
          reason: "Replaced by a new platform tenant access lease",
        });
      }
      const access = await repository.grantAccess({
        ...actor,
        organizationId,
        reason,
        ttlMinutes: tenantAccessTtlMinutes(),
      });
      const stored = await repository.setSessionAccess(actor, {
        leaseId: access.leaseId,
        organizationId: access.organizationId,
        expiresAt: access.expiresAt.toISOString(),
      });
      if (!stored) {
        await repository.revokeAccess({
          ...actor,
          leaseId: access.leaseId,
          reason: "Session ended before tenant access could be attached",
        });
        throw new Error("Authenticated session ended during tenant access.");
      }
      return access;
    },

    async exitTenant(actor) {
      const access = await repository.getSessionAccess(actor);
      if (access) {
        await repository.revokeAccess({
          ...actor,
          leaseId: access.leaseId,
          reason: "Platform administrator exited tenant access",
        });
      }
      await repository.clearSessionAccess(actor);
    },

    resolveActive(actor) {
      return repository.findActiveAccess(actor);
    },
  };
}

export class PlatformAccessInputError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "PlatformAccessInputError";
  }
}

export const platformTenantAccessService = createPlatformTenantAccessService();

export function resolveActivePlatformTenantAccess(
  input: PlatformActor & {
    leaseId: string;
    organizationId: string;
    expiresAt: string;
  },
): Promise<ActivePlatformTenantAccess | null> {
  return platformTenantAccessService.resolveActive(input);
}
