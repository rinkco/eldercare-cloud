"use client";

import { RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
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
import { api } from "@/lib/api";
import type { UserOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  family: "家属",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge tone={role === "admin" ? "brand" : "neutral"}>
      {ROLE_LABELS[role] ?? role}
    </Badge>
  );
}

export function UsersClient() {
  const [users, setUsers] = useState<UserOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <PageHeader
        title="用户列表"
        description="查看系统中的管理员与家属账号，账号内容由后端种子配置维护。"
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
    </div>
  );
}
