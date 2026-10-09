"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;

export function DropdownMenuTrigger({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuPrimitive.Trigger asChild>
      {children}
    </DropdownMenuPrimitive.Trigger>
  );
}

export function DropdownMenuContent({
  children,
  align = "start",
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-48 overflow-hidden rounded-[8px] border border-line-strong bg-raised p-1 shadow-[0_16px_40px_rgba(0,0,0,0.5)]",
          "animate-rise-in",
          className
        )}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  disabled,
  danger = false,
  className,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenuPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-[5px] px-2.5 py-2 text-[13px] outline-none",
        "data-[highlighted]:bg-white/8",
        danger ? "text-critical" : "text-ink",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        className
      )}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuPrimitive.Label className="px-2.5 py-1.5 text-[12px] text-ink-muted">
      {children}
    </DropdownMenuPrimitive.Label>
  );
}

export function DropdownMenuSeparator() {
  return (
    <DropdownMenuPrimitive.Separator className="my-1 h-px bg-line" />
  );
}
