"use client";

import { BellRing, Check, Eye, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ElderSelect, useElderList } from "@/components/elder-select";
import { FilterBar, FilterField } from "@/components/filter-bar";
import {
  AlertStatusBadge,
  EventTypeBadge,
  SeverityBadge,
} from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import {
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrapper,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, buildQuery } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  EVENT_TYPE_LABELS,
  formatDateTime,
  formatFullDateTime,
  formatRelative,
  labelOf,
} from "@/lib/format";
import { useRealtime } from "@/lib/realtime";
import type { Alert, NotificationRecord, RealtimeMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

type AlertStatusFilter = "" | "new" | "handled";
type TimeRangeFilter = "all" | "today" | "7d";
type AlertLoadOptions = {
  showLoading?: boolean;
  manualRefresh?: boolean;
};

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "new", label: "未处理" },
  { value: "handled", label: "已处理" },
];

const TIME_OPTIONS = [
  { value: "all", label: "全部时间" },
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
];

const NOTIFICATION_STATUS_LABELS: Record<string, string> = {
  pending: "待发送",
  sent: "已发送",
  failed: "发送失败",
};

const CHANNEL_LABELS: Record<string, string> = {
  console: "控制台",
  sms: "短信",
  phone: "电话",
  wechat: "微信",
};

function withinTimeRange(createdAt: string, range: TimeRangeFilter): boolean {
  if (range === "all") return true;
  const time = new Date(createdAt).getTime();
  if (Number.isNaN(time)) return false;
  if (range === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return time >= start.getTime();
  }
  return time >= Date.now() - 7 * 24 * 60 * 60 * 1000;
}

function NotificationStatusBadge({ status }: { status: string }) {
  const tone =
    status === "sent"
      ? "brand"
      : status === "failed"
        ? "critical"
        : status === "pending"
          ? "warning"
          : "neutral";
  return <Badge tone={tone}>{labelOf(NOTIFICATION_STATUS_LABELS, status)}</Badge>;
}

/** 告警列表面板：作为「告警与事件」页的告警 Tab 内容渲染（页面标题由容器提供）。 */
export function AlertsPanel() {
  const { session } = useAuth();
  const { subscribe } = useRealtime();
  const { toast } = useToast();
  const { elders } = useElderList();

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>("");
  const [elderFilter, setElderFilter] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRangeFilter>("all");
  const [selectedAlertId, setSelectedAlertId] = useState<number | null>(null);
  const [ackingId, setAckingId] = useState<number | null>(null);
  const [flashIds, setFlashIds] = useState<Set<number>>(new Set());
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(
    null
  );
  const [notificationsReloadKey, setNotificationsReloadKey] = useState(0);

  const alertIdsRef = useRef<Set<number>>(new Set());
  const flashTimers = useRef<Map<number, number>>(new Map());
  // 列表请求序号：丢弃过期响应，避免刷新/轮询覆盖确认后的最新状态
  const listRequestSeq = useRef(0);

  const load = useCallback(
    async ({
      showLoading = true,
      manualRefresh = false,
    }: AlertLoadOptions = {}) => {
      if (!session) {
        if (manualRefresh) setRefreshing(false);
        return;
      }
      const seq = ++listRequestSeq.current;
      if (showLoading) setLoading(true);
      try {
        const data = await api.get<Alert[]>(
          `/api/v1/alerts${buildQuery({ limit: 500 })}`
        );
        if (seq !== listRequestSeq.current) return;
        setAlerts(data);
        setError(null);
      } catch (caught) {
        if (seq !== listRequestSeq.current) return;
        setError(
          caught instanceof Error ? caught.message : "加载告警列表失败"
        );
      } finally {
        if (manualRefresh) setRefreshing(false);
        if (seq === listRequestSeq.current) setLoading(false);
      }
    },
    [session]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    alertIdsRef.current = new Set(alerts.map((alert) => alert.id));
  }, [alerts]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      void load({ showLoading: false });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [session, load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const elderId = params.get("elder_id");
    const status = params.get("status");
    if (elderId && /^\d+$/.test(elderId)) setElderFilter(elderId);
    if (status === "new" || status === "handled") setStatusFilter(status);
  }, []);

  const markFlash = useCallback((alertId: number) => {
    setFlashIds((current) => {
      const next = new Set(current);
      next.add(alertId);
      return next;
    });
    const previous = flashTimers.current.get(alertId);
    if (previous !== undefined) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      setFlashIds((current) => {
        const next = new Set(current);
        next.delete(alertId);
        return next;
      });
      flashTimers.current.delete(alertId);
    }, 1_200);
    flashTimers.current.set(alertId, timer);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribe((message: RealtimeMessage) => {
      if (message.type === "ready") {
        // WS 首连/重连后全量补齐断线期间漏掉的告警
        void load({ showLoading: false });
        return;
      }
      if (message.type !== "alert") return;
      const incoming = message.alert;
      if (alertIdsRef.current.has(incoming.id)) return;

      const nextAlert: Alert = {
        id: incoming.id,
        event_id: incoming.event_id,
        elder_id: incoming.elder_id,
        status: incoming.status,
        created_at: incoming.occurred_at,
        handled_at: null,
        handled_by: null,
        event_type: incoming.event_type,
        severity: incoming.severity,
      };

      alertIdsRef.current.add(incoming.id);
      setAlerts((current) => {
        if (current.some((alert) => alert.id === incoming.id)) return current;
        return [nextAlert, ...current];
      });
      markFlash(incoming.id);
    });

    return () => {
      unsubscribe();
      for (const timer of flashTimers.current.values()) {
        window.clearTimeout(timer);
      }
      flashTimers.current.clear();
    };
  }, [subscribe, markFlash, load]);

  useEffect(() => {
    if (selectedAlertId === null) {
      setNotifications([]);
      setNotificationsError(null);
      return;
    }

    const controller = new AbortController();
    setNotificationsLoading(true);
    setNotificationsError(null);
    api
      .get<NotificationRecord[]>(
        `/api/v1/alerts/${selectedAlertId}/notifications`,
        controller.signal
      )
      .then((data) => setNotifications(data))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        setNotificationsError(
          caught instanceof Error ? caught.message : "加载通知记录失败"
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setNotificationsLoading(false);
      });

    return () => controller.abort();
  }, [selectedAlertId, notificationsReloadKey]);

  const elderNames = useMemo(
    () => new Map(elders.map((elder) => [elder.id, elder.name])),
    [elders]
  );

  const pendingCount = useMemo(
    () => alerts.filter((alert) => alert.status === "new").length,
    [alerts]
  );

  const filteredAlerts = useMemo(
    () =>
      alerts.filter((alert) => {
        if (statusFilter && alert.status !== statusFilter) return false;
        if (elderFilter && String(alert.elder_id) !== elderFilter) return false;
        return withinTimeRange(alert.created_at, timeRange);
      }),
    [alerts, statusFilter, elderFilter, timeRange]
  );

  const selectedAlert = useMemo(
    () => alerts.find((alert) => alert.id === selectedAlertId) ?? null,
    [alerts, selectedAlertId]
  );

  const clearFilters = useCallback(() => {
    setStatusFilter("");
    setElderFilter("");
    setTimeRange("all");
  }, []);

  const acknowledgeAlert = useCallback(
    async (alert: Alert) => {
      setAckingId(alert.id);
      try {
        const updated = await api.post<Alert>(
          `/api/v1/alerts/${alert.id}/ack`
        );
        // 使仍在请求中的列表响应失效，防止旧快照把状态覆盖回 new
        listRequestSeq.current += 1;
        setAlerts((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
        const elderName = elderNames.get(updated.elder_id) ?? `#${updated.elder_id}`;
        toast({
          title: "告警已确认",
          description: `${elderName} · ${labelOf(EVENT_TYPE_LABELS, updated.event_type)}`,
          variant: "success",
        });
      } catch (caught) {
        toast({
          title: "确认告警失败",
          description:
            caught instanceof Error ? caught.message : "请稍后重试。",
          variant: "error",
        });
      } finally {
        setAckingId(null);
      }
    },
    [elderNames, toast]
  );

  return (
    <div>
      <FilterBar>
        <FilterField label="状态">
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as AlertStatusFilter)
            }
            options={STATUS_OPTIONS}
            className="w-36"
            aria-label="告警状态"
          />
        </FilterField>
        <FilterField label="老人">
          <ElderSelect
            value={elderFilter}
            onChange={setElderFilter}
            allowAll
            className="w-44"
            ariaLabel="选择老人"
          />
        </FilterField>
        <FilterField label="时间范围">
          <Select
            value={timeRange}
            onValueChange={(value) =>
              setTimeRange(value as TimeRangeFilter)
            }
            options={TIME_OPTIONS}
            className="w-36"
            aria-label="告警时间范围"
          />
        </FilterField>
      </FilterBar>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex h-8 items-center gap-2 rounded-[6px] border border-line bg-panel px-3 text-[12px] text-ink-muted">
          <BellRing className="size-3.5 text-critical" aria-hidden="true" />
          未处理
          <span className="tabular-nums text-ink">{pendingCount}</span>
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void load({ showLoading: false, manualRefresh: true });
          }}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
          刷新
        </Button>
      </div>

      {loading ? (
        <TableWrapper>
          <TableSkeleton rows={8} columns={6} />
        </TableWrapper>
      ) : error ? (
        <section className="rounded-[8px] border border-line bg-panel">
          <ErrorState message={error} onRetry={() => void load()} />
        </section>
      ) : filteredAlerts.length === 0 ? (
        <section className="rounded-[8px] border border-line bg-panel">
          <EmptyState
            title={alerts.length === 0 ? "暂无告警" : "没有符合条件的告警"}
            description={
              alerts.length === 0
                ? "设备触发跌倒、SOS 或围栏越界后，告警会出现在这里。"
                : "调整筛选条件后再试。"
            }
            action={
              alerts.length === 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void load()}
                >
                  <RefreshCw />
                  刷新列表
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  清除筛选
                </Button>
              )
            }
          />
        </section>
      ) : (
        <TableWrapper>
          <Table className="min-w-[940px]" aria-label="告警列表">
            <THead>
              <TR className="hover:bg-transparent">
                <TH>时间</TH>
                <TH>老人</TH>
                <TH>类型</TH>
                <TH>等级</TH>
                <TH>状态</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {filteredAlerts.map((alert) => (
                <TR
                  key={alert.id}
                  tabIndex={0}
                  aria-label={`查看告警 #${alert.id}`}
                  className={cn(
                    "cursor-pointer",
                    flashIds.has(alert.id) && "animate-alert-flash"
                  )}
                  onClick={() => setSelectedAlertId(alert.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedAlertId(alert.id);
                    }
                  }}
                >
                  <TD className="whitespace-nowrap">
                    <span className="block text-ink">
                      {formatRelative(alert.created_at)}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-ink-muted">
                      {formatDateTime(alert.created_at)}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {elderNames.get(alert.elder_id) ?? `#${alert.elder_id}`}
                  </TD>
                  <TD>
                    <EventTypeBadge type={alert.event_type} />
                  </TD>
                  <TD>
                    <SeverityBadge severity={alert.severity} />
                  </TD>
                  <TD>
                    <AlertStatusBadge status={alert.status} />
                  </TD>
                  <TD>
                    <div
                      className="flex justify-end gap-2"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedAlertId(alert.id)}
                      >
                        <Eye />
                        详情
                      </Button>
                      {alert.status === "new" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={ackingId === alert.id}
                          aria-label={`确认告警 ${alert.id}`}
                          onClick={() => void acknowledgeAlert(alert)}
                        >
                          <Check />
                          {ackingId === alert.id ? "处理中…" : "确认"}
                        </Button>
                      ) : (
                        <span className="inline-flex h-8 items-center px-3 text-[12px] text-ink-muted">
                          —
                        </span>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}

      <Dialog
        open={selectedAlert !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedAlertId(null);
        }}
      >
        <DialogContent
          title={selectedAlert ? `告警 #${selectedAlert.id}` : "告警详情"}
          description={
            selectedAlert
              ? `${elderNames.get(selectedAlert.elder_id) ?? `#${selectedAlert.elder_id}`} · ${formatFullDateTime(selectedAlert.created_at)}`
              : undefined
          }
          className="max-h-[90dvh] w-[min(94vw,780px)] overflow-y-auto"
        >
          {selectedAlert ? (
            <div>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <div className="border-t border-line pt-2.5">
                  <dt className="text-[12px] text-ink-muted">事件类型</dt>
                  <dd className="mt-1.5">
                    <EventTypeBadge type={selectedAlert.event_type} />
                  </dd>
                </div>
                <div className="border-t border-line pt-2.5">
                  <dt className="text-[12px] text-ink-muted">告警等级</dt>
                  <dd className="mt-1.5">
                    <SeverityBadge severity={selectedAlert.severity} />
                  </dd>
                </div>
                <div className="border-t border-line pt-2.5">
                  <dt className="text-[12px] text-ink-muted">处理状态</dt>
                  <dd className="mt-1.5">
                    <AlertStatusBadge status={selectedAlert.status} />
                  </dd>
                </div>
                <div className="border-t border-line pt-2.5">
                  <dt className="text-[12px] text-ink-muted">事件 ID</dt>
                  <dd className="mt-1 text-[13px] tabular-nums text-ink">
                    {selectedAlert.event_id}
                  </dd>
                </div>
                <div className="border-t border-line pt-2.5">
                  <dt className="text-[12px] text-ink-muted">创建时间</dt>
                  <dd className="mt-1 text-[13px] text-ink">
                    {formatFullDateTime(selectedAlert.created_at)}
                  </dd>
                </div>
                <div className="border-t border-line pt-2.5">
                  <dt className="text-[12px] text-ink-muted">处理时间</dt>
                  <dd className="mt-1 text-[13px] text-ink">
                    {formatFullDateTime(selectedAlert.handled_at)}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    selectedAlert.status !== "new" ||
                    ackingId === selectedAlert.id
                  }
                  onClick={() => void acknowledgeAlert(selectedAlert)}
                >
                  <Check />
                  确认告警
                </Button>
              </div>

              <section className="mt-5">
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <h2 className="text-[14px] font-medium text-ink">
                      通知记录
                    </h2>
                    <p className="mt-0.5 text-[12px] text-ink-muted">
                      展示该告警已触发的通知渠道与发送结果。
                    </p>
                  </div>
                  <span className="text-[12px] tabular-nums text-ink-muted">
                    {notifications.length} 条
                  </span>
                </div>

                {notificationsLoading ? (
                  <TableWrapper>
                    <TableSkeleton rows={3} columns={5} />
                  </TableWrapper>
                ) : notificationsError ? (
                  <div className="rounded-[8px] border border-line bg-panel">
                    <ErrorState
                      message={notificationsError}
                      onRetry={() =>
                        setNotificationsReloadKey((current) => current + 1)
                      }
                    />
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="rounded-[8px] border border-line bg-panel">
                    <EmptyState
                      title="暂无通知记录"
                      description="该告警尚未触发通知，或联系人配置为空。"
                      className="py-9"
                    />
                  </div>
                ) : (
                  <TableWrapper>
                    <Table className="min-w-[680px]" aria-label="通知记录">
                      <THead>
                        <TR className="hover:bg-transparent">
                          <TH>渠道</TH>
                          <TH>状态</TH>
                          <TH>目标</TH>
                          <TH>发送时间</TH>
                          <TH>错误</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {notifications.map((notification) => (
                          <TR key={notification.id}>
                            <TD className="whitespace-nowrap">
                              {labelOf(
                                CHANNEL_LABELS,
                                notification.channel
                              )}
                            </TD>
                            <TD>
                              <NotificationStatusBadge
                                status={notification.status}
                              />
                            </TD>
                            <TD className="max-w-48 break-all text-ink-muted">
                              {notification.target ?? "—"}
                            </TD>
                            <TD className="whitespace-nowrap text-ink-muted">
                              {formatDateTime(notification.sent_at)}
                            </TD>
                            <TD
                              className={cn(
                                "max-w-56 break-all text-[12px]",
                                notification.error
                                  ? "text-critical"
                                  : "text-ink-muted"
                              )}
                            >
                              {notification.error ?? "—"}
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableWrapper>
                )}
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
