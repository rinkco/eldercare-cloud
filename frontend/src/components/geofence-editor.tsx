"use client";

import {
  Info,
  MapPinned,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldError, Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import type { Geofence, GeofenceInput } from "@/lib/types";

type EditableField = "name" | "centerLat" | "centerLon" | "radius";

interface EditableGeofence {
  key: string;
  name: string;
  centerLat: string;
  centerLon: string;
  radius: string;
  enabled: boolean;
}

function fieldId(rowKey: string, field: EditableField): string {
  return `geofence-${rowKey}-${field}`;
}

function fieldErrorId(rowKey: string, field: EditableField): string {
  return `${fieldId(rowKey, field)}-error`;
}

function toEditable(geofence: Geofence, key: string): EditableGeofence {
  return {
    key,
    name: geofence.name,
    centerLat: String(geofence.center_lat),
    centerLon: String(geofence.center_lon),
    radius: String(geofence.radius_m),
    enabled: geofence.enabled,
  };
}

function validateRows(rows: EditableGeofence[]): {
  items: GeofenceInput[];
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const items = rows.map((row) => {
    const name = row.name.trim();
    const lat = Number(row.centerLat);
    const lon = Number(row.centerLon);
    const radius = Number(row.radius);

    if (name.length < 1 || name.length > 64) {
      errors[`${row.key}.name`] = "名称需要填写 1 到 64 个字符。";
    }
    if (
      row.centerLat.trim() === "" ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90
    ) {
      errors[`${row.key}.centerLat`] = "纬度需在 -90 到 90 之间。";
    }
    if (
      row.centerLon.trim() === "" ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180
    ) {
      errors[`${row.key}.centerLon`] = "经度需在 -180 到 180 之间。";
    }
    if (
      row.radius.trim() === "" ||
      !Number.isInteger(radius) ||
      radius < 50 ||
      radius > 5000
    ) {
      errors[`${row.key}.radius`] = "半径需为 50 到 5000 之间的整数。";
    }

    return {
      name,
      center_lat: lat,
      center_lon: lon,
      radius_m: radius,
      enabled: row.enabled,
    };
  });

  return { items, errors };
}

export function GeofenceEditor({
  elderId,
  elderName,
}: {
  elderId: number;
  elderName?: string;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<EditableGeofence[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedElderId, setLoadedElderId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const sequence = useRef(0);

  const createRow = useCallback((): EditableGeofence => {
    sequence.current += 1;
    return {
      key: `new-${sequence.current}`,
      name: "",
      centerLat: "",
      centerLon: "",
      radius: "100",
      enabled: true,
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setLoadError(null);
    setFormError(null);
    api
      .get<Geofence[]>(`/api/v1/geofences/${elderId}`, controller.signal)
      .then((data) => {
        if (!active) return;
        setRows(
          data.map((geofence) => {
            sequence.current += 1;
            return toEditable(geofence, `fence-${sequence.current}`);
          })
        );
        setErrors({});
        setLoadedElderId(elderId);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setLoadError(
          caught instanceof Error ? caught.message : "加载电子围栏失败"
        );
        setLoadedElderId(elderId);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [elderId, reloadKey]);

  const isLoading = loading || loadedElderId !== elderId;
  const busy = saving || clearing;

  function updateRow(
    rowKey: string,
    field: EditableField,
    value: string
  ) {
    setRows((current) =>
      current.map((row) => (row.key === rowKey ? { ...row, [field]: value } : row))
    );
    setErrors((current) => {
      const next = { ...current };
      delete next[`${rowKey}.${field}`];
      return next;
    });
    setFormError(null);
  }

  function updateEnabled(rowKey: string, enabled: boolean) {
    setRows((current) =>
      current.map((row) => (row.key === rowKey ? { ...row, enabled } : row))
    );
  }

  function addRow() {
    const row = createRow();
    setRows((current) => [...current, row]);
    setFormError(null);
    window.setTimeout(() => {
      document.getElementById(fieldId(row.key, "name"))?.focus();
    }, 0);
  }

  function removeRow(rowKey: string) {
    setRows((current) => current.filter((row) => row.key !== rowKey));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${rowKey}.`)) delete next[key];
      }
      return next;
    });
    setFormError(null);
  }

  function focusFirstError(nextErrors: Record<string, string>) {
    const firstKey = Object.keys(nextErrors)[0];
    if (!firstKey) return;
    const [rowKey, field] = firstKey.split(".");
    if (!rowKey || !field) return;
    window.setTimeout(() => {
      document.getElementById(fieldId(rowKey, field as EditableField))?.focus();
    }, 0);
  }

  async function saveRows() {
    if (rows.length === 0) {
      setFormError("请先添加至少一个围栏，再执行保存。");
      return;
    }

    const result = validateRows(rows);
    setErrors(result.errors);
    if (Object.keys(result.errors).length > 0) {
      setFormError("请修正围栏字段后再保存。");
      focusFirstError(result.errors);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const data = await api.put<Geofence[]>(
        `/api/v1/geofences/${elderId}`,
        result.items
      );
      setRows(
        data.map((geofence) => {
          sequence.current += 1;
          return toEditable(geofence, `fence-${sequence.current}`);
        })
      );
      setErrors({});
      setLoadedElderId(elderId);
      toast({
        title: "围栏已保存",
        description: `已保存 ${data.length} 个电子围栏。`,
        variant: "success",
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "保存电子围栏失败";
      setFormError(message);
      toast({
        title: "保存失败",
        description: message,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function clearRows() {
    setClearing(true);
    setClearError(null);
    try {
      const data = await api.put<Geofence[]>(
        `/api/v1/geofences/${elderId}`,
        []
      );
      setRows([]);
      setErrors({});
      setFormError(null);
      setClearOpen(false);
      setLoadedElderId(elderId);
      toast({
        title: "围栏已清空",
        description: "该老人当前的电子围栏已全部移除。",
        variant: "success",
      });
      if (data.length > 0) {
        setRows(
          data.map((geofence) => {
            sequence.current += 1;
            return toEditable(geofence, `fence-${sequence.current}`);
          })
        );
      }
    } catch (caught) {
      setClearError(
        caught instanceof Error ? caught.message : "清空电子围栏失败"
      );
    } finally {
      setClearing(false);
    }
  }

  return (
    <section className="@container rounded-[8px] border border-line bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-white/5 text-ink-muted"
            aria-hidden="true"
          >
            <MapPinned className="size-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-medium text-ink">电子围栏</h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              {elderName ? `维护 ${elderName} 的安全活动范围。` : "维护老人的安全活动范围。"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={addRow}
            disabled={isLoading || busy || Boolean(loadError)}
          >
            <Plus />
            添加围栏
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void saveRows()}
            disabled={isLoading || busy || Boolean(loadError)}
          >
            <Save />
            {saving ? "保存中…" : "保存围栏"}
          </Button>
        </div>
      </header>

      <div className="flex items-start gap-2 border-b border-line bg-white/[0.02] px-4 py-3 text-[12px] leading-5 text-ink-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <p>
          保存时会整体替换该长辈的全部围栏，列表中未出现的围栏会被删除。
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4 px-4 py-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="grid grid-cols-2 gap-3 border-b border-line pb-4 last:border-b-0 last:pb-0 @xl:grid-cols-6"
            >
              <Skeleton className="col-span-2 h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <ErrorState
          message={loadError}
          onRetry={() => setReloadKey((current) => current + 1)}
        />
      ) : (
        <>
          {formError ? (
            <div
              className="mx-4 mt-4 rounded-[6px] border border-critical/35 bg-critical/8 px-3 py-2 text-[13px] text-critical"
              role="alert"
            >
              {formError}
            </div>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              title="尚未设置电子围栏"
              description="添加围栏后，老人离开活动范围时会触发围栏越界事件。"
              action={
                <Button variant="primary" size="sm" onClick={addRow}>
                  <Plus />
                  添加围栏
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-line">
              {rows.map((row, index) => (
                <fieldset
                  key={row.key}
                  className="grid grid-cols-2 gap-3 px-4 py-4 @xl:grid-cols-6"
                >
                  <legend className="sr-only">第 {index + 1} 个围栏</legend>

                  <div className="col-span-2 min-w-0">
                    <Label htmlFor={fieldId(row.key, "name")}>名称</Label>
                    <Input
                      id={fieldId(row.key, "name")}
                      value={row.name}
                      maxLength={64}
                      placeholder="例如：小区范围"
                      onChange={(event) =>
                        updateRow(row.key, "name", event.target.value)
                      }
                      aria-invalid={Boolean(errors[`${row.key}.name`])}
                      aria-describedby={
                        errors[`${row.key}.name`]
                          ? fieldErrorId(row.key, "name")
                          : undefined
                      }
                    />
                    <div id={fieldErrorId(row.key, "name")}>
                      <FieldError>{errors[`${row.key}.name`]}</FieldError>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <Label htmlFor={fieldId(row.key, "centerLat")}>
                      中心纬度
                    </Label>
                    <Input
                      id={fieldId(row.key, "centerLat")}
                      type="number"
                      inputMode="decimal"
                      min={-90}
                      max={90}
                      step="any"
                      value={row.centerLat}
                      placeholder="31.2304"
                      onChange={(event) =>
                        updateRow(row.key, "centerLat", event.target.value)
                      }
                      aria-invalid={Boolean(errors[`${row.key}.centerLat`])}
                      aria-describedby={
                        errors[`${row.key}.centerLat`]
                          ? fieldErrorId(row.key, "centerLat")
                          : undefined
                      }
                    />
                    <div id={fieldErrorId(row.key, "centerLat")}>
                      <FieldError>
                        {errors[`${row.key}.centerLat`]}
                      </FieldError>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <Label htmlFor={fieldId(row.key, "centerLon")}>
                      中心经度
                    </Label>
                    <Input
                      id={fieldId(row.key, "centerLon")}
                      type="number"
                      inputMode="decimal"
                      min={-180}
                      max={180}
                      step="any"
                      value={row.centerLon}
                      placeholder="121.4737"
                      onChange={(event) =>
                        updateRow(row.key, "centerLon", event.target.value)
                      }
                      aria-invalid={Boolean(errors[`${row.key}.centerLon`])}
                      aria-describedby={
                        errors[`${row.key}.centerLon`]
                          ? fieldErrorId(row.key, "centerLon")
                          : undefined
                      }
                    />
                    <div id={fieldErrorId(row.key, "centerLon")}>
                      <FieldError>
                        {errors[`${row.key}.centerLon`]}
                      </FieldError>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <Label htmlFor={fieldId(row.key, "radius")}>
                      半径（米）
                    </Label>
                    <Input
                      id={fieldId(row.key, "radius")}
                      type="number"
                      inputMode="numeric"
                      min={50}
                      max={5000}
                      step={1}
                      value={row.radius}
                      placeholder="100"
                      onChange={(event) =>
                        updateRow(row.key, "radius", event.target.value)
                      }
                      aria-invalid={Boolean(errors[`${row.key}.radius`])}
                      aria-describedby={
                        errors[`${row.key}.radius`]
                          ? fieldErrorId(row.key, "radius")
                          : undefined
                      }
                    />
                    <div id={fieldErrorId(row.key, "radius")}>
                      <FieldError>{errors[`${row.key}.radius`]}</FieldError>
                    </div>
                  </div>

                  <div className="col-span-2 flex items-end justify-between gap-3 pb-1 @xl:col-span-1">
                    <label className="flex h-9 cursor-pointer select-none items-center gap-2">
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={`第 ${index + 1} 个围栏${
                          row.enabled ? "已启用" : "已停用"
                        }`}
                        checked={row.enabled}
                        onChange={(event) =>
                          updateEnabled(row.key, event.target.checked)
                        }
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className="relative h-5 w-9 rounded-full bg-white/12 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-ink after:transition-transform peer-checked:bg-brand/70 peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand"
                      />
                      <span className="text-[12px] text-ink-muted">
                        {row.enabled ? "启用" : "停用"}
                      </span>
                    </label>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-ink-muted hover:text-critical"
                      onClick={() => removeRow(row.key)}
                      aria-label={`删除第 ${index + 1} 个围栏`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </fieldset>
              ))}
            </div>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              半径支持 50 到 5000 米。
            </p>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setClearError(null);
                setClearOpen(true);
              }}
              disabled={rows.length === 0 || busy}
            >
              <Trash2 />
              清空全部围栏
            </Button>
          </footer>
        </>
      )}

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={(open) => {
          if (clearing) return;
          setClearOpen(open);
          if (!open) setClearError(null);
        }}
        title="清空全部围栏"
        description={
          elderName
            ? `确认清空 ${elderName} 的全部电子围栏吗？`
            : "确认清空该老人的全部电子围栏吗？"
        }
        confirmText="确认清空"
        danger
        busy={clearing}
        onConfirm={() => void clearRows()}
      >
        <p className="mb-3 text-[13px] leading-6 text-ink-muted">
          此操作会整体替换为空列表，清空后无法恢复。
        </p>
        {clearError ? (
          <p
            className="mb-2 rounded-[6px] border border-critical/35 bg-critical/8 px-3 py-2 text-[13px] text-critical"
            role="alert"
          >
            {clearError}
          </p>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
