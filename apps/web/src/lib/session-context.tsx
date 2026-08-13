"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AUTH_UNAUTHORIZED_EVENT, TOKEN_KEY, clearAuthToken, getAuthToken } from "@/lib/auth-token";

// 兼容既有导入方（login 等）：TOKEN_KEY 单一来源 = lib/auth-token
export { TOKEN_KEY };

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
    const token = getAuthToken();
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
        clearAuthToken();
        setState({ status: "unauthenticated", user: null });
        return;
      }
      setState({ status: "authenticated", user: body.data });
    } catch {
      clearAuthToken();
      setState({ status: "unauthenticated", user: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 统一 401 收敛：apiFetch 在 401 时 dispatch AUTH_UNAUTHORIZED_EVENT，
  // 这里统一清 token + 置 unauthenticated —— 不让每个 List/Edit 页各自处理。
  useEffect(() => {
    const onUnauthorized = () => {
      clearAuthToken();
      setState({ status: "unauthenticated", user: null });
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const logout = useCallback(() => {
    clearAuthToken();
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
