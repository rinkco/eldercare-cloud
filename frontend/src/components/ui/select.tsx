"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

// Radix Select 不允许 value=""，用哨兵值表示“全部/不限”选项
const ALL_VALUE = "__eldercare_all__";

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "请选择",
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <SelectPrimitive.Root
      value={value === "" ? ALL_VALUE : value || undefined}
      onValueChange={(next) =>
        onValueChange(next === ALL_VALUE ? "" : next)
      }
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-[6px] border border-line bg-raised px-3 text-sm text-ink",
          "transition-colors hover:border-line-strong focus:border-brand focus:outline-none",
          "data-[placeholder]:text-ink-muted/70 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-ink-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[6px] border border-line-strong bg-raised shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value === "" ? ALL_VALUE : option.value}
                className="relative flex cursor-pointer select-none items-center rounded-[4px] py-1.5 pl-8 pr-3 text-sm text-ink outline-none data-[highlighted]:bg-white/8"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2">
                  <Check className="size-3.5 text-brand" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
