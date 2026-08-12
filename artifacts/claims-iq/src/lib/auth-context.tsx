import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  api,
  apiErrorMessage,
  SESSION_EXPIRED_EVENT,
  setAuthenticatedQueryScope,
} from "@/lib/api";
import {
  clearLegacyOrganizationSelection,
  clearUploadRecoveryState,
} from "@/lib/tenant-state";
import type { AuthOrganization, AuthSession, AuthUser } from "@/lib/types";

interface AuthContextValue {
  user: AuthUser | null;
  organization: AuthOrganization | null;
  loading: boolean;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  canManageSettings: boolean;
  canCreateClaims: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  switchTenant: (organizationId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  organization: null,
  loading: true,
  isPlatformAdmin: false,
  isTenantAdmin: false,
  canManageSettings: false,
  canCreateClaims: false,
  login: async () => null,
  logout: async () => {},
  switchTenant: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<AuthOrganization | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((session: AuthSession) => {
    const nextUser = session.user ?? null;
    const nextOrganization = session.organization ?? null;
    setAuthenticatedQueryScope(nextUser?.id, nextOrganization?.id);
    setUser(nextUser);
    setOrganization(nextOrganization);
  }, []);

  const applyTenantTransition = useCallback(async (session: AuthSession) => {
    await queryClient.cancelQueries();
    queryClient.clear();
    clearUploadRecoveryState();
    applySession(session);
  }, [applySession, queryClient]);

  useEffect(() => {
    clearLegacyOrganizationSelection();
    api.getSession()
      .then(applySession)
      .catch(() => {
        setAuthenticatedQueryScope(null, null);
        setUser(null);
        setOrganization(null);
      })
      .finally(() => setLoading(false));
  }, [applySession]);

  useEffect(() => {
    const handleSessionExpired = () => {
      void queryClient.cancelQueries();
      queryClient.clear();
      clearUploadRecoveryState();
      setAuthenticatedQueryScope(null, null);
      setUser(null);
      setOrganization(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      await api.login(email, password);
      const session = await api.getSession();
      await queryClient.cancelQueries();
      queryClient.clear();
      clearUploadRecoveryState();
      applySession(session);
      window.sessionStorage.removeItem(SESSION_EXPIRED_EVENT);
      return null;
    } catch (error) {
      return apiErrorMessage(error, "Network error. Please try again.");
    }
  }, [applySession, queryClient]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    await queryClient.cancelQueries();
    queryClient.clear();
    clearUploadRecoveryState();
    setAuthenticatedQueryScope(null, null);
    setUser(null);
    setOrganization(null);
    window.sessionStorage.removeItem(SESSION_EXPIRED_EVENT);
  }, [queryClient]);

  const switchTenant = useCallback(async (organizationId: string) => {
    const session = await api.switchOrganization(organizationId);
    await applyTenantTransition(session);
  }, [applyTenantTransition]);

  const isPlatformAdmin = user?.platformRole === "admin";
  const isTenantAdmin = Boolean(
    organization
    && organization.accessMode !== "platform_lease"
    && (
      organization.role === "owner"
      || organization.role === "admin"
      || organization.permissions.includes("settings:manage")
    ),
  );
  const canManageSettings = Boolean(
    organization?.permissions.includes("settings:manage"),
  );
  const canCreateClaims = Boolean(organization?.permissions.includes("claims:create"));

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        loading,
        isPlatformAdmin,
        isTenantAdmin,
        canManageSettings,
        canCreateClaims,
        login,
        logout,
        switchTenant,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
