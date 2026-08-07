import {
  and,
  asc,
  desc,
  eq,
} from "drizzle-orm";
import {
  auditFindings,
  audits,
  claims,
  db,
  documents,
  organizationMemberships,
  organizations,
  type OrganizationRole,
} from "@workspace/db";
import {
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
  membershipId: string;
  role: OrganizationRole;
  permissions: readonly OrganizationPermission[];
}

export async function resolveOrganizationContext(
  userId: string,
  requestedOrganizationId?: string,
): Promise<OrganizationContext | null> {
  const predicates = [eq(organizationMemberships.userId, userId)];
  if (requestedOrganizationId) {
    predicates.push(eq(organizationMemberships.organizationId, requestedOrganizationId));
  }

  const [row] = await db
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
    .where(and(...predicates))
    .orderBy(
      desc(organizationMemberships.isDefault),
      asc(organizationMemberships.joinedAt),
    )
    .limit(1);

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
      and(
        eq(claims.id, claimId),
        eq(claims.organizationId, organizationId),
      ),
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
    .innerJoin(audits, eq(audits.id, auditFindings.auditId))
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
