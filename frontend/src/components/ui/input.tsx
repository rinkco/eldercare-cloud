import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-[6px] border border-line bg-raised px-3 text-sm text-ink",
      "placeholder:text-ink-muted/70",
      "transition-colors hover:border-line-strong focus:border-brand focus:outline-none",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "aria-invalid:border-critical",
      className
    )}
    {...props}
  />
));

Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-20 w-full rounded-[6px] border border-line bg-raised px-3 py-2 text-sm text-ink",
      "placeholder:text-ink-muted/70",
      "transition-colors hover:border-line-strong focus:border-brand focus:outline-none",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "aria-invalid:border-critical",
      className
    )}
    {...props}
  />
));

Textarea.displayName = "Textarea";

export function Label({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-[13px] text-ink-muted", className)}
      {...props}
    >
      {children}
    </label>
  );
}

export function FieldError({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <p className="mt-1 text-[12px] text-critical" role="alert">
      {children}
    </p>
  );
}
