"use client";

import { useCallback, useEffect, useState } from "react";

import { AlertsPanel } from "@/components/alerts-client";
import { ConnectionIndicator } from "@/components/connection-indicator";
import { EventsPanel } from "@/components/events-client";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { readQueryParam, replaceQueryParam } from "@/lib/query";

type MergedView = "alerts" | "events";

/** 非法或缺失的 `?view=` 一律回落到默认的告警视图。 */
function parseView(raw: string | null): MergedView {
  return raw === "events" ? "events" : "alerts";
}

export function AlertsEventsClient() {
  // 预渲染阶段拿不到查询串，先解析地址栏再挂载列表，避免先请求错误的 Tab
  const [view, setView] = useState<MergedView | null>(null);

  useEffect(() => {
    setView(parseView(readQueryParam("view")));
  }, []);

  const handleViewChange = useCallback((next: string) => {
    const parsed = parseView(next);
    // 回写地址栏：刷新与分享保持所在视图
    replaceQueryParam("view", parsed);
    setView(parsed);
  }, []);

  return (
    <div>
      <PageHeader
        title="告警与事件"
        actions={
          <span className="hidden sm:block">
            <ConnectionIndicator />
          </span>
        }
      />

      <Tabs value={view ?? "alerts"} onValueChange={handleViewChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="alerts">告警</TabsTrigger>
          <TabsTrigger value="events">事件</TabsTrigger>
        </TabsList>
        {view === "alerts" ? (
          <TabsContent value="alerts" className="mt-0">
            <AlertsPanel />
          </TabsContent>
        ) : null}
        {view === "events" ? (
          <TabsContent value="events" className="mt-0">
            <EventsPanel />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
