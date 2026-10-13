"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// 右侧抽屉：以 Radix Dialog 为基座，Esc 关闭与焦点圈定由 Radix 提供；
// aria-modal 由本组件在 Content 上显式声明（Radix DialogContent 只渲染 role="dialog"）

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  children,
  className,
  title,
  description,
  onCloseAutoFocus,
}: {
  children: ReactNode;
  className?: string;
  title: string;
  description?: string;
  /**
   * 关闭后的焦点归还。未使用 `SheetTrigger` 时 Radix 找不到触发元素，
   * 会把焦点丢在 body 上；调用方可用本回调把焦点还给当初的触发按钮，
   * 并 `preventDefault()` 覆盖 Radix 的默认行为。
   */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        aria-modal="true"
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[min(92vw,420px)] flex-col",
          "border-l border-line-strong bg-panel shadow-[-24px_0_64px_rgba(0,0,0,0.55)]",
          "animate-slide-in-right",
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-[17px] font-medium text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] text-ink-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            className="rounded-[6px] p-1 text-ink-muted transition-colors hover:bg-white/5 hover:text-ink"
            aria-label="关闭"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
