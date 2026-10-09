"use client";

import { BarChart3, LineChart } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";

export function ChartCard({
  title,
  description,
  actions,
  loading = false,
  error = null,
  empty = false,
  emptyTitle = "暂无数据",
  emptyDescription,
  onRetry,
  height = 320,
  children,
  tableView,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  height?: number;
  children: ReactNode;
  tableView?: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <section className="rounded-[8px] border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-medium text-ink">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[12px] text-ink-muted">{description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {tableView ? (
            <div className="flex items-center gap-1 rounded-[6px] border border-line p-0.5">
              <Button
                variant={view === "chart" ? "secondary" : "ghost"}
                size="icon-sm"
                onClick={() => setView("chart")}
                aria-label="图表视图"
                aria-pressed={view === "chart"}
              >
                <LineChart />
              </Button>
              <Button
                variant={view === "table" ? "secondary" : "ghost"}
                size="icon-sm"
                onClick={() => setView("table")}
                aria-label="表格视图"
                aria-pressed={view === "table"}
              >
                <BarChart3 />
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <div style={{ minHeight: height }} className="px-3 py-3">
        {loading ? (
          <div className="flex h-full flex-col gap-3 px-1 py-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="flex-1" style={{ minHeight: height - 80 }} />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : empty ? (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        ) : view === "table" && tableView ? (
          <div className="overflow-x-auto">{tableView}</div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
