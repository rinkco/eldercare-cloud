const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const fullDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const METRIC_LABELS: Record<string, string> = {
  heart_rate: "心率",
  spo2: "血氧",
  steps: "步数",
  activity: "活动状态",
  battery: "电量",
  location: "定位",
};

export const METRIC_UNITS: Record<string, string> = {
  heart_rate: "bpm",
  spo2: "%",
  steps: "步",
  battery: "%",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  fall: "跌倒",
  sos: "紧急求助",
  geofence_exit: "围栏越界",
  low_battery: "电量过低",
  heart_rate_abnormal: "心率异常",
  spo2_abnormal: "血氧异常",
  device_offline: "设备离线",
};

export const SEVERITY_LABELS: Record<string, string> = {
  critical: "危急",
  warning: "警告",
  info: "信息",
};

export const ALERT_STATUS_LABELS: Record<string, string> = {
  new: "未处理",
  handled: "已处理",
  closed: "已关闭",
};

export const ACTIVITY_LABELS: Record<string, string> = {
  still: "静止",
  walking: "步行",
  running: "跑步",
  sleeping: "睡眠",
  resting: "休息",
  unknown: "未知",
};

export const RELATION_LABELS: Record<string, string> = {
  son: "儿子",
  daughter: "女儿",
  spouse: "配偶",
  father: "父亲",
  mother: "母亲",
  brother: "兄弟",
  sister: "姐妹",
  creator: "创建人",
  other: "其他",
};

export const DEVICE_STATUS_LABELS: Record<string, string> = {
  online: "在线",
  offline: "离线",
  disabled: "已停用",
};

export const DEVICE_KIND_LABELS: Record<string, string> = {
  esp32: "ESP32 终端",
  phone: "手机",
  wearable: "穿戴设备",
};

export function labelOf(
  map: Record<string, string>,
  value: string | null | undefined,
  fallback = "未知"
): string {
  if (!value) return fallback;
  return map[value] ?? value;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter.format(date);
}

export function formatFullDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return fullDateTimeFormatter.format(date);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return timeFormatter.format(date);
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffSeconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return "刚刚";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} 分钟前`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} 小时前`;
  if (diffSeconds < 86400 * 30) return `${Math.floor(diffSeconds / 86400)} 天前`;
  return formatDateTime(value);
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits).replace(/\.0+$/, "");
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
}

export function toLocalInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
