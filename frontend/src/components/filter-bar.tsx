import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function FilterBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-end gap-3 rounded-[8px] border border-line bg-panel px-4 py-3",
        className
      )}
    >
      {children}
    </div>
  );
}

export function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[12px] text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
