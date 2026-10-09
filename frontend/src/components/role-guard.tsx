"use client";

import { ShieldX } from "lucide-react";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";

export function RoleGuard({
  allow,
  children,
}: {
  allow: Role[];
  children: ReactNode;
}) {
  const { session } = useAuth();
  if (session && !allow.includes(session.role)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] border border-line bg-panel px-6 py-20 text-center">
        <ShieldX className="size-7 text-critical" aria-hidden="true" />
        <p className="text-[15px] text-ink">当前账号无权访问此页面</p>
        <p className="max-w-md text-[13px] leading-6 text-ink-muted">
          此功能仅对管理员开放。如需操作，请使用管理员账号登录。
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
