import type { ReactNode } from "react";

import { AnimatedNumber } from "@/components/animated-number";
import { cn } from "@/lib/utils";

type Tone = "brand" | "critical" | "warning" | "info" | "neutral";

const toneStyles: Record<Tone, string> = {
  brand: "border-brand/25 bg-brand/10 text-brand",
  critical: "border-critical/25 bg-critical/10 text-critical",
  warning: "border-warning/25 bg-warning/10 text-warning",
  info: "border-info/25 bg-info/10 text-info",
  neutral: "border-line bg-white/5 text-ink-muted",
};

export function KpiCard({
  label,
  value,
  unit,
  icon,
  hint,
  tone = "neutral",
  format,
}: {
  label: string;
  value: number;
  unit?: string;
  icon: ReactNode;
  hint?: string;
  tone?: Tone;
  format?: (value: number) => string;
}) {
  return (
    <div className="rounded-[8px] border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] text-ink-muted">{label}</p>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-[7px] border",
            toneStyles[tone]
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[34px] font-medium leading-9">
          <AnimatedNumber value={value} format={format} />
        </span>
        {unit ? (
          <span className="text-[13px] text-ink-muted">{unit}</span>
        ) : null}
      </p>
      {hint ? (
        <p className="mt-1.5 text-[12px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
