"use client";

import { Wifi, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { useRealtime } from "@/lib/realtime";

const labels = {
  connecting: "连接中",
  open: "实时在线",
  closed: "已断开",
} as const;

export function ConnectionIndicator({ compact = false }: { compact?: boolean }) {
  const { status } = useRealtime();

  return (
    <div
      className="flex items-center gap-2 text-[12px] text-ink-muted"
      role="status"
      aria-label={`实时连接状态：${labels[status]}`}
    >
      <span className="relative flex size-2">
        {status === "open" ? (
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full bg-brand/60",
              "animate-pulse-dot"
            )}
          />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            status === "open" && "bg-brand",
            status === "connecting" && "bg-warning",
            status === "closed" && "bg-critical"
          )}
        />
      </span>
      {compact ? null : <span>{labels[status]}</span>}
      {status === "open" ? (
        <Wifi className="size-3.5" aria-hidden="true" />
      ) : (
        <WifiOff className="size-3.5" aria-hidden="true" />
      )}
    </div>
  );
}
