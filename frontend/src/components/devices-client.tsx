"use client";

import { Cpu, Link2, Plus, RefreshCw, Unlink } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { ElderSelect, useElderList } from "@/components/elder-select";
import { RoleGuard } from "@/components/role-guard";
import { DeviceStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
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
import { useAuth } from "@/lib/auth";
import {
  DEVICE_KIND_LABELS,
  formatDateTime,
  formatRelative,
  labelOf,
} from "@/lib/format";
import type { Device } from "@/lib/types";
import { cn } from "@/lib/utils";

const DEVICE_UID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const DEVICE_KIND_OPTIONS = [
  { value: "esp32", label: "ESP32 终端" },
  { value: "phone", label: "手机" },
  { value: "wearable", label: "穿戴设备" },
  { value: "lora_node", label: "LoRa 节点" },
];

function validateDeviceUid(value: string): string | null {
  if (!value) return "请输入设备 UID。";
  if (!DEVICE_UID_PATTERN.test(value)) {
    return "设备 UID 需以字母或数字开头，仅使用字母、数字、下划线或连字符，最长 64 位。";
  }
  return null;
}

export function DevicesClient() {
  return (
    <RoleGuard allow={["admin"]}>
      <DevicesContent />
    </RoleGuard>
  );
}

function DevicesContent() {
  const { session } = useAuth();
  const { toast } = useToast();
  const { elders } = useElderList();

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [deviceUid, setDeviceUid] = useState("");
  const [deviceKind, setDeviceKind] = useState("esp32");
  const [deviceModel, setDeviceModel] = useState("");
  const [uidError, setUidError] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [bindDevice, setBindDevice] = useState<Device | null>(null);
  const [bindElderId, setBindElderId] = useState("");
  const [bindError, setBindError] = useState<string | null>(null);
  const [binding, setBinding] = useState(false);
  const [unbindDevice, setUnbindDevice] = useState<Device | null>(null);
  const [unbindError, setUnbindError] = useState<string | null>(null);
  const [unbinding, setUnbinding] = useState(false);

  const load = useCallback(
    async (showLoading = true) => {
      if (!session) return;
      if (showLoading) setLoading(true);
      try {
        const data = await api.get<Device[]>("/api/v1/devices");
        setDevices(data);
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "加载设备列表失败"
        );
      } finally {
        if (showLoading) setLoading(false);
        setRefreshing(false);
      }
    },
    [session]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const elderNames = useMemo(
    () => new Map(elders.map((elder) => [elder.id, elder.name])),
    [elders]
  );

  const openRegisterDialog = useCallback(() => {
    setDeviceUid("");
    setDeviceKind("esp32");
    setDeviceModel("");
    setUidError(null);
    setRegisterError(null);
    setRegisterOpen(true);
  }, []);

  const openBindDialog = useCallback((device: Device) => {
    setBindDevice(device);
    setBindElderId("");
    setBindError(null);
  }, []);

  const registerDevice = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const uid = deviceUid.trim();
      const validationError = validateDeviceUid(uid);
      if (validationError) {
        setUidError(validationError);
        return;
      }

      setUidError(null);
      setRegisterError(null);
      setRegistering(true);
      try {
        const created = await api.post<Device>("/api/v1/devices", {
          device_uid: uid,
          kind: deviceKind,
          model: deviceModel.trim() || null,
        });
        setDevices((current) => [...current, created]);
        setRegisterOpen(false);
        toast({
          title: "设备已注册",
          description: `${created.device_uid} · ${labelOf(DEVICE_KIND_LABELS, created.kind)}`,
          variant: "success",
        });
        void load(false);
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "注册设备失败。";
        if (caught instanceof ApiError && caught.status === 409) {
          setUidError(message);
        } else {
          setRegisterError(message);
        }
      } finally {
        setRegistering(false);
      }
    },
    [deviceUid, deviceKind, deviceModel, toast, load]
  );

  const bindDeviceToElder = useCallback(async () => {
    if (!bindDevice) return;
    if (!bindElderId) {
      setBindError("请选择要绑定的老人。");
      return;
    }

    setBindError(null);
    setBinding(true);
    try {
      const updated = await api.post<Device>(
        `/api/v1/devices/${bindDevice.id}/bind`,
        { elder_id: Number(bindElderId) }
      );
      setDevices((current) =>
        current.map((device) =>
          device.id === updated.id ? updated : device
        )
      );
      const elderName =
        elderNames.get(updated.elder_id ?? 0) ?? `#${updated.elder_id}`;
      setBindDevice(null);
      toast({
        title: "设备已绑定",
        description: `${updated.device_uid} 已绑定到 ${elderName}`,
        variant: "success",
      });
      void load(false);
    } catch (caught) {
      setBindError(
        caught instanceof Error ? caught.message : "绑定设备失败。"
      );
    } finally {
      setBinding(false);
    }
  }, [bindDevice, bindElderId, elderNames, toast, load]);

  const unbindDeviceFromElder = useCallback(async () => {
    if (!unbindDevice) return;
    setUnbinding(true);
    setUnbindError(null);
    try {
      const updated = await api.post<Device>(
        `/api/v1/devices/${unbindDevice.id}/unbind`
      );
      setDevices((current) =>
        current.map((device) =>
          device.id === updated.id ? updated : device
        )
      );
      setUnbindDevice(null);
      toast({
        title: "设备已解绑",
        description: `${updated.device_uid} 已回到未绑定状态，历史数据保留。`,
        variant: "success",
      });
      void load(false);
    } catch (caught) {
      setUnbindError(
        caught instanceof Error ? caught.message : "解绑设备失败。"
      );
    } finally {
      setUnbinding(false);
    }
  }, [unbindDevice, toast, load]);

  return (
    <div>
      <PageHeader
        title="设备管理"
        actions={
          <div className="flex items-center gap-2">
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
            <Button
              variant="primary"
              size="sm"
              onClick={openRegisterDialog}
            >
              <Plus />
              注册设备
            </Button>
          </div>
        }
      />

      {loading ? (
        <TableWrapper>
          <TableSkeleton rows={7} columns={8} />
        </TableWrapper>
      ) : error ? (
        <section className="rounded-[8px] border border-line bg-panel">
          <ErrorState message={error} onRetry={() => void load()} />
        </section>
      ) : devices.length === 0 ? (
        <section className="rounded-[8px] border border-line bg-panel">
          <EmptyState
            title="还没有注册设备"
            description="注册第一台 ESP32、手机或穿戴设备，然后把设备绑定到老人。"
            action={
              <Button variant="primary" size="sm" onClick={openRegisterDialog}>
                <Plus />
                注册第一台设备
              </Button>
            }
          />
        </section>
      ) : (
        <TableWrapper>
          <Table className="min-w-[1120px]" aria-label="设备列表">
            <THead>
              <TR className="hover:bg-transparent">
                <TH>设备 UID</TH>
                <TH>类型</TH>
                <TH>型号</TH>
                <TH>状态</TH>
                <TH>绑定老人</TH>
                <TH>电量</TH>
                <TH>最后在线</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {devices.map((device) => {
                const canBind =
                  device.elder_id === null && device.status !== "disabled";
                return (
                  <TR key={device.id}>
                    <TD className="whitespace-nowrap">
                      <span className="flex items-center gap-2 font-medium">
                        <Cpu
                          className="size-3.5 text-ink-muted"
                          aria-hidden="true"
                        />
                        {device.device_uid}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {labelOf(DEVICE_KIND_LABELS, device.kind)}
                    </TD>
                    <TD className="max-w-48 truncate text-ink-muted">
                      {device.model ?? "—"}
                    </TD>
                    <TD>
                      <DeviceStatusBadge status={device.status} />
                    </TD>
                    <TD className="whitespace-nowrap">
                      {device.elder_id === null
                        ? "未绑定"
                        : (elderNames.get(device.elder_id) ??
                          `#${device.elder_id}`)}
                    </TD>
                    <TD
                      className={cn(
                        "tabular-nums",
                        device.battery_percent !== null &&
                          device.battery_percent < 20
                          ? "text-warning"
                          : "text-ink-muted"
                      )}
                    >
                      {device.battery_percent === null
                        ? "—"
                        : `${device.battery_percent}%`}
                    </TD>
                    <TD
                      className="whitespace-nowrap text-ink-muted"
                      title={formatDateTime(device.last_seen_at)}
                    >
                      {formatRelative(device.last_seen_at)}
                    </TD>
                    <TD>
                      <div className="flex justify-end">
                        {device.elder_id !== null ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setUnbindDevice(device);
                              setUnbindError(null);
                            }}
                          >
                            <Unlink />
                            解绑
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!canBind}
                            onClick={() => openBindDialog(device)}
                          >
                            <Link2 />
                            {device.status === "disabled"
                              ? "已停用"
                              : "绑定"}
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableWrapper>
      )}

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent
          title="注册设备"
          description="注册后设备会出现在列表中，可继续绑定老人。"
        >
          <form onSubmit={registerDevice} className="space-y-4">
            {registerError ? (
              <p
                className="rounded-[6px] border border-critical/35 bg-critical/10 px-3 py-2 text-[13px] text-critical"
                role="alert"
              >
                {registerError}
              </p>
            ) : null}

            <div>
              <Label htmlFor="device-uid">设备 UID</Label>
              <Input
                id="device-uid"
                value={deviceUid}
                onChange={(event) => {
                  setDeviceUid(event.target.value);
                  if (uidError) setUidError(null);
                }}
                onInvalid={(event) => {
                  event.preventDefault();
                  setUidError(validateDeviceUid(deviceUid.trim()));
                }}
                required
                maxLength={64}
                pattern="^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
                aria-invalid={Boolean(uidError)}
                aria-describedby={uidError ? "device-uid-error" : undefined}
                placeholder="例如 eldercare-esp32-01"
                autoComplete="off"
              />
              {uidError ? (
                <p
                  id="device-uid-error"
                  className="mt-1 text-[12px] text-critical"
                  role="alert"
                >
                  {uidError}
                </p>
              ) : null}
            </div>

            <div>
              <Label>设备类型</Label>
              <Select
                value={deviceKind}
                onValueChange={setDeviceKind}
                options={DEVICE_KIND_OPTIONS}
                aria-label="设备类型"
              />
            </div>

            <div>
              <Label htmlFor="device-model">型号（可选）</Label>
              <Input
                id="device-model"
                value={deviceModel}
                onChange={(event) => setDeviceModel(event.target.value)}
                maxLength={64}
                placeholder="例如 ESP32-S3"
                autoComplete="off"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => setRegisterOpen(false)}
                disabled={registering}
              >
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={registering}>
                {registering ? "正在注册…" : "注册设备"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bindDevice !== null}
        onOpenChange={(open) => {
          if (!open && !binding) setBindDevice(null);
        }}
      >
        <DialogContent
          title="绑定设备"
          description={
            bindDevice
              ? `把 ${bindDevice.device_uid} 绑定到一位老人。`
              : undefined
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 border-b border-line pb-3">
              <span className="text-[12px] text-ink-muted">设备 UID</span>
              <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                {bindDevice?.device_uid}
              </span>
            </div>

            <div>
              <Label>绑定老人</Label>
              <ElderSelect
                value={bindElderId}
                onChange={(value) => {
                  setBindElderId(value);
                  if (bindError) setBindError(null);
                }}
                placeholder="请选择老人"
                ariaLabel={
                  bindError
                    ? `选择要绑定的老人：${bindError}`
                    : "选择要绑定的老人"
                }
              />
            </div>

            {bindError ? (
              <p
                className="rounded-[6px] border border-critical/35 bg-critical/10 px-3 py-2 text-[13px] text-critical"
                role="alert"
              >
                {bindError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => setBindDevice(null)}
                disabled={binding}
              >
                取消
              </Button>
              <Button
                variant="primary"
                onClick={() => void bindDeviceToElder()}
                disabled={binding}
              >
                <Link2 />
                {binding ? "正在绑定…" : "绑定"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={unbindDevice !== null}
        onOpenChange={(open) => {
          if (!open && !unbinding) {
            setUnbindDevice(null);
            setUnbindError(null);
          }
        }}
        title="解绑设备"
        description={
          unbindDevice
            ? `把 ${unbindDevice.device_uid} 从当前老人解绑？解绑后设备回到未绑定状态，历史遥测与事件保留。`
            : undefined
        }
        confirmText={unbinding ? "正在解绑…" : "解绑"}
        danger
        busy={unbinding}
        onConfirm={() => void unbindDeviceFromElder()}
      >
        {unbindError ? (
          <p
            className="rounded-[6px] border border-critical/35 bg-critical/10 px-3 py-2 text-[13px] text-critical"
            role="alert"
          >
            {unbindError}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
