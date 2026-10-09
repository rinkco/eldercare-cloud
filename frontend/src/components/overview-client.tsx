"use client";

import {
  Activity,
  BellRing,
  Cpu,
  HeartPulse,
  RefreshCw,
  ScrollText,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConnectionIndicator } from "@/components/connection-indicator";
import { KpiCard } from "@/components/kpi-card";
import {
  AlertStatusBadge,
  EventTypeBadge,
  SeverityBadge,
} from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorState } from "@/components/ui/states";
import {
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrapper,
} from "@/components/ui/table";
import { api, buildQuery } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  DEVICE_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  METRIC_LABELS,
  formatDateTime,
  formatNumber,
  formatRelative,
  formatTime,
  labelOf,
} from "@/lib/format";
import { useRealtime } from "@/lib/realtime";
import type {
  Alert,
  Device,
  Elder,
  EventRecord,
  RealtimeMessage,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface LiveItem {
  key: string;
  kind: "alert" | "telemetry";
  title: string;
  detail: string;
  at: string;
  flash?: boolean;
}

function startOfTodayIso(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export function OverviewClient() {
  const { session } = useAuth();
  const { subscribe } = useRealtime();
  const [elders, setElders] = useState<Elder[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [todayEvents, setTodayEvents] = useState<EventRecord[]>([]);
  const [liveItems, setLiveItems] = useState<LiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);

  const isAdmin = session?.role === "admin";

  const load = useCallback(async () => {
    if (!session) return;
    const today = startOfTodayIso();
    try {
      const [elderList, alertList, eventList] = await Promise.all([
        api.get<Elder[]>("/api/v1/elders"),
        api.get<Alert[]>(`/api/v1/alerts${buildQuery({ limit: 500 })}`),
        api.get<EventRecord[]>(
          `/api/v1/events${buildQuery({ start: today, limit: 500 })}`
        ),
      ]);
      setElders(elderList);
      setAlerts(alertList);
      setTodayEvents(eventList);
      if (isAdmin) {
        const deviceList = await api.get<Device[]>("/api/v1/devices");
        setDevices(deviceList);
      } else {
        setDevices([]);
      }
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "加载概览数据失败"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  // 轮询兜底：WebSocket 断线期间列表仍能更新
  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribe((message: RealtimeMessage) => {
      if (message.type === "alert") {
        const alert = message.alert;
        const key = `alert-${alert.id}`;
        setLiveItems((current) =>
          [
            {
              key,
              kind: "alert" as const,
              title: `${alert.elder_name} · ${labelOf(EVENT_TYPE_LABELS, alert.event_type)}`,
              detail: `告警 #${alert.id}`,
              at: alert.occurred_at,
              flash: true,
            },
            ...current,
          ].slice(0, 12)
        );
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => {
          setLiveItems((current) =>
            current.map((item) => ({ ...item, flash: false }))
          );
        }, 1_300);
        void load();
      } else if (message.type === "telemetry") {
        const telemetry = message.telemetry;
        const value =
          telemetry.value_num !== null && telemetry.value_num !== undefined
            ? formatNumber(telemetry.value_num)
            : (telemetry.value_text ?? "—");
        setLiveItems((current) =>
          [
            {
              key: `telemetry-${telemetry.elder_id}-${telemetry.metric}-${telemetry.recorded_at}`,
              kind: "telemetry" as const,
              title: `${labelOf(METRIC_LABELS, telemetry.metric)} ${value}`,
              detail: telemetry.device_uid,
              at: telemetry.recorded_at,
            },
            ...current,
          ].slice(0, 12)
        );
      }
    });
    return () => {
      unsubscribe();
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, [subscribe, load]);

  const elderNames = useMemo(
    () => new Map(elders.map((elder) => [elder.id, elder.name])),
    [elders]
  );

  const pendingAlerts = alerts.filter((alert) => alert.status === "new");
  const onlineDevices = devices.filter((device) => device.status === "online");
  const recentAlerts = alerts.slice(0, 8);

  const deviceStats = useMemo(() => {
    const total = devices.length || 1;
    return (["online", "offline", "disabled"] as const).map((status) => {
      const count = devices.filter((device) => device.status === status).length;
      return {
        status,
        count,
        percent: Math.round((count / total) * 100),
      };
    });
  }, [devices]);

  return (
    <div>
      <PageHeader
        title="概览台"
        actions={
          <Button
            variant="secondary"
            size="sm"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            刷新
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={isAdmin ? "老人档案" : "可见老人"}
          value={elders.length}
          unit="人"
          icon={<UserRound className="size-4" />}
          tone="info"
          hint={isAdmin ? "全部在册老人" : "仅统计与你关联的老人"}
        />
        {isAdmin ? (
          <KpiCard
            label="在线设备"
            value={onlineDevices.length}
            unit={`/ ${devices.length} 台`}
            icon={<Cpu className="size-4" />}
            tone="brand"
            hint="正在上报数据的终端"
          />
        ) : (
          <KpiCard
            label="今日告警"
            value={
              alerts.filter(
                (alert) => alert.created_at >= startOfTodayIso()
              ).length
            }
            unit="条"
            icon={<BellRing className="size-4" />}
            tone="warning"
            hint="设备侧仅管理员可见"
          />
        )}
        <KpiCard
          label="未处理告警"
          value={pendingAlerts.length}
          unit="条"
          icon={<BellRing className="size-4" />}
          tone={pendingAlerts.length > 0 ? "critical" : "brand"}
          hint={pendingAlerts.length > 0 ? "需要尽快确认" : "全部已处理"}
        />
        <KpiCard
          label="今日事件"
          value={todayEvents.length}
          unit="条"
          icon={<ScrollText className="size-4" />}
          tone="neutral"
          hint="设备上报的原始事件"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <section className="rounded-[8px] border border-line bg-panel">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[15px] font-medium text-ink">最新告警</h2>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                按创建时间倒序，显示最近 8 条
              </p>
            </div>
            <Link
              href="/alerts"
              className="text-[13px] text-brand transition-colors hover:text-[#56c3a1]"
            >
              前往告警中心
            </Link>
          </header>
          {loading ? (
            <div className="px-4 py-10 text-center text-[13px] text-ink-muted">
              正在加载告警…
            </div>
          ) : recentAlerts.length === 0 ? (
            <EmptyState
              title="暂无告警"
              description="设备触发跌倒、SOS 或围栏越界后，告警会出现在这里。"
            />
          ) : (
            <TableWrapper className="rounded-none border-0">
              <Table className="min-w-[560px]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>时间</TH>
                    <TH>老人</TH>
                    <TH>类型</TH>
                    <TH>等级</TH>
                    <TH>状态</TH>
                  </TR>
                </THead>
                <TBody>
                  {recentAlerts.map((alert) => (
                    <TR key={alert.id}>
                      <TD className="whitespace-nowrap text-ink-muted">
                        <span title={formatRelative(alert.created_at)}>
                          {formatDateTime(alert.created_at)}
                        </span>
                      </TD>
                      <TD>{elderNames.get(alert.elder_id) ?? `#${alert.elder_id}`}</TD>
                      <TD>
                        <EventTypeBadge type={alert.event_type} />
                      </TD>
                      <TD>
                        <SeverityBadge severity={alert.severity} />
                      </TD>
                      <TD>
                        <AlertStatusBadge status={alert.status} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </section>

        <div className="flex flex-col gap-4">
          <section className="rounded-[8px] border border-line bg-panel">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-[15px] font-medium text-ink">实时流</h2>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  告警与遥测摘要
                </p>
              </div>
              <Activity className="size-4 text-brand" aria-hidden="true" />
            </header>
            <div className="max-h-[320px] overflow-y-auto px-2 py-2">
              {liveItems.length === 0 ? (
                <EmptyState
                  title="等待实时消息"
                  description="新告警与遥测会在 1 秒内出现在这里。"
                  className="py-8"
                />
              ) : (
                <ul className="space-y-1">
                  {liveItems.map((item) => (
                    <li
                      key={item.key}
                      className={cn(
                        "flex items-start gap-3 rounded-[6px] px-2.5 py-2",
                        item.flash && "animate-alert-flash"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1 flex size-6 shrink-0 items-center justify-center rounded-[6px]",
                          item.kind === "alert"
                            ? "bg-critical/12 text-critical"
                            : "bg-brand/12 text-brand"
                        )}
                        aria-hidden="true"
                      >
                        {item.kind === "alert" ? (
                          <BellRing className="size-3.5" />
                        ) : (
                          <HeartPulse className="size-3.5" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">
                          {item.title}
                        </span>
                        <span className="block truncate text-[12px] text-ink-muted">
                          {item.detail}
                        </span>
                      </span>
                      <span className="shrink-0 pt-0.5 text-[12px] tabular-nums text-ink-muted">
                        {formatTime(item.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {isAdmin ? (
            <section className="rounded-[8px] border border-line bg-panel">
              <header className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <h2 className="text-[15px] font-medium text-ink">设备状态</h2>
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    共 {devices.length} 台终端
                  </p>
                </div>
                <Link
                  href="/devices"
                  className="text-[13px] text-brand transition-colors hover:text-[#56c3a1]"
                >
                  管理设备
                </Link>
              </header>
              <div className="space-y-3 px-4 py-4">
                {deviceStats.map((item) => (
                  <div key={item.status}>
                    <div className="mb-1.5 flex items-center justify-between text-[12px]">
                      <span className="text-ink-muted">
                        {labelOf(DEVICE_STATUS_LABELS, item.status)}
                      </span>
                      <span className="tabular-nums text-ink">
                        {item.count} 台
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          item.status === "online" && "bg-brand",
                          item.status === "offline" && "bg-warning",
                          item.status === "disabled" && "bg-ink-muted/50"
                        )}
                        style={{ width: `${item.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
