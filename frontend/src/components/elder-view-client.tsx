"use client";

import {
  Activity,
  ArrowLeft,
  CalendarDays,
  ContactRound,
  HeartPulse,
  MapPin,
  Phone,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ElderSelect, useElderList } from "@/components/elder-select";
import { FilterBar } from "@/components/filter-bar";
import {
  AlertStatusBadge,
  EventTypeBadge,
  SeverityBadge,
} from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import {
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui/table";
import { api, buildQuery } from "@/lib/api";
import {
  ACTIVITY_LABELS,
  METRIC_LABELS,
  METRIC_UNITS,
  RELATION_LABELS,
  formatDateTime,
  formatNumber,
  labelOf,
} from "@/lib/format";
import type {
  Alert,
  Contact,
  Elder,
  Telemetry,
  TrendBucket,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface Resource<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

interface ElderViewData {
  contacts: Resource<Contact[]>;
  telemetry: Resource<Telemetry[]>;
  trends: Resource<TrendBucket[]>;
  alerts: Resource<Alert[]>;
}

const birthDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function createInitialViewData(): ElderViewData {
  return {
    contacts: { data: [], loading: true, error: null },
    telemetry: { data: [], loading: true, error: null },
    trends: { data: [], loading: true, error: null },
    alerts: { data: [], loading: true, error: null },
  };
}

function settledResource<T>(
  result: PromiseSettledResult<T>,
  fallbackMessage: string,
  emptyValue: T
): Resource<T> {
  if (result.status === "fulfilled") {
    return { data: result.value, loading: false, error: null };
  }
  return {
    data: emptyValue,
    loading: false,
    error:
      result.reason instanceof Error ? result.reason.message : fallbackMessage,
  };
}

function useElderViewData(elderId: string) {
  const [data, setData] = useState<ElderViewData>(createInitialViewData);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    let active = true;

    setData(createInitialViewData());
    void (async () => {
      const results = await Promise.allSettled([
        api.get<Contact[]>(
          `/api/v1/elders/${elderId}/contacts`,
          controller.signal
        ),
        api.get<Telemetry[]>(
          `/api/v1/elders/${elderId}/telemetry${buildQuery({ limit: 20 })}`,
          controller.signal
        ),
        api.get<TrendBucket[]>(
          `/api/v1/elders/${elderId}/health-trends${buildQuery({
            interval: "day",
            start: start.toISOString(),
            end: end.toISOString(),
          })}`,
          controller.signal
        ),
        api.get<Alert[]>(
          `/api/v1/alerts${buildQuery({ elder_id: elderId, limit: 20 })}`,
          controller.signal
        ),
      ]);

      if (!active || controller.signal.aborted) return;
      setData({
        contacts: settledResource(
          results[0],
          "加载紧急联系人失败",
          []
        ),
        telemetry: settledResource(
          results[1],
          "加载最近遥测失败",
          []
        ),
        trends: settledResource(results[2], "加载健康趋势失败", []),
        alerts: settledResource(results[3], "加载最近告警失败", []),
      });
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [elderId, reloadKey]);

  const retry = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  return { ...data, retry };
}

function calculateAge(value: string | null): string {
  if (!value) return "—";
  const birthDate = new Date(value);
  if (Number.isNaN(birthDate.getTime())) return "—";

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const birthdayHasPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() &&
      today.getDate() >= birthDate.getDate());
  if (!birthdayHasPassed) age -= 1;
  return `${Math.max(0, age)} 岁`;
}

function formatBirthDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return birthDateFormatter.format(date);
}

function formatTelemetryValue(item: Telemetry): string {
  if (item.value_num !== null && item.value_num !== undefined) {
    const digits = item.metric === "heart_rate" || item.metric === "steps" ? 0 : 1;
    const unit = METRIC_UNITS[item.metric] ?? "";
    return `${formatNumber(item.value_num, digits)}${unit ? ` ${unit}` : ""}`;
  }
  if (item.value_text) {
    return item.metric === "activity"
      ? labelOf(ACTIVITY_LABELS, item.value_text)
      : item.value_text;
  }
  return "—";
}

function Panel({
  title,
  description,
  icon,
  children,
  className,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-[8px] border border-line bg-panel", className)}
    >
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-white/5 text-ink-muted"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div>
          <h2 className="text-[15px] font-medium text-ink">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[12px] text-ink-muted">{description}</p>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3 px-4 py-4">
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="h-3.5 w-full max-w-sm" />
      <Skeleton className="h-3.5 w-4/5" />
    </div>
  );
}

function SectionBody<T>({
  resource,
  emptyTitle,
  emptyDescription,
  onRetry,
  children,
}: {
  resource: Resource<T[]>;
  emptyTitle: string;
  emptyDescription: string;
  onRetry: () => void;
  children: (data: T[]) => ReactNode;
}) {
  if (resource.loading) return <PanelSkeleton />;
  if (resource.error) {
    return <ErrorState message={resource.error} onRetry={onRetry} />;
  }
  if (resource.data.length === 0) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} />
    );
  }
  return <>{children(resource.data)}</>;
}

function ElderViewBody({ elder }: { elder: Elder }) {
  const { contacts, telemetry, trends, alerts, retry } = useElderViewData(
    String(elder.id)
  );

  const contactRows = useMemo(
    () =>
      [...contacts.data].sort((left, right) => {
        if (left.is_primary !== right.is_primary) {
          return left.is_primary ? -1 : 1;
        }
        return left.priority - right.priority;
      }),
    [contacts.data]
  );

  const telemetryRows = useMemo(
    () =>
      [...telemetry.data]
        .sort(
          (left, right) =>
            new Date(right.recorded_at).getTime() -
            new Date(left.recorded_at).getTime()
        )
        .slice(0, 20),
    [telemetry.data]
  );

  const trendRows = useMemo(
    () =>
      [...trends.data]
        .sort(
          (left, right) =>
            new Date(left.bucket_start).getTime() -
            new Date(right.bucket_start).getTime()
        )
        .slice(-7)
        .reverse(),
    [trends.data]
  );

  const alertRows = useMemo(
    () =>
      [...alerts.data]
        .sort(
          (left, right) =>
            new Date(right.created_at).getTime() -
            new Date(left.created_at).getTime()
        )
        .slice(0, 20),
    [alerts.data]
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title="档案摘要"
        description="只读展示老人基础资料"
        icon={<UserRound className="size-4" />}
      >
        <dl className="grid gap-4 px-4 py-4 lg:grid-cols-2">
          <div>
            <dt className="text-[12px] text-ink-muted">姓名</dt>
            <dd className="mt-1 text-[15px] font-medium text-ink">
              {elder.name}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">年龄</dt>
            <dd className="mt-1 text-[15px] text-ink">
              {calculateAge(elder.birth_date)}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">出生日期</dt>
            <dd className="mt-1 flex items-center gap-1.5 text-[15px] tabular-nums text-ink">
              <CalendarDays
                className="size-3.5 text-ink-muted"
                aria-hidden="true"
              />
              {formatBirthDate(elder.birth_date)}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[12px] text-ink-muted">地址</dt>
            <dd className="mt-1 flex items-start gap-1.5 text-[15px] leading-6 text-ink">
              <MapPin
                className="mt-1 size-3.5 shrink-0 text-ink-muted"
                aria-hidden="true"
              />
              <span className="break-words">{elder.address || "—"}</span>
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel
        title="紧急联系人"
        description={
          contacts.loading
            ? "正在加载联系人"
            : `共 ${contactRows.length} 位联系人`
        }
        icon={<ContactRound className="size-4" />}
      >
        <SectionBody
          resource={contacts}
          emptyTitle="暂无紧急联系人"
          emptyDescription="当前老人还没有登记紧急联系人。"
          onRetry={retry}
        >
          {() => (
            <div className="overflow-x-auto">
              <Table className="min-w-[560px]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>姓名</TH>
                    <TH>电话</TH>
                    <TH>关系</TH>
                    <TH>主联系人</TH>
                  </TR>
                </THead>
                <TBody>
                  {contactRows.map((contact) => (
                    <TR key={contact.id}>
                      <TD className="font-medium">{contact.name}</TD>
                      <TD className="whitespace-nowrap tabular-nums text-ink-muted">
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="size-3.5" aria-hidden="true" />
                          {contact.phone}
                        </span>
                      </TD>
                      <TD>
                        {labelOf(RELATION_LABELS, contact.relation, "—")}
                      </TD>
                      <TD>
                        {contact.is_primary ? (
                          <Badge tone="brand">主联系人</Badge>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </SectionBody>
      </Panel>

      <Panel
        title="最近遥测"
        description="最近 20 条设备上报"
        icon={<Activity className="size-4" />}
      >
        <SectionBody
          resource={telemetry}
          emptyTitle="暂无遥测数据"
          emptyDescription="设备开始上报后，最近数据会显示在这里。"
          onRetry={retry}
        >
          {() => (
            <div className="max-h-[360px] overflow-auto">
              <Table className="min-w-[520px]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>时间</TH>
                    <TH>指标</TH>
                    <TH>数值</TH>
                  </TR>
                </THead>
                <TBody>
                  {telemetryRows.map((item) => (
                    <TR key={item.id}>
                      <TD className="whitespace-nowrap text-ink-muted">
                        {formatDateTime(item.recorded_at)}
                      </TD>
                      <TD>{labelOf(METRIC_LABELS, item.metric)}</TD>
                      <TD className="tabular-nums">
                        {formatTelemetryValue(item)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </SectionBody>
      </Panel>

      <Panel
        title="健康趋势"
        description="最近 7 天按天汇总"
        icon={<HeartPulse className="size-4" />}
      >
        <SectionBody
          resource={trends}
          emptyTitle="暂无健康趋势"
          emptyDescription="所选时间范围内没有可汇总的健康指标。"
          onRetry={retry}
        >
          {() => (
            <div className="max-h-[360px] overflow-auto">
              <Table className="min-w-[560px]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>时间</TH>
                    <TH>平均心率</TH>
                    <TH>平均血氧</TH>
                    <TH>步数</TH>
                  </TR>
                </THead>
                <TBody>
                  {trendRows.map((bucket) => (
                    <TR key={bucket.bucket_start}>
                      <TD className="whitespace-nowrap text-ink-muted">
                        {formatDateTime(bucket.bucket_start)}
                      </TD>
                      <TD className="tabular-nums">
                        {bucket.heart_rate
                          ? `${formatNumber(bucket.heart_rate.avg, 0)} bpm`
                          : "—"}
                      </TD>
                      <TD className="tabular-nums">
                        {bucket.spo2
                          ? `${formatNumber(bucket.spo2.avg, 1)} %`
                          : "—"}
                      </TD>
                      <TD className="tabular-nums">
                        {bucket.steps_total !== null
                          ? `${formatNumber(bucket.steps_total, 0)} 步`
                          : "—"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </SectionBody>
      </Panel>

      <Panel
        title="最近告警"
        description="最近 20 条告警，仅展示状态"
        icon={<ShieldAlert className="size-4" />}
        className="lg:col-span-2"
      >
        <SectionBody
          resource={alerts}
          emptyTitle="暂无告警"
          emptyDescription="当前老人还没有产生告警记录。"
          onRetry={retry}
        >
          {() => (
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>时间</TH>
                    <TH>类型</TH>
                    <TH>等级</TH>
                    <TH>状态</TH>
                  </TR>
                </THead>
                <TBody>
                  {alertRows.map((alert) => (
                    <TR key={alert.id}>
                      <TD className="whitespace-nowrap text-ink-muted">
                        {formatDateTime(alert.created_at)}
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
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </SectionBody>
      </Panel>
    </div>
  );
}

export function ElderViewClient() {
  const [listReloadKey, setListReloadKey] = useState(0);

  return (
    <ElderViewContent
      key={listReloadKey}
      onReloadElders={() => setListReloadKey((current) => current + 1)}
    />
  );
}

function ElderViewContent({
  onReloadElders,
}: {
  onReloadElders: () => void;
}) {
  const { elders, loading, error } = useElderList();
  const [selectedElderId, setSelectedElderId] = useState("");

  useEffect(() => {
    const selectedStillVisible = elders.some(
      (elder) => String(elder.id) === selectedElderId
    );
    if (elders.length > 0 && !selectedStillVisible) {
      setSelectedElderId(String(elders[0].id));
    }
  }, [elders, selectedElderId]);

  const selectedElder = useMemo(
    () =>
      elders.find((elder) => String(elder.id) === selectedElderId) ?? null,
    [elders, selectedElderId]
  );

  return (
    <div>
      <PageHeader
        title="长辈视图"
        description="只读展示档案、联系人、遥测、健康趋势和最近告警。"
        actions={
          <Link
            href="/"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            <ArrowLeft />
            返回管理视图
          </Link>
        }
      />

      <FilterBar>
        <div className="flex min-w-[180px] flex-col gap-1.5">
          <span className="text-[12px] text-ink-muted">老人</span>
          <ElderSelect
            value={selectedElderId}
            onChange={setSelectedElderId}
            ariaLabel="选择长辈"
          />
        </div>
        <div className="flex h-9 items-center">
          <Badge tone="info">只读模式</Badge>
        </div>
      </FilterBar>

      {loading || (!selectedElder && elders.length > 0) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-[8px] border border-line bg-panel px-4 py-4"
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-4 h-4 w-full max-w-sm" />
              <Skeleton className="mt-3 h-4 w-4/5" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-[8px] border border-line bg-panel">
          <ErrorState message={error} onRetry={onReloadElders} />
        </div>
      ) : !selectedElder ? (
        <div className="rounded-[8px] border border-line bg-panel">
          <EmptyState
            title="暂无可见老人"
            description="当前账号没有可查看的老人，请联系管理员分配访问范围。"
          />
        </div>
      ) : (
        <ElderViewBody key={selectedElder.id} elder={selectedElder} />
      )}
    </div>
  );
}
