"use client";

import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FilterBar, FilterField } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import {
  Table,
  TableWrapper,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatFullDateTime, toLocalInputValue } from "@/lib/format";
import type { Elder } from "@/lib/types";

const PAGE_SIZE = 10;

const GENDER_LABELS: Record<string, string> = {
  male: "男",
  female: "女",
  other: "其他",
};

function genderLabel(value: string | null): string {
  if (!value) return "未填写";
  return GENDER_LABELS[value] ?? value;
}

function bodyMeasurement(elder: Elder): string {
  const height =
    elder.height_cm === null ? null : `${elder.height_cm} cm`;
  const weight =
    elder.weight_kg === null ? null : `${elder.weight_kg} kg`;
  return [height, weight].filter(Boolean).join(" / ") || "—";
}

export function EldersClient() {
  const { session } = useAuth();
  const router = useRouter();
  const [elders, setElders] = useState<Elder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const isAdmin = session?.role === "admin";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!session) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<Elder[]>("/api/v1/elders", signal);
        setElders(data);
      } catch (caught: unknown) {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        setError(
          caught instanceof Error ? caught.message : "加载老人列表失败"
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [session]
  );

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, session]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const filteredElders = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return elders;
    return elders.filter((elder) =>
      elder.name.toLocaleLowerCase().includes(keyword)
    );
  }, [elders, search]);

  const totalPages = Math.max(1, Math.ceil(filteredElders.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageElders = filteredElders.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (!session) {
    return (
      <div className="rounded-[8px] border border-line bg-panel">
        <TableSkeleton rows={6} columns={7} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="老人档案"
        description={
          isAdmin
            ? "管理员可见全部老人档案，可在此查看、编辑和新建档案。"
            : "家属仅可见与自己关联的老人档案。"
        }
        actions={
          <Button
            variant="primary"
            onClick={() => router.push("/elders/edit")}
          >
            <Plus />
            新建老人
          </Button>
        }
      />

      <FilterBar>
        <FilterField label="搜索姓名" className="w-full sm:w-72">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="输入老人姓名"
              aria-label="按姓名搜索老人"
              className="pl-9"
            />
          </div>
        </FilterField>
        <div className="flex h-9 items-center gap-2">
          <Badge tone={isAdmin ? "info" : "neutral"}>
            {isAdmin ? "可见范围：全部老人" : "可见范围：关联老人"}
          </Badge>
          <span className="text-[12px] text-ink-muted">
            共 {filteredElders.length} 条
          </span>
        </div>
      </FilterBar>

      {loading ? (
        <div className="rounded-[8px] border border-line bg-panel">
          <TableSkeleton rows={6} columns={7} />
        </div>
      ) : error ? (
        <div className="rounded-[8px] border border-line bg-panel">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : pageElders.length === 0 ? (
        <div className="rounded-[8px] border border-line bg-panel">
          <EmptyState
            title={search.trim() ? "没有找到匹配的老人" : "暂无老人档案"}
            description={
              search.trim()
                ? "请尝试更换姓名关键词，或清空搜索条件。"
                : isAdmin
                  ? "新建第一份档案后，就能开始配置联系人和监护设备。"
                  : "当前账号还没有关联老人，请联系管理员补充关联关系。"
            }
            action={
              !search.trim() && isAdmin ? (
                <Button
                  variant="primary"
                  onClick={() => router.push("/elders/edit")}
                >
                  <Plus />
                  新建老人
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <TableWrapper>
          <Table className="min-w-[1040px]">
            <THead>
              <TR className="hover:bg-transparent">
                <TH>姓名</TH>
                <TH>性别</TH>
                <TH>出生日期</TH>
                <TH>身高 / 体重</TH>
                <TH>地址</TH>
                <TH>创建时间</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {pageElders.map((elder) => (
                <TR key={elder.id}>
                  <TD>
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-brand/12 text-brand">
                        <UserRound className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="font-medium text-ink">{elder.name}</span>
                    </div>
                  </TD>
                  <TD className="text-ink-muted">
                    {genderLabel(elder.gender)}
                  </TD>
                  <TD className="whitespace-nowrap text-ink-muted">
                    {toLocalInputValue(elder.birth_date) || "—"}
                  </TD>
                  <TD className="whitespace-nowrap tabular-nums text-ink-muted">
                    {bodyMeasurement(elder)}
                  </TD>
                  <TD>
                    <span
                      className="block max-w-[220px] truncate text-ink-muted"
                      title={elder.address ?? undefined}
                    >
                      {elder.address || "—"}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-ink-muted">
                    {formatFullDateTime(elder.created_at)}
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip content="查看详情">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="查看详情"
                          onClick={() =>
                            router.push(`/elders/detail?id=${elder.id}`)
                          }
                        >
                          <Eye />
                        </Button>
                      </Tooltip>
                      <Tooltip content="编辑档案">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="编辑档案"
                          onClick={() =>
                            router.push(`/elders/edit?id=${elder.id}`)
                          }
                        >
                          <Pencil />
                        </Button>
                      </Tooltip>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}

      {!loading && !error && pageElders.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-ink-muted">
            第 {safePage} / {totalPages} 页，共 {filteredElders.length} 条记录
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft />
              上一页
            </Button>
            <span className="min-w-14 text-center text-[12px] tabular-nums text-ink-muted">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              下一页
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
