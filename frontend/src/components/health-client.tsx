"use client";

import { CalendarDays, Clock3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard } from "@/components/chart-card";
import { ElderSelect, useElderList } from "@/components/elder-select";
import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
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
  formatDateTime,
  formatNumber,
  labelOf,
} from "@/lib/format";
import type { TrendBucket } from "@/lib/types";

type TrendInterval = "hour" | "day";
type RangeKey = "24h" | "7d" | "30d";

interface MetricTableRow {
  label: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

interface ActivityTableRow {
  activity: string;
  label: string;
  count: number;
}

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: "24h", label: "近 24 小时" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
];

const INTERVAL_OPTIONS: Array<{ value: TrendInterval; label: string }> = [
  { value: "hour", label: "按小时" },
  { value: "day", label: "按天" },
];

const RANGE_MS: Record<RangeKey, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const CHART_BODY_HEIGHT = 260;
const CHART_INNER_HEIGHT = 236;
const GRID_COLOR = "rgba(255,255,255,0.08)";
const AXIS_COLOR = "#9aa3ad";
const TOOLTIP_STYLE = {
  backgroundColor: "#1e232a",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 6,
  color: "#e8eaed",
  fontSize: 12,
};

const dayFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
});

function formatBucketLabel(value: string, interval: TrendInterval): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return interval === "hour" ? formatDateTime(value) : dayFormatter.format(date);
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-[6px] border border-line bg-panel p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Button
            key={option.value}
            variant={selected ? "secondary" : "ghost"}
            size="sm"
            className="h-7 rounded-[4px] px-2.5"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

function formatWithUnit(
  value: number | null,
  digits: number,
  unit: string
): string {
  if (value === null) return "—";
  return `${formatNumber(value, digits)} ${unit}`;
}

function MetricTable({
  rows,
  unit,
  digits,
}: {
  rows: MetricTableRow[];
  unit: string;
  digits: number;
}) {
  return (
    <div className="max-h-[236px] overflow-y-auto">
      <Table className="min-w-[440px]">
        <THead>
          <TR className="hover:bg-transparent">
            <TH>时间</TH>
            <TH>平均</TH>
            <TH>最低</TH>
            <TH>最高</TH>
            <TH>样本</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.label}>
              <TD className="whitespace-nowrap text-ink-muted">{row.label}</TD>
              <TD className="tabular-nums">
                {formatWithUnit(row.avg, digits, unit)}
              </TD>
              <TD className="tabular-nums">
                {formatWithUnit(row.min, digits, unit)}
              </TD>
              <TD className="tabular-nums">
                {formatWithUnit(row.max, digits, unit)}
              </TD>
              <TD className="tabular-nums text-ink-muted">{row.count}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function StepsTable({
  rows,
}: {
  rows: Array<{ label: string; value: number | null }>;
}) {
  return (
    <div className="max-h-[236px] overflow-y-auto">
      <Table className="min-w-[320px]">
        <THead>
          <TR className="hover:bg-transparent">
            <TH>时间</TH>
            <TH>步数</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.label}>
              <TD className="whitespace-nowrap text-ink-muted">{row.label}</TD>
              <TD className="tabular-nums">
                {formatWithUnit(row.value, 0, "步")}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function ActivityTable({ rows }: { rows: ActivityTableRow[] }) {
  return (
    <div className="max-h-[236px] overflow-y-auto">
      <Table className="min-w-[320px]">
        <THead>
          <TR className="hover:bg-transparent">
            <TH>活动状态</TH>
            <TH>次数</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.activity}>
              <TD>{row.label}</TD>
              <TD className="tabular-nums">{row.count} 次</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

export function HealthClient() {
  const [listReloadKey, setListReloadKey] = useState(0);

  return (
    <HealthContent
      key={listReloadKey}
      onReloadElders={() => setListReloadKey((current) => current + 1)}
    />
  );
}

function HealthContent({ onReloadElders }: { onReloadElders: () => void }) {
  const { elders, loading: eldersLoading, error: eldersError } = useElderList();
  const [selectedElderId, setSelectedElderId] = useState("");
  const [interval, setInterval] = useState<TrendInterval>("hour");
  const [range, setRange] = useState<RangeKey>("24h");
  const [trends, setTrends] = useState<TrendBucket[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [trendReloadKey, setTrendReloadKey] = useState(0);

  useEffect(() => {
    const selectedStillVisible = elders.some(
      (elder) => String(elder.id) === selectedElderId
    );
    if (elders.length > 0 && !selectedStillVisible) {
      setSelectedElderId(String(elders[0].id));
    }
  }, [elders, selectedElderId]);

  useEffect(() => {
    if (!selectedElderId) {
      setTrends([]);
      setTrendLoading(false);
      setTrendError(null);
      return;
    }

    const controller = new AbortController();
    const end = new Date();
    const start = new Date(end.getTime() - RANGE_MS[range]);
    let active = true;

    setTrendLoading(true);
    setTrendError(null);
    api
      .get<TrendBucket[]>(
        `/api/v1/elders/${selectedElderId}/health-trends${buildQuery({
          interval,
          start: start.toISOString(),
          end: end.toISOString(),
        })}`,
        controller.signal
      )
      .then((data) => {
        if (!active) return;
        setTrends(data);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setTrendError(
          caught instanceof Error ? caught.message : "加载健康趋势失败"
        );
      })
      .finally(() => {
        if (active) setTrendLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedElderId, interval, range, trendReloadKey]);

  const selectedElder = useMemo(
    () => elders.find((elder) => String(elder.id) === selectedElderId) ?? null,
    [elders, selectedElderId]
  );

  const heartRows = useMemo<MetricTableRow[]>(
    () =>
      trends
        .filter((bucket) => bucket.heart_rate !== null)
        .map((bucket) => ({
          label: formatBucketLabel(bucket.bucket_start, interval),
          avg: bucket.heart_rate?.avg ?? null,
          min: bucket.heart_rate?.min ?? null,
          max: bucket.heart_rate?.max ?? null,
          count: bucket.heart_rate?.count ?? 0,
        })),
    [trends, interval]
  );

  const spo2Rows = useMemo<MetricTableRow[]>(
    () =>
      trends
        .filter((bucket) => bucket.spo2 !== null)
        .map((bucket) => ({
          label: formatBucketLabel(bucket.bucket_start, interval),
          avg: bucket.spo2?.avg ?? null,
          min: bucket.spo2?.min ?? null,
          max: bucket.spo2?.max ?? null,
          count: bucket.spo2?.count ?? 0,
        })),
    [trends, interval]
  );

  const stepRows = useMemo(
    () =>
      trends
        .filter((bucket) => bucket.steps_total !== null)
        .map((bucket) => ({
          label: formatBucketLabel(bucket.bucket_start, interval),
          value: bucket.steps_total,
        })),
    [trends, interval]
  );

  const activityRows = useMemo<ActivityTableRow[]>(() => {
    const totals = new Map<string, number>();
    for (const bucket of trends) {
      for (const item of bucket.activity ?? []) {
        totals.set(item.activity, (totals.get(item.activity) ?? 0) + item.count);
      }
    }

    const known = ["still", "walking", "running", "sleeping", "unknown"];
    const extra = Array.from(totals.keys()).filter(
      (activity) => !known.includes(activity)
    );
    return [...known, ...extra]
      .map((activity) => ({
        activity,
        label: labelOf(ACTIVITY_LABELS, activity),
        count: totals.get(activity) ?? 0,
      }))
      .filter((item) => item.count > 0);
  }, [trends]);

  const heartChartData = heartRows.map((row) => ({
    label: row.label,
    value: row.avg,
  }));
  const spo2ChartData = spo2Rows.map((row) => ({
    label: row.label,
    value: row.avg,
  }));
  const stepChartData = stepRows.map((row) => ({
    label: row.label,
    value: row.value,
  }));

  const chartError = eldersError ?? trendError;
  const chartLoading =
    eldersLoading || (selectedElderId ? trendLoading : elders.length > 0);
  const hasNoElders =
    !eldersLoading && !eldersError && elders.length === 0;

  const retry = useCallback(() => {
    if (eldersError) {
      onReloadElders();
      return;
    }
    setTrendReloadKey((current) => current + 1);
  }, [eldersError, onReloadElders]);

  const bucketDescription =
    interval === "hour" ? "按小时聚合" : "按天聚合";
  const emptyTitle = hasNoElders
    ? "暂无可见老人"
    : selectedElder
      ? "暂无数据"
      : "正在准备图表";
  const emptyDescription = hasNoElders
    ? "当前账号没有可查看的老人，请联系管理员分配访问范围。"
    : "所选时间范围内没有对应指标，尝试扩大时间范围。";

  return (
    <div>
      <PageHeader
        title="健康数据"
      />

      <FilterBar>
        <div className="flex min-w-[180px] flex-col gap-1.5">
          <span className="text-[12px] text-ink-muted">老人</span>
          <ElderSelect
            value={selectedElderId}
            onChange={setSelectedElderId}
            ariaLabel="选择老人"
            placeholder="请选择老人"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-ink-muted">
            <Clock3 className="mr-1 inline size-3.5" aria-hidden="true" />
            趋势间隔
          </span>
          <SegmentedControl
            label="趋势间隔"
            value={interval}
            options={INTERVAL_OPTIONS}
            onChange={setInterval}
            disabled={hasNoElders}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-ink-muted">
            <CalendarDays className="mr-1 inline size-3.5" aria-hidden="true" />
            时间范围
          </span>
          <SegmentedControl
            label="时间范围"
            value={range}
            options={RANGE_OPTIONS}
            onChange={setRange}
            disabled={hasNoElders}
          />
        </div>
      </FilterBar>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="心率趋势"
          description={`平均心率 · ${bucketDescription}`}
          loading={chartLoading}
          error={chartError}
          empty={!chartLoading && !chartError && heartRows.length === 0}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          onRetry={retry}
          height={CHART_BODY_HEIGHT}
          tableView={
            <MetricTable rows={heartRows} unit="bpm" digits={0} />
          }
        >
          <div style={{ height: CHART_INNER_HEIGHT }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={heartChartData}
                margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
              >
                <CartesianGrid
                  stroke={GRID_COLOR}
                  vertical={false}
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_COLOR }}
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  domain={["auto", "auto"]}
                />
                <RechartsTooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: AXIS_COLOR }}
                  itemStyle={{ color: "#e8eaed" }}
                  cursor={{ stroke: "rgba(255,255,255,0.16)" }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="平均心率"
                  stroke="#E05B4B"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3, fill: "#E05B4B", stroke: "#E05B4B" }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="血氧趋势"
          description={`平均血氧 · ${bucketDescription}`}
          loading={chartLoading}
          error={chartError}
          empty={!chartLoading && !chartError && spo2Rows.length === 0}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          onRetry={retry}
          height={CHART_BODY_HEIGHT}
          tableView={<MetricTable rows={spo2Rows} unit="%" digits={1} />}
        >
          <div style={{ height: CHART_INNER_HEIGHT }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={spo2ChartData}
                margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
              >
                <CartesianGrid
                  stroke={GRID_COLOR}
                  vertical={false}
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_COLOR }}
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  domain={["auto", "auto"]}
                />
                <RechartsTooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: AXIS_COLOR }}
                  itemStyle={{ color: "#e8eaed" }}
                  cursor={{ stroke: "rgba(255,255,255,0.16)" }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="平均血氧"
                  stroke="#3FAE8C"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3, fill: "#3FAE8C", stroke: "#3FAE8C" }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="步数趋势"
          description={`区间步数 · ${bucketDescription}`}
          loading={chartLoading}
          error={chartError}
          empty={!chartLoading && !chartError && stepRows.length === 0}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          onRetry={retry}
          height={CHART_BODY_HEIGHT}
          tableView={<StepsTable rows={stepRows} />}
        >
          <div style={{ height: CHART_INNER_HEIGHT }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stepChartData}
                margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
              >
                <CartesianGrid
                  stroke={GRID_COLOR}
                  vertical={false}
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_COLOR }}
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  domain={[0, "auto"]}
                  allowDecimals={false}
                />
                <RechartsTooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: AXIS_COLOR }}
                  itemStyle={{ color: "#e8eaed" }}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Bar
                  dataKey="value"
                  name="步数"
                  fill="#D9A441"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={34}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="活动分布"
          description="所选时间范围内的活动次数汇总"
          loading={chartLoading}
          error={chartError}
          empty={!chartLoading && !chartError && activityRows.length === 0}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          onRetry={retry}
          height={CHART_BODY_HEIGHT}
          tableView={<ActivityTable rows={activityRows} />}
        >
          <div style={{ height: CHART_INNER_HEIGHT }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={activityRows}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  stroke={GRID_COLOR}
                  horizontal={false}
                  strokeDasharray="3 3"
                />
                <XAxis
                  type="number"
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_COLOR }}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <RechartsTooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: AXIS_COLOR }}
                  itemStyle={{ color: "#e8eaed" }}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Bar
                  dataKey="count"
                  name="次数"
                  fill="#8B7BD8"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
