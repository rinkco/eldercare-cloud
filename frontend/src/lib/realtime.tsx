"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AUTH_REQUIRED_EVENT } from "./api";
import { useAuth } from "./auth";
import type { RealtimeMessage } from "./types";

export type ConnectionStatus = "connecting" | "open" | "closed";

type Listener = (message: RealtimeMessage) => void;

interface RealtimeContextValue {
  status: ConnectionStatus;
  subscribe: (listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function realtimeUrl(token: string): string {
  const query = `token=${encodeURIComponent(token)}`;
  const explicit = process.env.NEXT_PUBLIC_WS_BASE;
  if (explicit) {
    return `${explicit.replace(/\/$/, "")}/api/v1/ws?${query}`;
  }
  if (process.env.NODE_ENV === "development") {
    // 开发模式：REST 走 next rewrites，WebSocket 直连后端（WS 不受 CORS 限制）
    return `ws://localhost:8080/api/v1/ws?${query}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/ws?${query}`;
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    if (!session) {
      setStatus("closed");
      return;
    }

    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let disposed = false;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      setStatus("connecting");
      socket = new WebSocket(realtimeUrl(session.token));

      socket.onopen = () => {
        attempt = 0;
        setStatus("open");
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as RealtimeMessage;
          for (const listener of listeners.current) {
            listener(message);
          }
        } catch {
          // 忽略无法解析的帧
        }
      };

      socket.onclose = (event) => {
        if (disposed) return;
        setStatus("closed");
        // 4401/4403：token 失效或权限不足，停止重连并让会话失效
        if (event.code === 4401 || event.code === 4403) {
          window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
          return;
        }
        const delay = Math.min(30_000, 1_000 * 2 ** attempt);
        attempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [session]);

  const value = useMemo(
    () => ({
      status,
      subscribe: (listener: Listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    }),
    [status]
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime 必须在 RealtimeProvider 内使用");
  }
  return context;
}
