"use client";

import {
  ArrowLeft,
  Save,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  FieldError,
  Input,
  Label,
  Textarea,
} from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toLocalInputValue } from "@/lib/format";
import type { Elder, ElderInput } from "@/lib/types";

const GENDER_UNSET = "__unset__";

const GENDER_OPTIONS = [
  { value: GENDER_UNSET, label: "未填写" },
  { value: "male", label: "男" },
  { value: "female", label: "女" },
  { value: "other", label: "其他" },
];

interface ElderFormState {
  name: string;
  gender: string;
  birth_date: string;
  height_cm: string;
  weight_kg: string;
  address: string;
  notes: string;
}

type FormErrors = Partial<Record<keyof ElderFormState, string>>;
type IdState = "loading" | "create" | "edit" | "invalid";

const EMPTY_FORM: ElderFormState = {
  name: "",
  gender: GENDER_UNSET,
  birth_date: "",
  height_cm: "",
  weight_kg: "",
  address: "",
  notes: "",
};

function charLength(value: string): number {
  return Array.from(value).length;
}

function normalizeGender(value: string | null): string {
  if (value === "male" || value === "female" || value === "other") {
    return value;
  }
  return GENDER_UNSET;
}

function formFromElder(elder: Elder): ElderFormState {
  return {
    name: elder.name,
    gender: normalizeGender(elder.gender),
    birth_date: toLocalInputValue(elder.birth_date),
    height_cm: elder.height_cm === null ? "" : String(elder.height_cm),
    weight_kg: elder.weight_kg === null ? "" : String(elder.weight_kg),
    address: elder.address ?? "",
    notes: elder.notes ?? "",
  };
}

function describeLoadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "无权访问这位老人的档案。";
    if (error.status === 404) return "老人档案不存在。";
    return error.message;
  }
  return error instanceof Error ? error.message : "加载老人档案失败";
}

function describeSaveError(error: unknown, editing: boolean): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return editing
        ? "无权编辑这位老人的档案。"
        : "无权新建老人档案。";
    }
    if (error.status === 404) return "老人档案不存在。";
    return error.message;
  }
  return error instanceof Error ? error.message : "保存老人档案失败";
}

function validateForm(form: ElderFormState): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();

  if (!name) {
    errors.name = "请输入老人姓名。";
  } else if (charLength(name) > 64) {
    errors.name = "姓名不能超过 64 个字符。";
  }

  if (form.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.birth_date)) {
    errors.birth_date = "请输入有效的出生日期。";
  }

  if (form.height_cm.trim()) {
    const height = Number(form.height_cm);
    if (!Number.isInteger(height) || height < 30 || height > 250) {
      errors.height_cm = "身高请输入 30 到 250 之间的整数。";
    }
  }

  if (form.weight_kg.trim()) {
    const weight = Number(form.weight_kg);
    if (!Number.isFinite(weight) || weight < 1 || weight > 500) {
      errors.weight_kg = "体重请输入 1 到 500 之间的数字。";
    }
  }

  if (charLength(form.address) > 255) {
    errors.address = "地址不能超过 255 个字符。";
  }

  return errors;
}

export function ElderEditClient() {
  const { session } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [idState, setIdState] = useState<IdState>("loading");
  const [elderId, setElderId] = useState<number | null>(null);
  const [form, setForm] = useState<ElderFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawId = params.get("id");

    if (rawId === null) {
      setIdState("create");
      return;
    }

    const parsedId = Number(rawId);
    if (!rawId.trim() || !Number.isInteger(parsedId) || parsedId <= 0) {
      setIdState("invalid");
      return;
    }

    setElderId(parsedId);
    setIdState("edit");
  }, []);

  useEffect(() => {
    if (idState !== "edit" || elderId === null || !session) return;

    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadError(null);

    api
      .get<Elder>(`/api/v1/elders/${elderId}`, controller.signal)
      .then((data) => {
        if (!active) return;
        setForm(formFromElder(data));
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        if (active) setLoadError(describeLoadError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [elderId, idState, reloadKey, session]);

  const isEditing = idState === "edit";
  const pageTitle =
    idState === "invalid" ? "老人编辑" : isEditing ? "编辑老人" : "新建老人";

  const updateField = <Key extends keyof ElderFormState>(
    key: Key,
    value: ElderFormState[Key]
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSubmitError(null);
  };

  const goBack = () => {
    router.push("/elders");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || loading || idState === "invalid") return;

    const nextErrors = validateForm(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setSubmitError("请先修正表单中的错误。");
      return;
    }

    const payload: ElderInput = {
      name: form.name.trim(),
      gender: form.gender === GENDER_UNSET ? null : form.gender,
      birth_date: form.birth_date || null,
      height_cm: form.height_cm.trim() ? Number(form.height_cm) : null,
      weight_kg: form.weight_kg.trim() ? Number(form.weight_kg) : null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    };

    setSubmitting(true);
    setSubmitError(null);
    try {
      const saved = isEditing && elderId !== null
        ? await api.put<Elder>(`/api/v1/elders/${elderId}`, payload)
        : await api.post<Elder>("/api/v1/elders", payload);
      toast({
        title: isEditing ? "老人档案已保存" : "老人档案已创建",
        description: "已跳转到老人详情。",
        variant: "success",
      });
      router.push(`/elders/detail?id=${saved.id}`);
    } catch (caught: unknown) {
      setSubmitError(describeSaveError(caught, isEditing));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (elderId === null || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete<void>(`/api/v1/elders/${elderId}`);
      setDeleteOpen(false);
      toast({
        title: "老人档案已删除",
        description: "绑定的设备已自动解绑。",
        variant: "success",
      });
      router.push("/elders");
    } catch (caught: unknown) {
      setDeleteError(describeSaveError(caught, true));
    } finally {
      setDeleting(false);
    }
  };

  if (idState === "loading") {
    return (
      <div className="rounded-[8px] border border-line bg-panel px-6 py-12 text-center text-[13px] text-ink-muted">
        正在读取档案信息…
      </div>
    );
  }

  if (idState === "invalid") {
    return (
      <div>
        <PageHeader title={pageTitle} />
        <div className="rounded-[8px] border border-line bg-panel">
          <ErrorState message="链接中的老人编号无效，请返回列表重新选择。" />
          <div className="flex justify-center pb-8">
            <Button variant="secondary" onClick={goBack}>
              <ArrowLeft />
              返回老人列表
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isEditing && loadError) {
    return (
      <div>
        <PageHeader title={pageTitle} />
        <div className="rounded-[8px] border border-line bg-panel">
          <ErrorState
            message={loadError}
            onRetry={() => setReloadKey((current) => current + 1)}
          />
          <div className="flex justify-center pb-8">
            <Button variant="secondary" onClick={goBack}>
              <ArrowLeft />
              返回老人列表
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={pageTitle}
        actions={
          <Button variant="secondary" onClick={goBack}>
            <ArrowLeft />
            返回列表
          </Button>
        }
      />

      {isEditing && loading ? (
        <div className="rounded-[8px] border border-line bg-panel px-6 py-12 text-center text-[13px] text-ink-muted">
          正在加载档案内容…
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <section className="rounded-[8px] border border-line bg-panel">
            <header className="border-b border-line px-4 py-3">
              <h2 className="text-[15px] font-medium text-ink">基础信息</h2>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                带星号的字段为必填项。
              </p>
            </header>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="elder-name">姓名 *</Label>
                <Input
                  id="elder-name"
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  maxLength={64}
                  placeholder="请输入老人姓名"
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "elder-name-error" : undefined}
                />
                <div id="elder-name-error">
                  <FieldError>{errors.name}</FieldError>
                </div>
              </div>

              <div>
                <Label htmlFor="elder-gender">性别</Label>
                <Select
                  value={form.gender}
                  onValueChange={(value) => updateField("gender", value)}
                  options={GENDER_OPTIONS}
                  aria-label="性别"
                />
              </div>

              <div>
                <Label htmlFor="elder-birth-date">出生日期</Label>
                <Input
                  id="elder-birth-date"
                  type="date"
                  value={form.birth_date}
                  onChange={(event) =>
                    updateField("birth_date", event.target.value)
                  }
                  aria-invalid={Boolean(errors.birth_date)}
                  aria-describedby={
                    errors.birth_date ? "elder-birth-date-error" : undefined
                  }
                />
                <div id="elder-birth-date-error">
                  <FieldError>{errors.birth_date}</FieldError>
                </div>
              </div>

              <div>
                <Label htmlFor="elder-height">身高（cm）</Label>
                <Input
                  id="elder-height"
                  type="number"
                  min={30}
                  max={250}
                  step={1}
                  value={form.height_cm}
                  onChange={(event) =>
                    updateField("height_cm", event.target.value)
                  }
                  placeholder="30–250"
                  aria-invalid={Boolean(errors.height_cm)}
                  aria-describedby={
                    errors.height_cm ? "elder-height-error" : undefined
                  }
                />
                <div id="elder-height-error">
                  <FieldError>{errors.height_cm}</FieldError>
                </div>
              </div>

              <div>
                <Label htmlFor="elder-weight">体重（kg）</Label>
                <Input
                  id="elder-weight"
                  type="number"
                  min={1}
                  max={500}
                  step={0.1}
                  value={form.weight_kg}
                  onChange={(event) =>
                    updateField("weight_kg", event.target.value)
                  }
                  placeholder="1–500"
                  aria-invalid={Boolean(errors.weight_kg)}
                  aria-describedby={
                    errors.weight_kg ? "elder-weight-error" : undefined
                  }
                />
                <div id="elder-weight-error">
                  <FieldError>{errors.weight_kg}</FieldError>
                </div>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="elder-address">地址</Label>
                <Input
                  id="elder-address"
                  value={form.address}
                  onChange={(event) =>
                    updateField("address", event.target.value)
                  }
                  maxLength={255}
                  placeholder="请输入居住地址"
                  aria-invalid={Boolean(errors.address)}
                  aria-describedby={
                    errors.address ? "elder-address-error" : undefined
                  }
                />
                <div id="elder-address-error">
                  <FieldError>{errors.address}</FieldError>
                </div>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="elder-notes">备注</Label>
                <Textarea
                  id="elder-notes"
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                  placeholder="可记录病史、护理注意事项等"
                  rows={5}
                />
              </div>
            </div>
          </section>

          {submitError ? (
            <p
              className="mt-3 rounded-[6px] border border-critical/30 bg-critical/10 px-3 py-2 text-[13px] text-critical"
              role="alert"
            >
              {submitError}
            </p>
          ) : null}

          <div className="mt-4 flex justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
              aria-busy={submitting}
            >
              <Save />
              {submitting ? "保存中…" : "保存老人"}
            </Button>
          </div>
        </form>
      )}

      {isEditing && !loading && !loadError ? (
        <section className="mt-6 rounded-[8px] border border-critical/30 bg-panel">
          <header className="border-b border-critical/20 px-4 py-3">
            <h2 className="text-[15px] font-medium text-critical">危险操作</h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              删除后会解除该老人当前绑定的所有设备。
            </p>
          </header>
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[13px] text-ink">删除老人档案</p>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                删除操作无法撤销，请确认你了解影响范围。
              </p>
            </div>
            <Button
              variant="danger"
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            >
              <Trash2 />
              删除老人
            </Button>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="确认删除老人档案？"
        description="删除后当前绑定的设备会自动解绑，操作无法撤销。"
        confirmText="删除老人"
        cancelText="取消"
        danger
        busy={deleting}
        onConfirm={() => void handleDelete()}
      >
        {deleteError ? (
          <p className="mb-3 text-[13px] text-critical" role="alert">
            {deleteError}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
