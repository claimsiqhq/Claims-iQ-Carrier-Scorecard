import type { SessionUser } from "./auth";
import type { OrganizationContext } from "./authorization";

export function authSessionResponse(
  user: SessionUser,
  organization: OrganizationContext | null | undefined,
) {
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      role: user.role,
      platformRole: user.platformRole,
    },
    organization: organization
      ? {
          id: organization.organizationId,
          name: organization.organizationName,
          role: organization.role,
          permissions: [...organization.permissions],
          accessMode: organization.accessMode,
          accessExpiresAt: organization.accessExpiresAt?.toISOString() ?? null,
        }
      : null,
  };
}
