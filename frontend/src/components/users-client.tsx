"use client";

import { Eye, Pencil, RefreshCw, Users } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { ElderRoleBadge } from "@/components/member-role-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
import { api, ApiError } from "@/lib/api";
import { RELATION_LABELS, labelOf } from "@/lib/format";
import type { UserElder, UserOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  family: "家属",
};

const ROLE_OPTIONS = [
  { value: "admin", label: "管理员" },
  { value: "family", label: "家属" },
];

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge tone={role === "admin" ? "brand" : "neutral"}>
      {ROLE_LABELS[role] ?? role}
    </Badge>
  );
}

export function UsersClient() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editUser, setEditUser] = useState<UserOut | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState("family");
  const [editPassword, setEditPassword] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [relationUser, setRelationUser] = useState<UserOut | null>(null);
  const [relationElders, setRelationElders] = useState<UserElder[]>([]);
  const [relationLoading, setRelationLoading] = useState(false);
  const [relationError, setRelationError] = useState<string | null>(null);
  // 抽屉未使用 SheetTrigger，关闭时需要手动把焦点还给当初点开的「查看」按钮
  const relationTriggerRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<UserOut[]>("/api/v1/users");
      setUsers(data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载用户列表失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 抽屉里的监护关系按账号维度拉取，关闭抽屉即取消请求
  useEffect(() => {
    if (relationUser === null) return;
    const controller = new AbortController();
    setRelationLoading(true);
    setRelationError(null);
    setRelationElders([]);
    api
      .get<UserElder[]>(
        `/api/v1/users/${relationUser.id}/elders`,
        controller.signal
      )
      .then((data) => setRelationElders(data))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        setRelationError(
          caught instanceof Error ? caught.message : "加载监护关系失败"
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setRelationLoading(false);
      });
    return () => controller.abort();
  }, [relationUser]);

  const openEditDialog = useCallback((user: UserOut) => {
    setEditUser(user);
    setEditDisplayName(user.display_name ?? "");
    setEditPhone(user.phone ?? "");
    setEditRole(user.role);
    setEditPassword("");
    setEditError(null);
  }, []);

  const saveUser = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!editUser) return;
      if (editPassword && editPassword.length < 6) {
        setEditError("重置密码至少 6 位");
        return;
      }

      setSaving(true);
      setEditError(null);
      try {
        const body: Record<string, unknown> = {
          display_name: editDisplayName.trim() || null,
          phone: editPhone.trim() || null,
          role: editRole,
        };
        if (editPassword) body.password = editPassword;
        const updated = await api.patch<UserOut>(
          `/api/v1/users/${editUser.id}`,
          body
        );
        setUsers((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
        toast({
          title: "已保存",
          description: `账号 ${updated.username} 已更新`,
          variant: "success",
        });
        setEditUser(null);
      } catch (caught) {
        setEditError(
          caught instanceof ApiError ? caught.message : "保存失败，请稍后重试"
        );
      } finally {
        setSaving(false);
      }
    },
    [editUser, editDisplayName, editPhone, editRole, editPassword, toast]
  );

  return (
    <div>
      <PageHeader
        title="用户列表"
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

      {loading ? (
        <TableWrapper>
          <TableSkeleton rows={6} columns={7} />
        </TableWrapper>
      ) : error ? (
        <div className="rounded-[8px] border border-line bg-panel">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-[8px] border border-line bg-panel">
          <EmptyState
            title="暂无用户"
            description="系统中还没有可展示的账号。"
          />
        </div>
      ) : (
        <TableWrapper>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>ID</TH>
                <TH>账号</TH>
                <TH>角色</TH>
                <TH>显示名</TH>
                <TH>手机号</TH>
                <TH>监护关系</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {users.map((user) => (
                <TR key={user.id}>
                  <TD className="tabular-nums text-ink-muted">#{user.id}</TD>
                  <TD className="font-medium">{user.username}</TD>
                  <TD>
                    <RoleBadge role={user.role} />
                  </TD>
                  <TD>{user.display_name || "—"}</TD>
                  <TD className="tabular-nums text-ink-muted">
                    {user.phone || "—"}
                  </TD>
                  <TD>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`查看 ${user.username} 的监护关系`}
                      onClick={(event) => {
                        relationTriggerRef.current = event.currentTarget;
                        setRelationUser(user);
                      }}
                    >
                      <Eye />
                      查看
                    </Button>
                  </TD>
                  <TD>
                    <div className="flex justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditDialog(user)}
                      >
                        <Pencil />
                        编辑
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}

      {!loading && !error && users.length > 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-muted">
          <Users className="size-3.5" aria-hidden="true" />
          共 {users.length} 个账号
        </p>
      ) : null}

      <Dialog
        open={editUser !== null}
        onOpenChange={(open) => {
          if (!open) setEditUser(null);
        }}
      >
        <DialogContent
          title="编辑用户"
          description="账号名不可修改；重置密码留空表示保持不变。"
        >
          <form onSubmit={saveUser} className="space-y-4">
            <FieldError>{editError}</FieldError>

            <div>
              <Label htmlFor="edit-username">账号</Label>
              <Input
                id="edit-username"
                value={editUser?.username ?? ""}
                disabled
              />
            </div>

            <div>
              <Label htmlFor="edit-display-name">显示名</Label>
              <Input
                id="edit-display-name"
                value={editDisplayName}
                maxLength={64}
                placeholder="例如：张奶奶家属"
                onChange={(event) => setEditDisplayName(event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="edit-phone">手机号</Label>
              <Input
                id="edit-phone"
                value={editPhone}
                maxLength={32}
                placeholder="例如：13800000000"
                onChange={(event) => setEditPhone(event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="edit-role">角色</Label>
              <Select
                value={editRole}
                onValueChange={setEditRole}
                options={ROLE_OPTIONS}
                aria-label="角色"
              />
            </div>

            <div>
              <Label htmlFor="edit-password">重置密码</Label>
              <Input
                id="edit-password"
                type="password"
                value={editPassword}
                autoComplete="new-password"
                placeholder="留空则不修改，至少 6 位"
                onChange={(event) => setEditPassword(event.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditUser(null)}
              >
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet
        open={relationUser !== null}
        onOpenChange={(open) => {
          if (!open) setRelationUser(null);
        }}
      >
        <SheetContent
          title="监护关系"
          description={
            relationUser
              ? `账号 ${relationUser.username} 关联的老人与成员角色`
              : undefined
          }
          onCloseAutoFocus={(event) => {
            // 关闭后焦点回到触发按钮；转交编辑弹窗时由弹窗自行接管焦点
            event.preventDefault();
            relationTriggerRef.current?.focus();
          }}
        >
          {relationUser ? (
            <div className="flex flex-col gap-5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="min-w-0">
                  <dt className="text-[12px] text-ink-muted">账号</dt>
                  <dd className="mt-1 truncate text-[13px] text-ink">
                    {relationUser.username}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[12px] text-ink-muted">显示名</dt>
                  <dd className="mt-1 truncate text-[13px] text-ink">
                    {relationUser.display_name || "—"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[12px] text-ink-muted">手机号</dt>
                  <dd className="mt-1 truncate text-[13px] tabular-nums text-ink">
                    {relationUser.phone || "—"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[12px] text-ink-muted">全局角色</dt>
                  <dd className="mt-1">
                    <RoleBadge role={relationUser.role} />
                  </dd>
                </div>
              </dl>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[13px] font-medium text-ink">关联老人</h3>
                  <span className="text-[12px] text-ink-muted">
                    {relationElders.length} 位
                  </span>
                </div>
                {relationLoading ? (
                  <p className="mt-3 text-[13px] text-ink-muted">
                    正在加载关联老人…
                  </p>
                ) : relationError ? (
                  <p className="mt-3 text-[13px] text-critical" role="alert">
                    {relationError}
                  </p>
                ) : relationElders.length === 0 ? (
                  <p className="mt-3 text-[13px] text-ink-muted">
                    该账号暂未关联任何老人。
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-line rounded-[6px] border border-line">
                    {relationElders.map((row) => (
                      <li
                        key={row.elder_id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] text-ink">
                            {row.name}
                          </span>
                          <span className="mt-0.5 block text-[12px] text-ink-muted">
                            {labelOf(RELATION_LABELS, row.relation, "关系未填写")}
                          </span>
                        </span>
                        <ElderRoleBadge role={row.role} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex justify-end border-t border-line pt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const target = relationUser;
                    setRelationUser(null);
                    if (target) openEditDialog(target);
                  }}
                >
                  <Pencil />
                  编辑账号
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
