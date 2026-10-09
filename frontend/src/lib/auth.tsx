"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api, AUTH_REQUIRED_EVENT, setTokenGetter } from "./api";
import type { Role, Session } from "./types";

const STORAGE_KEY = "eldercare.session";

interface AuthContextValue {
  session: Session | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<Session>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (
      typeof parsed?.token === "string" &&
      typeof parsed?.expiresAt === "number" &&
      parsed.expiresAt > Date.now()
    ) {
      return parsed;
    }
  } catch {
    // 损坏的会话数据按未登录处理
  }
  window.sessionStorage.removeItem(STORAGE_KEY);
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const sessionRef = useRef<Session | null>(null);

  const applySession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
    if (typeof window !== "undefined") {
      if (next) {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } else {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    setTokenGetter(() => sessionRef.current?.token ?? null);
    applySession(readStoredSession());
    setReady(true);
  }, [applySession]);

  const logout = useCallback(() => {
    applySession(null);
  }, [applySession]);

  useEffect(() => {
    window.addEventListener(AUTH_REQUIRED_EVENT, logout);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, logout);
  }, [logout]);

  useEffect(() => {
    if (!session) return;
    const remaining = session.expiresAt - Date.now();
    if (remaining <= 0) {
      logout();
      return;
    }
    const timer = window.setTimeout(logout, remaining);
    return () => window.clearTimeout(timer);
  }, [session, logout]);

  const login = useCallback(
    async (username: string, password: string) => {
      const token = await api.login(username, password);
      const next: Session = {
        token: token.access_token,
        role: token.role as Role,
        username,
        expiresAt: Date.now() + token.expires_in * 1000,
      };
      applySession(next);
      return next;
    },
    [applySession]
  );

  const value = useMemo(
    () => ({ session, ready, login, logout }),
    [session, ready, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth 必须在 AuthProvider 内使用");
  }
  return context;
}
