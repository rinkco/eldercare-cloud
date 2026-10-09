"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[6px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-brand text-[#07120e] hover:bg-[#4dbf9a] active:bg-[#369a7b]",
        secondary:
          "border border-line bg-raised text-ink hover:border-line-strong hover:bg-[#252b33]",
        ghost: "text-ink-muted hover:bg-white/5 hover:text-ink",
        danger:
          "bg-critical text-white hover:bg-[#ea6a5b] active:bg-[#c94e3f]",
        outline:
          "border border-line-strong bg-transparent text-ink hover:bg-white/5",
      },
      size: {
        sm: "h-8 px-3 text-[13px] [&_svg]:size-4",
        md: "h-9 px-4 text-sm [&_svg]:size-4",
        lg: "h-10 px-5 text-sm [&_svg]:size-4",
        icon: "size-9 [&_svg]:size-4",
        "icon-sm": "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);

Button.displayName = "Button";

export { buttonVariants };
