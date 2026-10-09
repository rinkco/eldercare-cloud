import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-skeleton rounded-[6px] bg-white/8", className)}
      aria-hidden="true"
      {...props}
    />
  );
}
