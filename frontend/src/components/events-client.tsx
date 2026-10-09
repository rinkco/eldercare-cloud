"use client";

import { Copy, Eye, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ElderSelect, useElderList } from "@/components/elder-select";
import { FilterBar, FilterField } from "@/components/filter-bar";
import {
  EventTypeBadge,
  SeverityBadge,
} from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
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
} from "@/lib/format";
import type { EventRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

const EVENT_STATUS_LABELS: Record<string, string> = {
  new: "未处理",
  handled: "已处理",
  closed: "已关闭",
};

const EVENT_TYPE_OPTIONS = [
  { value: "", label: "全部类型" },
  ...Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

const EVENT_STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "new", label: "未处理" },
  { value: "handled", label: "已处理" },
  { value: "closed", label: "已关闭" },
];

function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function toLocalDateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function payloadSummary(payload: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(payload);
    return text && text !== "{}" ? text : "—";
  } catch {
    return "—";
  }
}

function EventStatusBadge({ status }: { status: string }) {
  const tone =
    status === "new"
      ? "critical"
      : status === "handled"
        ? "brand"
        : "neutral";
  return (
    <Badge tone={tone}>
      {EVENT_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export function EventsClient() {
  const { session } = useAuth();
  const { toast } = useToast();
  const { elders } = useElderList();

  const [events, setEvents] = useState<EventRecord[]>([]);
  const [detailEvent, setDetailEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryReady, setQueryReady] = useState(false);
  const [eventType, setEventType] = useState("");
  const [eventStatus, setEventStatus] = useState("");
  const [elderFilter, setElderFilter] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEventType(params.get("type") ?? "");
    setEventStatus(params.get("status") ?? "");
    const elderId = params.get("elder_id");
    if (elderId && /^\d+$/.test(elderId)) setElderFilter(elderId);
    setStart(toLocalDateTimeInput(params.get("start")));
    setEnd(toLocalDateTimeInput(params.get("end")));
    setQueryReady(true);
  }, []);

  const rangeInvalid = useMemo(() => {
    if (!start || !end) return false;
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    return (
      !Number.isNaN(startTime) &&
      !Number.isNaN(endTime) &&
      startTime > endTime
    );
  }, [start, end]);

  const load = useCallback(
    async (showLoading = true, signal?: AbortSignal) => {
      if (!session || !queryReady) return;
      if (showLoading) setLoading(true);

      if (rangeInvalid) {
        setEvents([]);
        setError(null);
        if (showLoading) setLoading(false);
        setRefreshing(false);
        return;
      }

      const path = `/api/v1/events${buildQuery({
        elder_id: elderFilter || undefined,
        type: eventType || undefined,
        status: eventStatus || undefined,
        start: toIsoDateTime(start),
        end: toIsoDateTime(end),
        limit: 200,
      })}`;

      try {
        const data = await api.get<EventRecord[]>(path, signal);
        setEvents(data);
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        setError(
          caught instanceof Error ? caught.message : "加载事件记录失败"
        );
      } finally {
        if (!signal?.aborted) {
          if (showLoading) setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [
      session,
      queryReady,
      rangeInvalid,
      elderFilter,
      eventType,
      eventStatus,
      start,
      end,
    ]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(true, controller.signal);
    return () => controller.abort();
  }, [load]);

  const elderNames = useMemo(
    () => new Map(elders.map((elder) => [elder.id, elder.name])),
    [elders]
  );

  const resetFilters = useCallback(() => {
    setEventType("");
    setEventStatus("");
    setElderFilter("");
    setStart("");
    setEnd("");
  }, []);

  const copyPayload = useCallback(async () => {
    if (!detailEvent) return;
    const text = JSON.stringify(detailEvent.payload_json ?? {}, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // HTTP 等非安全上下文没有剪贴板 API，回退到临时 textarea
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast({ title: "已复制完整 Payload", variant: "success" });
  }, [detailEvent, toast]);

  return (
    <div>
      <PageHeader
        title="事件记录"
        actions={
          <Button
            variant="secondary"
            size="sm"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              void load(false);
            }}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            刷新
          </Button>
        }
      />

      <FilterBar>
        <FilterField label="类型">
          <Select
            value={eventType}
            onValueChange={setEventType}
            options={EVENT_TYPE_OPTIONS}
            className="w-40"
            aria-label="事件类型"
          />
        </FilterField>
        <FilterField label="状态">
          <Select
            value={eventStatus}
            onValueChange={setEventStatus}
            options={EVENT_STATUS_OPTIONS}
            className="w-36"
            aria-label="事件状态"
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
        <FilterField label="开始时间">
          <Input
            type="datetime-local"
            value={start}
            max={end || undefined}
            step={1}
            onChange={(event) => setStart(event.target.value)}
            className="w-48"
            aria-label="事件开始时间"
          />
        </FilterField>
        <FilterField label="结束时间">
          <Input
            type="datetime-local"
            value={end}
            min={start || undefined}
            step={1}
            onChange={(event) => setEnd(event.target.value)}
            className="w-48"
            aria-label="事件结束时间"
          />
        </FilterField>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetFilters}
          className="mb-0.5"
        >
          <RotateCcw />
          重置
        </Button>
      </FilterBar>

      {rangeInvalid ? (
        <p className="mb-3 text-[13px] text-critical" role="alert">
          开始时间不能晚于结束时间。
        </p>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-3 text-[12px] text-ink-muted">
        <span>发生时间倒序</span>
        <span className="tabular-nums">当前显示 {events.length} 条</span>
      </div>

      {loading ? (
        <TableWrapper>
          <TableSkeleton rows={8} columns={7} />
        </TableWrapper>
      ) : error ? (
        <section className="rounded-[8px] border border-line bg-panel">
          <ErrorState message={error} onRetry={() => void load()} />
        </section>
      ) : events.length === 0 ? (
        <section className="rounded-[8px] border border-line bg-panel">
          <EmptyState
            title={rangeInvalid ? "请调整时间范围" : "没有符合条件的事件"}
            description={
              rangeInvalid
                ? "开始时间需要早于或等于结束时间。"
                : "调整筛选条件，或等待设备上报新的事件。"
            }
            action={
              <Button variant="secondary" size="sm" onClick={resetFilters}>
                清除筛选
              </Button>
            }
          />
        </section>
      ) : (
        <TableWrapper>
          <Table className="min-w-[1080px]" aria-label="事件记录列表">
            <THead>
              <TR className="hover:bg-transparent">
                <TH>发生时间</TH>
                <TH>老人</TH>
                <TH>类型</TH>
                <TH>等级</TH>
                <TH>状态</TH>
                <TH>置信度</TH>
                <TH>Payload 摘要</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {events.map((event) => {
                const summary = payloadSummary(event.payload_json);
                return (
                  <TR key={event.id}>
                    <TD className="whitespace-nowrap">
                      <span className="block text-ink">
                        {formatRelative(event.occurred_at)}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-ink-muted">
                        {formatDateTime(event.occurred_at)}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {elderNames.get(event.elder_id) ?? `#${event.elder_id}`}
                    </TD>
                    <TD>
                      <EventTypeBadge type={event.type} />
                    </TD>
                    <TD>
                      <SeverityBadge severity={event.severity} />
                    </TD>
                    <TD>
                      <EventStatusBadge status={event.status} />
                    </TD>
                    <TD className="tabular-nums text-ink-muted">
                      {event.confidence === null ||
                      event.confidence === undefined
                        ? "—"
                        : event.confidence.toFixed(2)}
                    </TD>
                    <TD>
                      <span
                        className="block max-w-72 truncate text-[12px] text-ink-muted"
                        title={summary}
                      >
                        {summary}
                      </span>
                    </TD>
                    <TD>
                      <div className="flex justify-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDetailEvent(event)}
                        >
                          <Eye />
                          详情
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableWrapper>
      )}

      <Dialog
        open={detailEvent !== null}
        onOpenChange={(open) => {
          if (!open) setDetailEvent(null);
        }}
      >
        <DialogContent
          title="事件详情"
          description={
            detailEvent ? `事件 #${detailEvent.id} · 原始上报数据` : undefined
          }
          className="w-[min(94vw,760px)]"
        >
          {detailEvent ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <div>
                  <dt className="text-[12px] text-ink-muted">类型</dt>
                  <dd className="mt-1">
                    <EventTypeBadge type={detailEvent.type} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-muted">等级</dt>
                  <dd className="mt-1">
                    <SeverityBadge severity={detailEvent.severity} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-muted">状态</dt>
                  <dd className="mt-1">
                    <EventStatusBadge status={detailEvent.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-muted">置信度</dt>
                  <dd className="mt-1 tabular-nums text-[13px] text-ink">
                    {detailEvent.confidence === null ||
                    detailEvent.confidence === undefined
                      ? "—"
                      : detailEvent.confidence.toFixed(2)}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[12px] text-ink-muted">发生时间</dt>
                  <dd className="mt-1 text-[13px] text-ink">
                    {formatFullDateTime(detailEvent.occurred_at)}
                    <span className="ml-2 text-[12px] text-ink-muted">
                      {detailEvent.occurred_at}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-muted">老人</dt>
                  <dd className="mt-1 text-[13px] text-ink">
                    {elderNames.get(detailEvent.elder_id) ??
                      `#${detailEvent.elder_id}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-muted">设备 ID</dt>
                  <dd className="mt-1 tabular-nums text-[13px] text-ink">
                    #{detailEvent.device_id}
                  </dd>
                </div>
              </dl>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] text-ink-muted">完整 Payload</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void copyPayload()}
                  >
                    <Copy />
                    复制
                  </Button>
                </div>
                <pre className="mt-2 max-h-72 overflow-auto rounded-[6px] border border-line bg-raised px-3 py-2.5 text-[12px] leading-5 text-ink">
                  {JSON.stringify(detailEvent.payload_json ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
