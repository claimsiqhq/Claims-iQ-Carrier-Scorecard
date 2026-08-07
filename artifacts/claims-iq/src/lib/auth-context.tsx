import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api, apiErrorMessage } from "@/lib/api";
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<AuthOrganization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSession()
      .then((data) => {
        setUser(data.user ?? null);
        setOrganization(data.organization ?? null);
      })
      .catch(() => {
        setUser(null);
        setOrganization(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const data = await api.login(email, password);
      setUser(data.user);
      const session = await api.getSession();
      setOrganization(session.organization ?? null);
      return null;
    } catch (error) {
      return apiErrorMessage(error, "Network error. Please try again.");
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setOrganization(null);
  }, []);

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
