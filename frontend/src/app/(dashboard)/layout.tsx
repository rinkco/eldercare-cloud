"use client";

import { Activity } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { RealtimeProvider } from "@/lib/realtime";

function BootSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <div className="flex items-center gap-2 text-ink-muted">
        <Activity className="size-4 animate-pulse-dot text-brand" />
        <span className="text-[13px]">正在加载工作台…</span>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) {
      router.replace("/login/");
    }
  }, [ready, session, router]);

  if (!ready || !session) {
    return <BootSplash />;
  }

  return (
    <RealtimeProvider>
      <AppShell>{children}</AppShell>
    </RealtimeProvider>
  );
}
