"use client";

import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./button";
import { Skeleton } from "./skeleton";
import { TBody, TD, THead, TH, TR, Table } from "./table";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-6 py-14 text-center ${className ?? ""}`}
    >
      <Inbox className="size-6 text-ink-muted/70" aria-hidden="true" />
      <p className="text-sm text-ink">{title}</p>
      {description ? (
        <p className="max-w-md text-[13px] leading-6 text-ink-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-6 py-14 text-center ${className ?? ""}`}
      role="alert"
    >
      <AlertTriangle className="size-6 text-critical" aria-hidden="true" />
      <p className="text-sm text-ink">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw />
          重试
        </Button>
      ) : null}
    </div>
  );
}

export function TableSkeleton({
  rows = 6,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          {Array.from({ length: columns }).map((_, index) => (
            <TH key={index}>
              <Skeleton className="h-3 w-16" />
            </TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <TR key={rowIndex} className="hover:bg-transparent">
            {Array.from({ length: columns }).map((__, columnIndex) => (
              <TD key={columnIndex}>
                <Skeleton className="h-3.5 w-full max-w-32" />
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
