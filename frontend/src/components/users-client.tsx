"use client";

import { Pencil, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/input";
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
import { api, ApiError } from "@/lib/api";
import type { UserOut } from "@/lib/types";
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
          <TableSkeleton rows={6} columns={5} />
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
    </div>
  );
}
