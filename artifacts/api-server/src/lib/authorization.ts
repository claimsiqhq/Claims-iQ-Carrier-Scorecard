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

export interface MembershipContextRow {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  explicitPermissions: string[];
}

export function membershipOrganizationContext(
  userId: string,
  row: MembershipContextRow,
): OrganizationContext {
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

export function resolveMembershipContext(
  userId: string,
  rows: readonly MembershipContextRow[],
  activeOrganizationId?: string | null,
): OrganizationContext | null {
  const active = activeOrganizationId
    ? rows.find((row) => row.organizationId === activeOrganizationId)
    : undefined;
  const row = active ?? rows[0];
  if (!row) return null;
  return membershipOrganizationContext(userId, row);
}

export async function listMembershipContexts(
  userId: string,
): Promise<MembershipContextRow[]> {
  return identityDb
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
    );
}

export async function resolveOrganizationContext(
  userId: string,
  activeOrganizationId?: string | null,
): Promise<OrganizationContext | null> {
  const rows = await listMembershipContexts(userId);
  return resolveMembershipContext(userId, rows, activeOrganizationId);
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
