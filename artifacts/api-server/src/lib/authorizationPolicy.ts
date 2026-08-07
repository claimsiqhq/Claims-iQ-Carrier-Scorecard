export type OrganizationRoleName =
  | "owner"
  | "admin"
  | "auditor"
  | "reviewer"
  | "member"
  | "viewer";

export type OrganizationPermission =
  | "claims:read"
  | "claims:create"
  | "claims:update"
  | "claims:delete"
  | "claims:assign"
  | "audits:run"
  | "findings:review"
  | "jobs:read"
  | "jobs:cancel"
  | "jobs:retry"
  | "views:manage"
  | "settings:manage"
  | "email:send";

export const ALL_ORGANIZATION_PERMISSIONS: readonly OrganizationPermission[] = [
  "claims:read",
  "claims:create",
  "claims:update",
  "claims:delete",
  "claims:assign",
  "audits:run",
  "findings:review",
  "jobs:read",
  "jobs:cancel",
  "jobs:retry",
  "views:manage",
  "settings:manage",
  "email:send",
];

const ROLE_PERMISSIONS: Record<
  OrganizationRoleName,
  readonly OrganizationPermission[]
> = {
  owner: ALL_ORGANIZATION_PERMISSIONS,
  admin: ALL_ORGANIZATION_PERMISSIONS,
  auditor: [
    "claims:read",
    "claims:create",
    "claims:update",
    "claims:assign",
    "audits:run",
    "findings:review",
    "jobs:read",
    "jobs:cancel",
    "jobs:retry",
    "views:manage",
    "email:send",
  ],
  reviewer: [
    "claims:read",
    "claims:update",
    "claims:assign",
    "findings:review",
    "jobs:read",
    "views:manage",
    "email:send",
  ],
  member: [
    "claims:read",
    "claims:create",
    "claims:update",
    "audits:run",
    "jobs:read",
    "jobs:retry",
    "views:manage",
    "email:send",
  ],
  viewer: [
    "claims:read",
    "jobs:read",
    "views:manage",
  ],
};

export function permissionsForRole(
  role: OrganizationRoleName,
  explicitPermissions: readonly string[] = [],
): readonly OrganizationPermission[] {
  const explicit = explicitPermissions.filter(
    (value): value is OrganizationPermission =>
      ALL_ORGANIZATION_PERMISSIONS.includes(value as OrganizationPermission),
  );
  return [...new Set([...ROLE_PERMISSIONS[role], ...explicit])];
}

export function hasOrganizationPermission(
  context: { permissions: readonly OrganizationPermission[] },
  permission: OrganizationPermission,
): boolean {
  return context.permissions.includes(permission);
}

export function organizationScopeMatches(
  organizationId: string | null | undefined,
  expectedOrganizationId: string,
): boolean {
  return organizationId === expectedOrganizationId;
}
