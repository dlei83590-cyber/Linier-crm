"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const TOKEN_KEY = "linier_crm_token";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
}

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
}

interface SessionContextValue {
  state: SessionState;
  refresh: () => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading", user: null });

  const refresh = useCallback(async () => {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setState({ status: "unauthenticated", user: null });
      return;
    }
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: SessionUser;
      } | null;
      if (!res.ok || !body?.success || !body.data) {
        window.localStorage.removeItem(TOKEN_KEY);
        setState({ status: "unauthenticated", user: null });
        return;
      }
      setState({ status: "authenticated", user: body.data });
    } catch {
      window.localStorage.removeItem(TOKEN_KEY);
      setState({ status: "unauthenticated", user: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    setState({ status: "unauthenticated", user: null });
  }, []);

  const value = useMemo(() => ({ state, refresh, logout }), [state, refresh, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return ctx;
}
