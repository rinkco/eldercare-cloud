import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] leading-5",
  {
    variants: {
      tone: {
        neutral: "border-line bg-white/5 text-ink-muted",
        brand: "border-brand/35 bg-brand/12 text-brand",
        critical: "border-critical/35 bg-critical/12 text-critical",
        warning: "border-warning/35 bg-warning/12 text-warning",
        info: "border-info/35 bg-info/12 text-info",
        activity: "border-activity/35 bg-activity/12 text-activity",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
