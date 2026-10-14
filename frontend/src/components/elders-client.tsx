"use client";

import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  Search,
  UserMinus,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FilterBar, FilterField } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/input";
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
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatFullDateTime, toLocalInputValue } from "@/lib/format";
import type { Elder } from "@/lib/types";

const PAGE_SIZE = 10;

/** 老人手机号规则（SPEC 06）：11 位、1 开头且第二位为 3-9。 */
const PHONE_PATTERN = /^1[3-9]\d{9}$/;

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
  const { toast } = useToast();
  const router = useRouter();
  const [elders, setElders] = useState<Elder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // SPEC 06：按老人手机号「添加老人」
  const [addOpen, setAddOpen] = useState(false);
  const [addPhone, setAddPhone] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // SPEC 06：家属「取消绑定」（解除自己与该老人的绑定）
  const [unbindTarget, setUnbindTarget] = useState<Elder | null>(null);
  const [unbindError, setUnbindError] = useState<string | null>(null);
  const [unbinding, setUnbinding] = useState(false);

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

  const openAddDialog = () => {
    setAddPhone("");
    setAddError(null);
    setAddOpen(true);
  };

  // SPEC 06：按老人手机号添加——家属自动绑定自己，管理员仅检索定位（不产生绑定）
  const handleAddByPhone = async () => {
    if (adding) return;
    const phone = addPhone.trim();
    if (!PHONE_PATTERN.test(phone)) {
      setAddError("请输入 11 位手机号。");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const elder = await api.post<Elder>("/api/v1/elders/add-by-phone", {
        phone,
      });
      setAddOpen(false);
      toast({
        title: isAdmin
          ? `该老人已存在：${elder.name}`
          : `已添加老人：${elder.name}`,
        description: isAdmin
          ? "仅定位已有档案，未产生绑定。"
          : "已跳转到该老人的详情。",
        variant: "success",
      });
      router.push(`/elders/detail?id=${elder.id}`);
    } catch (caught: unknown) {
      // 404 / 409 等后端 detail 直接内联展示在弹窗内
      setAddError(
        caught instanceof ApiError
          ? caught.message
          : "添加老人失败，请稍后重试。"
      );
    } finally {
      setAdding(false);
    }
  };

  // SPEC 06：取消绑定只解除当前账号与该老人的关联，档案与历史数据保留
  const handleUnbind = async () => {
    if (!unbindTarget || unbinding) return;
    setUnbinding(true);
    setUnbindError(null);
    try {
      await api.delete<void>(`/api/v1/elders/${unbindTarget.id}/access/me`);
      const targetName = unbindTarget.name;
      setUnbindTarget(null);
      toast({
        title: `已取消与${targetName}的绑定`,
        description: "如需恢复，可用老人手机号重新添加。",
        variant: "success",
      });
      await load();
    } catch (caught: unknown) {
      setUnbindError(
        caught instanceof ApiError
          ? caught.message
          : "取消绑定失败，请稍后重试。"
      );
    } finally {
      setUnbinding(false);
    }
  };

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
        <TableSkeleton rows={6} columns={8} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="老人档案"
        actions={
          <>
            <Button variant="secondary" onClick={openAddDialog}>
              <UserPlus />
              添加老人
            </Button>
            <Button
              variant="primary"
              onClick={() => router.push("/elders/edit")}
            >
              <Plus />
              新建老人
            </Button>
          </>
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
          <TableSkeleton rows={6} columns={8} />
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
                  : "当前账号还没有关联老人，可凭老人手机号「添加老人」，或「新建老人」。"
            }
            action={
              !search.trim() ? (
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
          <Table className="min-w-[1160px]">
            <THead>
              <TR className="hover:bg-transparent">
                <TH>姓名</TH>
                <TH>手机号</TH>
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
                  <TD className="whitespace-nowrap tabular-nums text-ink-muted">
                    {elder.phone || "—"}
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
                      {!isAdmin ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setUnbindError(null);
                            setUnbindTarget(elder);
                          }}
                        >
                          <UserMinus />
                          取消绑定
                        </Button>
                      ) : null}
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

      <Dialog
        open={addOpen}
        onOpenChange={(next) => {
          if (adding) return;
          setAddOpen(next);
        }}
      >
        <DialogContent
          title="添加老人"
          description={
            isAdmin
              ? "输入老人手机号定位已有档案（管理员不产生绑定）。"
              : "输入老人手机号，命中后将关联到当前账号。"
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleAddByPhone();
            }}
          >
            <Label htmlFor="add-elder-phone">老人手机号</Label>
            <Input
              id="add-elder-phone"
              type="tel"
              inputMode="numeric"
              maxLength={11}
              autoComplete="off"
              value={addPhone}
              placeholder="请输入 11 位手机号"
              aria-invalid={Boolean(addError)}
              aria-describedby={addError ? "add-elder-phone-error" : undefined}
              onChange={(event) => {
                setAddPhone(event.target.value.replace(/\D/g, ""));
                setAddError(null);
              }}
            />
            <div id="add-elder-phone-error">
              <FieldError>{addError}</FieldError>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={adding}
                onClick={() => setAddOpen(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={adding || !addPhone.trim()}
                aria-busy={adding}
              >
                {adding ? "添加中…" : "确认添加"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={unbindTarget !== null}
        onOpenChange={(next) => {
          if (unbinding) return;
          if (!next) {
            setUnbindTarget(null);
            setUnbindError(null);
          }
        }}
        title="确认取消与这位老人的绑定？"
        description="取消后你将不再看到这位老人的档案与数据；如需恢复，可用手机号重新添加。"
        confirmText="取消绑定"
        busy={unbinding}
        onConfirm={() => void handleUnbind()}
      >
        {unbindError ? (
          <p className="mb-3 text-[13px] text-critical" role="alert">
            {unbindError}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
