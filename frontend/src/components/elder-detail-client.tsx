"use client";

import {
  ArrowLeft,
  BatteryMedium,
  Check,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { GeofenceEditor } from "@/components/geofence-editor";
import { ElderRoleBadge } from "@/components/member-role-badge";
import {
  AlertStatusBadge,
  DeviceStatusBadge,
  EventTypeBadge,
  SeverityBadge,
} from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { api, ApiError, buildQuery } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  ACTIVITY_LABELS,
  METRIC_LABELS,
  METRIC_UNITS,
  RELATION_LABELS,
  labelOf,
  formatDateTime,
  formatNumber,
  toLocalInputValue,
} from "@/lib/format";
import type {
  AccessCandidate,
  AccessMember,
  Alert,
  Contact,
  ContactInput,
  Device,
  Elder,
  EventRecord,
  Telemetry,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const GENDER_LABELS: Record<string, string> = {
  male: "男",
  female: "女",
  other: "其他",
};

interface ContactDraft {
  rowId: string;
  name: string;
  phone: string;
  relation: string;
  priority: string;
  is_primary: boolean;
}

function genderLabel(value: string | null | undefined): string {
  if (!value) return "未填写";
  return GENDER_LABELS[value] ?? value;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "无权查看该部分内容。";
    if (error.status === 404) return "请求的数据不存在。";
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-[15px] font-medium text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-5 text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

function InfoItem({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="mt-1 break-words text-[13px] text-ink">{value}</dd>
    </div>
  );
}

function telemetryValue(item: Telemetry): string {
  if (item.value_num !== null && item.value_num !== undefined) {
    const unit = METRIC_UNITS[item.metric];
    return `${formatNumber(item.value_num)}${unit ? ` ${unit}` : ""}`;
  }
  if (item.value_text) {
    if (item.metric === "activity") {
      return labelOf(ACTIVITY_LABELS, item.value_text);
    }
    return item.value_text;
  }
  return "—";
}

function telemetryLocation(item: Telemetry): string {
  if (item.lat === null || item.lon === null) return "—";
  return `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`;
}

function telemetrySignal(item: Telemetry): string {
  const meta = item.meta_json ?? {};
  const parts: string[] = [];
  if (typeof meta.rssi === "number") parts.push(`${meta.rssi} dBm`);
  if (typeof meta.snr === "number") parts.push(`${meta.snr} dB`);
  return parts.join(" / ") || "—";
}

function contactDraftFromContact(
  contact: Contact,
  rowId: string
): ContactDraft {
  return {
    rowId,
    name: contact.name,
    phone: contact.phone,
    relation: contact.relation ?? "",
    priority: String(contact.priority),
    is_primary: contact.is_primary,
  };
}

function validateContactDrafts(
  contacts: ContactDraft[]
): Record<string, string> {
  const errors: Record<string, string> = {};
  const primaryCount = contacts.filter((contact) => contact.is_primary).length;

  if (primaryCount > 1) {
    errors.__form = "最多只能设置一位主联系人。";
  }

  contacts.forEach((contact, index) => {
    const prefix = contact.rowId;
    const name = contact.name.trim();
    const phone = contact.phone.trim();
    const priority = Number(contact.priority);

    if (!name) {
      errors[`${prefix}.name`] = `请填写第 ${index + 1} 位联系人的姓名。`;
    } else if (Array.from(name).length > 64) {
      errors[`${prefix}.name`] = "联系人姓名不能超过 64 个字符。";
    }

    if (!phone) {
      errors[`${prefix}.phone`] = `请填写第 ${index + 1} 位联系人的电话。`;
    } else if (Array.from(phone).length > 32) {
      errors[`${prefix}.phone`] = "联系电话不能超过 32 个字符。";
    }

    if (contact.relation.trim().length > 32) {
      errors[`${prefix}.relation`] = "关系不能超过 32 个字符。";
    }

    if (!Number.isInteger(priority) || priority < 1 || priority > 99) {
      errors[`${prefix}.priority`] = "优先级请输入 1 到 99 之间的整数。";
    }
  });

  return errors;
}

export function ElderDetailClient() {
  const { session } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const draftCounter = useRef(0);

  const [idState, setIdState] = useState<"loading" | "ready" | "invalid">(
    "loading"
  );
  const [idMessage, setIdMessage] = useState(
    "缺少老人编号，请返回列表重新选择。"
  );
  const [elderId, setElderId] = useState<number | null>(null);

  const [elder, setElder] = useState<Elder | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [draftContacts, setDraftContacts] = useState<ContactDraft[]>([]);
  const [contactErrors, setContactErrors] = useState<Record<string, string>>({});
  const [contactSubmitError, setContactSubmitError] = useState<string | null>(
    null
  );
  const [savingContacts, setSavingContacts] = useState(false);
  // 替换联系人属于破坏性操作：已有联系人且内容变化时要求二次确认
  const [contactsConfirming, setContactsConfirming] = useState(false);
  const pendingContactsRef = useRef<ContactInput[] | null>(null);
  const contactsFormLocked = contactsConfirming || savingContacts;

  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  const [telemetry, setTelemetry] = useState<Telemetry[]>([]);
  const [telemetryLoading, setTelemetryLoading] = useState(true);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  const [members, setMembers] = useState<AccessMember[]>([]);
  // 区块只在 admin/owner 渲染，初始即为加载态，避免闪现「暂未授权家属」空态
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidates, setCandidates] = useState<AccessCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesSearched, setCandidatesSearched] = useState(false);
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"owner" | "member">("member");
  const [savingMember, setSavingMember] = useState(false);

  const isAdmin = session?.role === "admin";
  // 档案编辑与成员管理都按调用者在该老人上的角色门控（admin 的 my_role 也是 admin）
  const canEditProfile =
    elder?.my_role === "admin" || elder?.my_role === "owner";
  const canManageMembers = canEditProfile;
  // 候选账号里排除当前已是成员的行（接口已排除过一次，保存后仍需过滤）
  const availableCandidates = useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          !members.some((member) => member.user_id === candidate.id)
      ),
    [candidates, members]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawId = params.get("id");

    if (rawId === null || !rawId.trim()) {
      setIdMessage("缺少老人编号，请返回列表重新选择。");
      setIdState("invalid");
      return;
    }

    const parsedId = Number(rawId);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      setIdMessage("老人编号无效，请返回列表重新选择。");
      setIdState("invalid");
      return;
    }

    setElderId(parsedId);
    setIdState("ready");
  }, []);

  const loadProfile = useCallback(
    async (signal?: AbortSignal) => {
      if (!session || elderId === null) return;
      setProfileLoading(true);
      setProfileError(null);
      setNotFound(false);
      try {
        const data = await api.get<Elder>(
          `/api/v1/elders/${elderId}`,
          signal
        );
        setElder(data);
      } catch (caught: unknown) {
        if (isAbortError(caught)) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setNotFound(true);
          setProfileError("老人档案不存在。");
        } else if (caught instanceof ApiError && caught.status === 403) {
          setProfileError("无权查看这位老人的档案。");
        } else {
          setProfileError(describeError(caught, "加载老人档案失败。"));
        }
      } finally {
        if (!signal?.aborted) setProfileLoading(false);
      }
    },
    [elderId, session]
  );

  const loadContacts = useCallback(
    async (signal?: AbortSignal) => {
      if (!session || elderId === null) return;
      setContactsLoading(true);
      setContactsError(null);
      try {
        const data = await api.get<Contact[]>(
          `/api/v1/elders/${elderId}/contacts`,
          signal
        );
        setContacts(data);
      } catch (caught: unknown) {
        if (isAbortError(caught)) return;
        setContactsError(describeError(caught, "加载紧急联系人失败。"));
      } finally {
        if (!signal?.aborted) setContactsLoading(false);
      }
    },
    [elderId, session]
  );

  const loadDevices = useCallback(
    async (signal?: AbortSignal) => {
      if (!session || elderId === null) return;
      setDevicesLoading(true);
      setDevicesError(null);
      try {
        // 家属与管理台共用老人维度的只读设备接口
        const data = await api.get<Device[]>(
          `/api/v1/elders/${elderId}/devices`,
          signal
        );
        setDevices(data);
      } catch (caught: unknown) {
        if (isAbortError(caught)) return;
        setDevicesError(describeError(caught, "加载绑定设备失败。"));
      } finally {
        if (!signal?.aborted) setDevicesLoading(false);
      }
    },
    [elderId, session]
  );

  const loadTelemetry = useCallback(
    async (signal?: AbortSignal) => {
      if (!session || elderId === null) return;
      setTelemetryLoading(true);
      setTelemetryError(null);
      try {
        const data = await api.get<Telemetry[]>(
          `/api/v1/elders/${elderId}/telemetry${buildQuery({ limit: 20 })}`,
          signal
        );
        setTelemetry(data);
      } catch (caught: unknown) {
        if (isAbortError(caught)) return;
        setTelemetryError(describeError(caught, "加载最近遥测失败。"));
      } finally {
        if (!signal?.aborted) setTelemetryLoading(false);
      }
    },
    [elderId, session]
  );

  const loadEvents = useCallback(
    async (signal?: AbortSignal) => {
      if (!session || elderId === null) return;
      setEventsLoading(true);
      setEventsError(null);
      try {
        const data = await api.get<EventRecord[]>(
          `/api/v1/events${buildQuery({ elder_id: elderId, limit: 20 })}`,
          signal
        );
        setEvents(data);
      } catch (caught: unknown) {
        if (isAbortError(caught)) return;
        setEventsError(describeError(caught, "加载最近事件失败。"));
      } finally {
        if (!signal?.aborted) setEventsLoading(false);
      }
    },
    [elderId, session]
  );

  const loadAlerts = useCallback(
    async (signal?: AbortSignal) => {
      if (!session || elderId === null) return;
      setAlertsLoading(true);
      setAlertsError(null);
      try {
        const data = await api.get<Alert[]>(
          `/api/v1/alerts${buildQuery({ elder_id: elderId, limit: 20 })}`,
          signal
        );
        setAlerts(data);
      } catch (caught: unknown) {
        if (isAbortError(caught)) return;
        setAlertsError(describeError(caught, "加载最近告警失败。"));
      } finally {
        if (!signal?.aborted) setAlertsLoading(false);
      }
    },
    [elderId, session]
  );

  const loadMembers = useCallback(
    async (signal?: AbortSignal) => {
      if (!session || elderId === null || !canManageMembers) return;
      setMembersLoading(true);
      setMembersError(null);
      try {
        const access = await api.get<AccessMember[]>(
          `/api/v1/elders/${elderId}/access`,
          signal
        );
        setMembers(access);
      } catch (caught: unknown) {
        if (isAbortError(caught)) return;
        setMembersError(describeError(caught, "加载监护成员失败。"));
      } finally {
        if (!signal?.aborted) setMembersLoading(false);
      }
    },
    [canManageMembers, elderId, session]
  );

  const searchCandidates = useCallback(
    async (signal?: AbortSignal) => {
      if (elderId === null || !canManageMembers) return;
      const keyword = candidateQuery.trim();
      if (!keyword) {
        setCandidatesError("请输入账号或显示名关键字。");
        return;
      }
      setCandidatesLoading(true);
      setCandidatesError(null);
      try {
        const data = await api.get<AccessCandidate[]>(
          `/api/v1/elders/${elderId}/access/candidates${buildQuery({
            q: keyword,
          })}`,
          signal
        );
        setCandidates(data);
        setCandidatesSearched(true);
        setMemberUserId("");
      } catch (caught: unknown) {
        if (isAbortError(caught)) return;
        setCandidates([]);
        setCandidatesSearched(false);
        setCandidatesError(
          describeError(caught, "搜索候选家属账号失败。")
        );
      } finally {
        if (!signal?.aborted) setCandidatesLoading(false);
      }
    },
    [canManageMembers, candidateQuery, elderId]
  );

  const saveMembers = useCallback(
    async (
      next: Array<{
        user_id: number;
        role: "owner" | "member";
        relation: string | null;
      }>
    ) => {
      if (elderId === null) return;
      setSavingMember(true);
      setMembersError(null);
      try {
        // 接口是整体替换语义：既有行的 relation 由前端原样回填，改角色不清空关系
        const saved = await api.put<AccessMember[]>(
          `/api/v1/elders/${elderId}/access`,
          next
        );
        setMembers(saved);
        toast({
          title: "监护成员已更新",
          description: "家属可见范围将在 30 秒内自动生效。",
          variant: "success",
        });
      } catch (caught: unknown) {
        setMembersError(describeError(caught, "保存监护成员失败。"));
      } finally {
        setSavingMember(false);
      }
    },
    [elderId, toast]
  );

  useEffect(() => {
    if (idState !== "ready" || elderId === null) return;
    const controller = new AbortController();
    void loadProfile(controller.signal);
    void loadContacts(controller.signal);
    void loadDevices(controller.signal);
    void loadTelemetry(controller.signal);
    void loadEvents(controller.signal);
    void loadAlerts(controller.signal);
    return () => controller.abort();
  }, [
    elderId,
    idState,
    loadAlerts,
    loadContacts,
    loadDevices,
    loadEvents,
    loadProfile,
    loadTelemetry,
  ]);

  // 成员的可见与请求都取决于 my_role：member 不渲染成员区，也不发请求
  useEffect(() => {
    if (idState !== "ready" || elderId === null || !canManageMembers) return;
    const controller = new AbortController();
    void loadMembers(controller.signal);
    return () => controller.abort();
  }, [canManageMembers, elderId, idState, loadMembers]);

  const openContactsDialog = () => {
    setDraftContacts(
      contacts.map((contact) =>
        contactDraftFromContact(contact, `contact-${++draftCounter.current}`)
      )
    );
    setContactErrors({});
    setContactSubmitError(null);
    setContactsConfirming(false);
    pendingContactsRef.current = null;
    setContactsOpen(true);
  };

  const addContact = () => {
    setDraftContacts((current) => [
      ...current,
      {
        rowId: `contact-${++draftCounter.current}`,
        name: "",
        phone: "",
        relation: "",
        priority: String(current.length + 1),
        is_primary: current.length === 0,
      },
    ]);
    setContactErrors({});
    setContactSubmitError(null);
  };

  const updateContact = (
    rowId: string,
    patch: Partial<Omit<ContactDraft, "rowId">>
  ) => {
    setDraftContacts((current) =>
      current.map((contact) =>
        contact.rowId === rowId ? { ...contact, ...patch } : contact
      )
    );
    setContactErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${rowId}.`)) delete next[key];
      }
      delete next.__form;
      return next;
    });
    setContactSubmitError(null);
  };

  const removeContact = (rowId: string) => {
    setDraftContacts((current) =>
      current.filter((contact) => contact.rowId !== rowId)
    );
    setContactErrors({});
  };

  const setPrimaryContact = (rowId: string) => {
    setDraftContacts((current) =>
      current.map((contact) => ({
        ...contact,
        is_primary: contact.rowId === rowId,
      }))
    );
    setContactErrors((current) => {
      const next = { ...current };
      delete next.__form;
      return next;
    });
    setContactSubmitError(null);
  };

  function contactsDiffer(next: ContactInput[], current: Contact[]): boolean {
    const normalize = (item: {
      name: string;
      phone: string;
      relation?: string | null;
      priority: number;
      is_primary: boolean;
    }) =>
      [
        item.name,
        item.phone,
        item.relation ?? "",
        String(item.priority),
        String(item.is_primary),
      ].join("\u0000");
    if (next.length !== current.length) return true;
    const left = next.map(normalize).sort();
    const right = current.map(normalize).sort();
    return left.some((value, index) => value !== right[index]);
  }

  const persistContacts = async (payload: ContactInput[]) => {
    if (elderId === null || savingContacts) return;
    setSavingContacts(true);
    setContactSubmitError(null);
    try {
      const saved = await api.put<Contact[]>(
        `/api/v1/elders/${elderId}/contacts`,
        payload
      );
      setContacts(saved);
      setContactsOpen(false);
      setContactsConfirming(false);
      pendingContactsRef.current = null;
      toast({
        title: "联系人已保存",
        description: "提交内容已整体替换。",
        variant: "success",
      });
    } catch (caught: unknown) {
      setContactSubmitError(describeError(caught, "保存紧急联系人失败。"));
      setContactsConfirming(false);
    } finally {
      setSavingContacts(false);
    }
  };

  const saveContacts = async () => {
    if (elderId === null || savingContacts) return;
    const nextErrors = validateContactDrafts(draftContacts);
    if (Object.keys(nextErrors).length > 0) {
      setContactErrors(nextErrors);
      return;
    }

    const payload: ContactInput[] = draftContacts.map((contact) => ({
      name: contact.name.trim(),
      phone: contact.phone.trim(),
      relation: contact.relation.trim() || null,
      priority: Number(contact.priority),
      is_primary: contact.is_primary,
    }));

    // 已有联系人且内容发生变化：先进入二次确认，不直接覆盖
    if (contacts.length > 0 && contactsDiffer(payload, contacts)) {
      pendingContactsRef.current = payload;
      setContactSubmitError(null);
      setContactsConfirming(true);
      return;
    }

    await persistContacts(payload);
  };

  if (idState === "invalid") {
    return (
      <div>
        <PageHeader title="老人详情" />
        <div className="rounded-[8px] border border-line bg-panel">
          <ErrorState message={idMessage} />
          <div className="flex justify-center pb-8">
            <Button variant="secondary" onClick={() => router.push("/elders")}>
              <ArrowLeft />
              返回老人列表
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div>
        <PageHeader title="老人详情" />
        <div className="rounded-[8px] border border-line bg-panel">
          <ErrorState message="老人档案不存在。" />
          <div className="flex justify-center pb-8">
            <Button variant="secondary" onClick={() => router.push("/elders")}>
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
        title={elder?.name ?? "老人详情"}
        titleAddon={
          elder ? <ElderRoleBadge role={elder.my_role} /> : undefined
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => router.push("/elders")}
            >
              <ArrowLeft />
              返回列表
            </Button>
            {canEditProfile ? (
              <Button
                variant="primary"
                onClick={() => {
                  if (elderId !== null) {
                    router.push(`/elders/edit?id=${elderId}`);
                  }
                }}
                disabled={elderId === null}
              >
                <Pencil />
                编辑档案
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[8px] border border-line bg-panel">
          <SectionHeader
            title="档案信息"
            description="老人的基础档案和健康记录。"
            actions={
              canEditProfile ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (elderId !== null) {
                      router.push(`/elders/edit?id=${elderId}`);
                    }
                  }}
                  disabled={elderId === null}
                >
                  <Pencil />
                  编辑
                </Button>
              ) : null
            }
          />
          {profileLoading ? (
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="mt-2 h-4 w-28" />
                </div>
              ))}
            </div>
          ) : profileError ? (
            <ErrorState
              message={profileError}
              onRetry={() => void loadProfile()}
            />
          ) : elder ? (
            <dl className="grid gap-x-6 gap-y-5 p-4 sm:grid-cols-2">
              <InfoItem label="姓名" value={elder.name} />
              <InfoItem label="性别" value={genderLabel(elder.gender)} />
              <InfoItem
                label="出生日期"
                value={toLocalInputValue(elder.birth_date) || "—"}
              />
              <InfoItem
                label="身高 / 体重"
                value={
                  elder.height_cm === null && elder.weight_kg === null
                    ? "—"
                    : [
                        elder.height_cm === null
                          ? null
                          : `${elder.height_cm} cm`,
                        elder.weight_kg === null
                          ? null
                          : `${elder.weight_kg} kg`,
                      ]
                        .filter(Boolean)
                        .join(" / ")
                }
              />
              <InfoItem
                label="地址"
                value={elder.address || "—"}
                className="sm:col-span-2"
              />
              <InfoItem
                label="备注"
                value={
                  <span className="whitespace-pre-wrap">
                    {elder.notes || "—"}
                  </span>
                }
                className="sm:col-span-2"
              />
            </dl>
          ) : null}
        </section>

        <section className="rounded-[8px] border border-line bg-panel">
          <SectionHeader
            title="紧急联系人"
            description="联系人按优先级排列，最多一位主联系人。"
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={openContactsDialog}
                disabled={contactsLoading || Boolean(contactsError)}
              >
                <Pencil />
                编辑联系人
              </Button>
            }
          />
          {contactsLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-8 rounded-full" />
                    <div>
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="mt-1.5 h-3 w-32" />
                    </div>
                  </div>
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          ) : contactsError ? (
            <ErrorState
              message={contactsError}
              onRetry={() => void loadContacts()}
            />
          ) : contacts.length === 0 ? (
            <EmptyState
              title="暂无紧急联系人"
              description="添加联系人后，发生告警时可以按优先级进行通知。"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={openContactsDialog}
                >
                  <Plus />
                  添加联系人
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-info/12 text-info">
                      <UserRound className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-ink">
                          {contact.name}
                        </span>
                        {contact.is_primary ? (
                          <Badge tone="brand">主联系人</Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-muted">
                        <span>
                          {labelOf(
                            RELATION_LABELS,
                            contact.relation,
                            "关系未填写"
                          )}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3" aria-hidden="true" />
                          {contact.phone}
                        </span>
                      </p>
                    </div>
                  </div>
                  <span className="text-[12px] tabular-nums text-ink-muted">
                    优先级 {contact.priority}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canManageMembers ? (
        <section className="mt-4 rounded-[8px] border border-line bg-panel">
          <SectionHeader
            title="监护成员"
            description="主照护者可添加、调整或移除成员；普通成员只能查看这位老人的数据。"
          />
          {membersLoading ? (
            <TableWrapper className="rounded-none border-0">
              <TableSkeleton rows={3} columns={5} />
            </TableWrapper>
          ) : membersError ? (
            <ErrorState
              message={membersError}
              onRetry={() => void loadMembers()}
            />
          ) : (
            <div>
              {members.length === 0 ? (
                <EmptyState
                  title="暂未授权家属"
                  description="添加一位家属账号后，该账号即可看到这位老人的数据。"
                />
              ) : (
                <TableWrapper className="rounded-none border-0">
                  <Table className="min-w-[880px]">
                    <THead>
                      <TR className="hover:bg-transparent">
                        <TH>账号</TH>
                        <TH>显示名</TH>
                        <TH>关系</TH>
                        <TH>角色</TH>
                        <TH className="text-right">操作</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {members.map((member) => (
                        <TR key={member.user_id}>
                          <TD className="font-medium text-ink">
                            <div className="flex items-center gap-2">
                              <span>{member.username}</span>
                              {session &&
                              member.username === session.username ? (
                                <Badge tone="info">我</Badge>
                              ) : null}
                            </div>
                          </TD>
                          <TD className="text-ink-muted">
                            {member.display_name ?? "—"}
                          </TD>
                          <TD className="text-ink-muted">
                            {labelOf(RELATION_LABELS, member.relation, "—")}
                          </TD>
                          <TD>
                            <ElderRoleBadge role={member.role} />
                          </TD>
                          <TD>
                            <div className="flex items-center justify-end gap-2">
                              <Select
                                value={member.role}
                                onValueChange={(value) =>
                                  void saveMembers(
                                    members.map((item) => ({
                                      user_id: item.user_id,
                                      role:
                                        item.user_id === member.user_id
                                          ? (value as "owner" | "member")
                                          : item.role,
                                      relation: item.relation,
                                    }))
                                  )
                                }
                                options={[
                                  { value: "owner", label: "主照护者" },
                                  { value: "member", label: "普通成员" },
                                ]}
                                disabled={savingMember}
                                className="w-32"
                                aria-label={`设置 ${member.username} 的角色`}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={savingMember || members.length <= 1}
                                onClick={() =>
                                  void saveMembers(
                                    members
                                      .filter(
                                        (item) =>
                                          item.user_id !== member.user_id
                                      )
                                      .map((item) => ({
                                        user_id: item.user_id,
                                        role: item.role,
                                        relation: item.relation,
                                      }))
                                  )
                                }
                              >
                                <Trash2 />
                                移除
                              </Button>
                            </div>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrapper>
              )}

              <div className="border-t border-line px-4 py-4">
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void searchCandidates();
                  }}
                >
                  <div className="flex min-w-[240px] flex-col gap-1.5">
                    <Label htmlFor="member-candidate-query" className="mb-0">
                      搜索家属账号
                    </Label>
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                        aria-hidden="true"
                      />
                      <Input
                        id="member-candidate-query"
                        value={candidateQuery}
                        maxLength={32}
                        className="pl-9"
                        placeholder="账号或显示名关键字"
                        onChange={(event) =>
                          setCandidateQuery(event.target.value)
                        }
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    variant="secondary"
                    size="md"
                    disabled={candidatesLoading || !candidateQuery.trim()}
                    aria-busy={candidatesLoading}
                  >
                    <Search />
                    {candidatesLoading ? "搜索中…" : "搜索"}
                  </Button>
                </form>

                <FieldError>{candidatesError}</FieldError>
                {candidatesSearched &&
                !candidatesLoading &&
                !candidatesError &&
                availableCandidates.length === 0 ? (
                  <p className="mt-2 text-[12px] text-ink-muted">
                    没有找到可添加的家属账号。
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <div className="flex min-w-[220px] flex-col gap-1.5">
                    <span className="text-[12px] text-ink-muted">
                      候选账号
                    </span>
                    <Select
                      value={memberUserId}
                      onValueChange={setMemberUserId}
                      options={availableCandidates.map((candidate) => ({
                        value: String(candidate.id),
                        label: candidate.display_name
                          ? `${candidate.display_name}（${candidate.username}）`
                          : candidate.username,
                      }))}
                      placeholder={
                        candidatesSearched
                          ? "选择候选账号"
                          : "先搜索候选账号"
                      }
                      disabled={availableCandidates.length === 0}
                      className="w-56"
                      aria-label="选择要添加的家属账号"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12px] text-ink-muted">角色</span>
                    <Select
                      value={memberRole}
                      onValueChange={(value) =>
                        setMemberRole(value as "owner" | "member")
                      }
                      options={[
                        { value: "member", label: "普通成员" },
                        { value: "owner", label: "主照护者" },
                      ]}
                      className="w-32"
                      aria-label="新成员角色"
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!memberUserId || savingMember}
                    onClick={() => {
                      const userId = Number(memberUserId);
                      if (!userId) return;
                      void saveMembers([
                        ...members.map((item) => ({
                          user_id: item.user_id,
                          role: item.role,
                          relation: item.relation,
                        })),
                        { user_id: userId, role: memberRole, relation: null },
                      ]);
                      setMemberUserId("");
                      setMemberRole("member");
                    }}
                  >
                    <Plus />
                    添加
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="rounded-[8px] border border-line bg-panel">
          <SectionHeader
            title="绑定设备"
            description="与该老人关联的监护终端。"
          />
          {devicesLoading ? (
            <TableWrapper className="rounded-none border-0">
              <TableSkeleton rows={3} columns={5} />
            </TableWrapper>
          ) : devicesError ? (
            <ErrorState
              message={devicesError}
              onRetry={() => void loadDevices()}
            />
          ) : devices.length === 0 ? (
            <EmptyState
              title="暂无绑定设备"
              description={
                isAdmin
                  ? "前往设备管理页面注册并绑定监护终端。"
                  : "当前老人还没有绑定设备，请联系管理员完成绑定。"
              }
            />
          ) : (
            <TableWrapper className="rounded-none border-0">
              <Table className="min-w-[680px]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>设备 UID</TH>
                    <TH>类型 / 型号</TH>
                    <TH>状态</TH>
                    <TH>电量</TH>
                    <TH>最近上报</TH>
                  </TR>
                </THead>
                <TBody>
                  {devices.map((device) => (
                    <TR key={device.id}>
                      <TD className="font-medium text-ink">
                        {device.device_uid}
                      </TD>
                      <TD className="text-ink-muted">
                        {[device.kind, device.model]
                          .filter(Boolean)
                          .join(" / ") || "—"}
                      </TD>
                      <TD>
                        <DeviceStatusBadge status={device.status} />
                      </TD>
                      <TD className="whitespace-nowrap tabular-nums text-ink-muted">
                        <span className="inline-flex items-center gap-1">
                          <BatteryMedium
                            className="size-3.5"
                            aria-hidden="true"
                          />
                          {device.battery_percent === null
                            ? "—"
                            : `${device.battery_percent}%`}
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap text-ink-muted">
                        {formatDateTime(device.last_seen_at)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </section>

        {elderId !== null ? (
          <GeofenceEditor elderId={elderId} elderName={elder?.name} />
        ) : null}
      </div>

      <section className="mt-4 rounded-[8px] border border-line bg-panel">
        <SectionHeader
          title="最近遥测"
          description="按记录时间倒序，显示最近 20 条设备上报数据。"
        />
        {telemetryLoading ? (
          <TableWrapper className="rounded-none border-0">
            <TableSkeleton rows={5} columns={5} />
          </TableWrapper>
        ) : telemetryError ? (
          <ErrorState
            message={telemetryError}
            onRetry={() => void loadTelemetry()}
          />
        ) : telemetry.length === 0 ? (
          <EmptyState
            title="暂无遥测数据"
            description="设备绑定并上报后，最近数据会显示在这里。"
          />
        ) : (
          <TableWrapper className="rounded-none border-0">
            <Table className="min-w-[760px]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>时间</TH>
                  <TH>指标</TH>
                  <TH>数值</TH>
                  <TH>经纬度</TH>
                  <TH>信号</TH>
                </TR>
              </THead>
              <TBody>
                {telemetry.map((item) => (
                  <TR key={item.id}>
                    <TD className="whitespace-nowrap text-ink-muted">
                      {formatDateTime(item.recorded_at)}
                    </TD>
                    <TD>{labelOf(METRIC_LABELS, item.metric)}</TD>
                    <TD className="tabular-nums">{telemetryValue(item)}</TD>
                    <TD className="whitespace-nowrap tabular-nums text-ink-muted">
                      {telemetryLocation(item)}
                    </TD>
                    <TD className="whitespace-nowrap tabular-nums text-ink-muted">
                      {telemetrySignal(item)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="rounded-[8px] border border-line bg-panel">
          <SectionHeader
            title="最近事件"
            description="设备上报的原始事件记录，按时间倒序。"
          />
          {eventsLoading ? (
            <TableWrapper className="rounded-none border-0">
              <TableSkeleton rows={5} columns={3} />
            </TableWrapper>
          ) : eventsError ? (
            <ErrorState
              message={eventsError}
              onRetry={() => void loadEvents()}
            />
          ) : events.length === 0 ? (
            <EmptyState
              title="暂无事件记录"
              description="设备触发跌倒、SOS 或围栏越界后会显示在这里。"
            />
          ) : (
            <TableWrapper className="rounded-none border-0">
              <Table className="min-w-[520px]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>时间</TH>
                    <TH>类型</TH>
                    <TH>等级</TH>
                  </TR>
                </THead>
                <TBody>
                  {events.map((event) => (
                    <TR key={event.id}>
                      <TD className="whitespace-nowrap text-ink-muted">
                        {formatDateTime(event.occurred_at)}
                      </TD>
                      <TD>
                        <EventTypeBadge type={event.type} />
                      </TD>
                      <TD>
                        <SeverityBadge severity={event.severity} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </section>

        <section className="rounded-[8px] border border-line bg-panel">
          <SectionHeader
            title="最近告警"
            description="基于事件生成的告警及处理状态。"
          />
          {alertsLoading ? (
            <TableWrapper className="rounded-none border-0">
              <TableSkeleton rows={5} columns={4} />
            </TableWrapper>
          ) : alertsError ? (
            <ErrorState
              message={alertsError}
              onRetry={() => void loadAlerts()}
            />
          ) : alerts.length === 0 ? (
            <EmptyState
              title="暂无告警"
              description="当前没有需要关注的告警记录。"
            />
          ) : (
            <TableWrapper className="rounded-none border-0">
              <Table className="min-w-[560px]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>时间</TH>
                    <TH>类型</TH>
                    <TH>等级</TH>
                    <TH>状态</TH>
                  </TR>
                </THead>
                <TBody>
                  {alerts.map((alert) => (
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
            </TableWrapper>
          )}
        </section>
      </div>

      <Dialog
        open={contactsOpen}
        onOpenChange={(open) => {
          setContactsOpen(open);
          if (!open) {
            setContactsConfirming(false);
            pendingContactsRef.current = null;
          }
        }}
      >
        <DialogContent
          title="编辑紧急联系人"
          description="保存后按提交内容整体替换，联系人编号会重新生成。"
          className="w-[min(94vw,820px)] max-h-[88vh] overflow-y-auto"
        >
          <div className="space-y-3">
            {contactSubmitError ? (
              <p
                className="rounded-[6px] border border-critical/30 bg-critical/10 px-3 py-2 text-[13px] text-critical"
                role="alert"
              >
                {contactSubmitError}
              </p>
            ) : null}
            {contactErrors.__form ? (
              <p
                className="rounded-[6px] border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning"
                role="alert"
              >
                {contactErrors.__form}
              </p>
            ) : null}

            {draftContacts.length === 0 ? (
              <div className="rounded-[6px] border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-ink-muted">
                当前没有联系人，点击下方按钮添加第一位联系人。
              </div>
            ) : (
              <div className="space-y-3">
                {draftContacts.map((contact, index) => {
                  return (
                    <div
                      key={contact.rowId}
                      className="rounded-[6px] border border-line bg-raised p-3"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-[13px] text-ink">
                          联系人 {index + 1}
                        </p>
                        <Tooltip content="移除联系人">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`移除联系人 ${index + 1}`}
                            disabled={contactsFormLocked}
                            onClick={() => removeContact(contact.rowId)}
                          >
                            <Trash2 />
                          </Button>
                        </Tooltip>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <Label htmlFor={`${contact.rowId}-name`}>
                            姓名 *
                          </Label>
                          <Input
                            id={`${contact.rowId}-name`}
                            disabled={contactsFormLocked}
                            value={contact.name}
                            onChange={(event) =>
                              updateContact(contact.rowId, {
                                name: event.target.value,
                              })
                            }
                            placeholder="联系人姓名"
                            aria-invalid={Boolean(
                              contactErrors[`${contact.rowId}.name`]
                            )}
                            aria-describedby={
                              contactErrors[`${contact.rowId}.name`]
                                ? `${contact.rowId}-name-error`
                                : undefined
                            }
                          />
                          <div id={`${contact.rowId}-name-error`}>
                            <FieldError>
                              {contactErrors[`${contact.rowId}.name`]}
                            </FieldError>
                          </div>
                        </div>
                        <div>
                          <Label htmlFor={`${contact.rowId}-phone`}>
                            电话 *
                          </Label>
                          <Input
                            id={`${contact.rowId}-phone`}
                            type="tel"
                            disabled={contactsFormLocked}
                            value={contact.phone}
                            onChange={(event) =>
                              updateContact(contact.rowId, {
                                phone: event.target.value,
                              })
                            }
                            placeholder="联系电话"
                            aria-invalid={Boolean(
                              contactErrors[`${contact.rowId}.phone`]
                            )}
                            aria-describedby={
                              contactErrors[`${contact.rowId}.phone`]
                                ? `${contact.rowId}-phone-error`
                                : undefined
                            }
                          />
                          <div id={`${contact.rowId}-phone-error`}>
                            <FieldError>
                              {contactErrors[`${contact.rowId}.phone`]}
                            </FieldError>
                          </div>
                        </div>
                        <div>
                          <Label htmlFor={`${contact.rowId}-relation`}>
                            关系
                          </Label>
                          <Input
                            id={`${contact.rowId}-relation`}
                            disabled={contactsFormLocked}
                            value={contact.relation}
                            onChange={(event) =>
                              updateContact(contact.rowId, {
                                relation: event.target.value,
                              })
                            }
                            placeholder="例如：子女、邻居"
                            aria-invalid={Boolean(
                              contactErrors[`${contact.rowId}.relation`]
                            )}
                            aria-describedby={
                              contactErrors[`${contact.rowId}.relation`]
                                ? `${contact.rowId}-relation-error`
                                : undefined
                            }
                          />
                          <div id={`${contact.rowId}-relation-error`}>
                            <FieldError>
                              {contactErrors[`${contact.rowId}.relation`]}
                            </FieldError>
                          </div>
                        </div>
                        <div>
                          <Label htmlFor={`${contact.rowId}-priority`}>
                            优先级
                          </Label>
                          <Input
                            id={`${contact.rowId}-priority`}
                            type="number"
                            disabled={contactsFormLocked}
                            min={1}
                            max={99}
                            step={1}
                            value={contact.priority}
                            onChange={(event) =>
                              updateContact(contact.rowId, {
                                priority: event.target.value,
                              })
                            }
                            aria-invalid={Boolean(
                              contactErrors[`${contact.rowId}.priority`]
                            )}
                            aria-describedby={
                              contactErrors[`${contact.rowId}.priority`]
                                ? `${contact.rowId}-priority-error`
                                : undefined
                            }
                          />
                          <div id={`${contact.rowId}-priority-error`}>
                            <FieldError>
                              {contactErrors[`${contact.rowId}.priority`]}
                            </FieldError>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={contact.is_primary}
                        aria-label={`将联系人 ${index + 1} 设为主联系人`}
                        disabled={contactsFormLocked}
                        className={cn(
                          "mt-3 inline-flex h-9 items-center gap-2 rounded-[6px] border px-3 text-[13px] transition-colors",
                          "disabled:cursor-not-allowed disabled:opacity-50",
                          contact.is_primary
                            ? "border-brand/40 bg-brand/12 text-brand"
                            : "border-line bg-panel text-ink-muted hover:text-ink"
                        )}
                        onClick={() => setPrimaryContact(contact.rowId)}
                      >
                        <span
                          className={cn(
                            "flex size-4 items-center justify-center rounded-[4px] border",
                            contact.is_primary
                              ? "border-brand bg-brand text-canvas"
                              : "border-line-strong"
                          )}
                          aria-hidden="true"
                        >
                          {contact.is_primary ? (
                            <Check className="size-3" />
                          ) : null}
                        </span>
                        设为主联系人
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <Button
              variant="secondary"
              onClick={addContact}
              disabled={contactsFormLocked}
            >
              <Plus />
              添加联系人
            </Button>
          </div>

          <div className="mt-5 space-y-3">
            {contactsConfirming ? (
              <p
                className="rounded-[6px] border border-warning/35 bg-warning/10 px-3 py-2 text-[13px] leading-6 text-warning"
                role="alert"
              >
                将用 {draftContacts.length} 位联系人整体替换现有{" "}
                {contacts.length} 位联系人，原联系人编号会重新生成。确认后立即生效。
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              {contactsConfirming ? (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => setContactsConfirming(false)}
                    disabled={savingContacts}
                  >
                    返回修改
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      const payload = pendingContactsRef.current;
                      if (payload) void persistContacts(payload);
                    }}
                    disabled={savingContacts}
                    aria-busy={savingContacts}
                  >
                    {savingContacts ? "替换中…" : "确认替换联系人"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => setContactsOpen(false)}
                    disabled={savingContacts}
                  >
                    取消
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void saveContacts()}
                    disabled={savingContacts}
                    aria-busy={savingContacts}
                  >
                    {savingContacts ? "保存中…" : "保存联系人"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
