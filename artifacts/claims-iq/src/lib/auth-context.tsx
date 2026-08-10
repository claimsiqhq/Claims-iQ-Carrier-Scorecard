import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  api,
  ApiError,
  apiErrorMessage,
  getSelectedOrganizationId,
  SESSION_EXPIRED_EVENT,
  setSelectedOrganizationId,
} from "@/lib/api";
import type { AuthOrganization, AuthUser } from "@/lib/types";

interface AuthContextValue {
  user: AuthUser | null;
  organization: AuthOrganization | null;
  loading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  organization: null,
  loading: true,
  isAdmin: false,
  login: async () => null,
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

async function getSessionWithOrganizationFallback() {
  try {
    return await api.getSession();
  } catch (error) {
    if (
      error instanceof ApiError
      && error.status === 403
      && getSelectedOrganizationId()
    ) {
      setSelectedOrganizationId(null);
      return api.getSession();
    }
    throw error;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<AuthOrganization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSessionWithOrganizationFallback()
      .then((data) => {
        setUser(data.user ?? null);
        setOrganization(data.organization ?? null);
        if (data.organization) setSelectedOrganizationId(data.organization.id);
      })
      .catch(() => {
        setUser(null);
        setOrganization(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      queryClient.clear();
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
      const data = await api.login(email, password);
      queryClient.clear();
      const session = await getSessionWithOrganizationFallback();
      setUser(session.user ?? data.user);
      setOrganization(session.organization ?? null);
      if (session.organization) setSelectedOrganizationId(session.organization.id);
      window.sessionStorage.removeItem(SESSION_EXPIRED_EVENT);
      return null;
    } catch (error) {
      return apiErrorMessage(error, "Network error. Please try again.");
    }
  }, [queryClient]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    queryClient.clear();
    setUser(null);
    setOrganization(null);
    window.sessionStorage.removeItem(SESSION_EXPIRED_EVENT);
  }, [queryClient]);

  const isAdmin =
    user?.role === "admin" ||
    organization?.role === "owner" ||
    organization?.role === "admin";

  return (
    <AuthContext.Provider value={{ user, organization, loading, isAdmin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
