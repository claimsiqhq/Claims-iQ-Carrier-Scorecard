import { and, asc, desc, eq } from "drizzle-orm";
import {
  auditFindings,
  audits,
  claims,
  db,
  documents,
  identityDb,
  organizationMemberships,
  organizations,
  type OrganizationRole,
} from "@workspace/db";
import {
  ALL_ORGANIZATION_PERMISSIONS,
  permissionsForRole,
  type OrganizationPermission,
} from "./authorizationPolicy";

export {
  hasOrganizationPermission,
  organizationScopeMatches,
  type OrganizationPermission,
} from "./authorizationPolicy";

export interface OrganizationContext {
  organizationId: string;
  organizationName: string;
  userId: string;
  membershipId: string | null;
  role: OrganizationRole | "platform_admin";
  permissions: readonly OrganizationPermission[];
  accessMode: "membership" | "platform_lease";
  accessExpiresAt: Date | null;
  accessLeaseId: string | null;
}

export class MultipleOrganizationMembershipsError extends Error {
  constructor(readonly userId: string) {
    super("Multiple organization memberships require explicit platform access");
    this.name = "MultipleOrganizationMembershipsError";
  }
}

interface MembershipContextRow {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  explicitPermissions: string[];
}

export function resolveSingleMembershipContext(
  userId: string,
  rows: readonly MembershipContextRow[],
): OrganizationContext | null {
  if (rows.length > 1) {
    throw new MultipleOrganizationMembershipsError(userId);
  }
  const row = rows[0];
  if (!row) return null;

  return {
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    userId,
    membershipId: row.membershipId,
    role: row.role,
    permissions: permissionsForRole(
      row.role,
      Array.isArray(row.explicitPermissions) ? row.explicitPermissions : [],
    ),
    accessMode: "membership",
    accessExpiresAt: null,
    accessLeaseId: null,
  };
}

export async function resolveOrganizationContext(
  userId: string,
): Promise<OrganizationContext | null> {
  const rows = await identityDb
    .select({
      membershipId: organizationMemberships.id,
      organizationId: organizationMemberships.organizationId,
      organizationName: organizations.name,
      role: organizationMemberships.role,
      explicitPermissions: organizationMemberships.permissions,
    })
    .from(organizationMemberships)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMemberships.organizationId),
    )
    .where(eq(organizationMemberships.userId, userId))
    .orderBy(
      desc(organizationMemberships.isDefault),
      asc(organizationMemberships.joinedAt),
    )
    .limit(2);

  return resolveSingleMembershipContext(userId, rows);
}

export function platformLeaseOrganizationContext(input: {
  userId: string;
  leaseId: string;
  organizationId: string;
  organizationName: string;
  expiresAt: Date;
}): OrganizationContext {
  return {
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    userId: input.userId,
    membershipId: null,
    role: "platform_admin",
    permissions: [...ALL_ORGANIZATION_PERMISSIONS],
    accessMode: "platform_lease",
    accessExpiresAt: input.expiresAt,
    accessLeaseId: input.leaseId,
  };
}

export async function getAuthorizedClaim(
  organizationId: string,
  claimId: string,
) {
  const [claim] = await db
    .select()
    .from(claims)
    .where(
      and(eq(claims.id, claimId), eq(claims.organizationId, organizationId)),
    )
    .limit(1);
  return claim;
}

export async function getAuthorizedDocument(
  organizationId: string,
  documentId: string,
  claimId?: string,
) {
  const predicates = [
    eq(documents.id, documentId),
    eq(documents.organizationId, organizationId),
  ];
  if (claimId) predicates.push(eq(documents.claimId, claimId));

  const [document] = await db
    .select()
    .from(documents)
    .where(and(...predicates))
    .limit(1);
  return document;
}

export async function getCurrentAuthorizedAudit(
  organizationId: string,
  claimId: string,
) {
  const [audit] = await db
    .select()
    .from(audits)
    .where(
      and(
        eq(audits.organizationId, organizationId),
        eq(audits.claimId, claimId),
      ),
    )
    .orderBy(desc(audits.versionNumber), desc(audits.createdAt))
    .limit(1);
  return audit;
}

export async function getAuthorizedFinding(
  organizationId: string,
  claimId: string,
  findingId: string,
) {
  const [finding] = await db
    .select({ finding: auditFindings })
    .from(auditFindings)
    .innerJoin(
      audits,
      and(
        eq(audits.id, auditFindings.auditId),
        eq(audits.organizationId, auditFindings.organizationId),
      ),
    )
    .where(
      and(
        eq(auditFindings.id, findingId),
        eq(auditFindings.organizationId, organizationId),
        eq(audits.organizationId, organizationId),
        eq(audits.claimId, claimId),
      ),
    )
    .limit(1);
  return finding?.finding;
}
