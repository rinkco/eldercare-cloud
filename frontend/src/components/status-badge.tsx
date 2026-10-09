import { Badge } from "@/components/ui/badge";
import {
  ALERT_STATUS_LABELS,
  DEVICE_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  SEVERITY_LABELS,
  labelOf,
} from "@/lib/format";

type Tone = "neutral" | "brand" | "critical" | "warning" | "info" | "activity";

const SEVERITY_TONES: Record<string, Tone> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge tone={SEVERITY_TONES[severity] ?? "neutral"}>
      {labelOf(SEVERITY_LABELS, severity)}
    </Badge>
  );
}

export function EventTypeBadge({ type }: { type: string }) {
  return (
    <Badge tone="neutral">{labelOf(EVENT_TYPE_LABELS, type)}</Badge>
  );
}

export function AlertStatusBadge({ status }: { status: string }) {
  const tone: Tone = status === "new" ? "critical" : "brand";
  return (
    <Badge tone={tone}>{labelOf(ALERT_STATUS_LABELS, status)}</Badge>
  );
}

export function DeviceStatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === "online" ? "brand" : status === "offline" ? "warning" : "neutral";
  return (
    <Badge tone={tone}>{labelOf(DEVICE_STATUS_LABELS, status)}</Badge>
  );
}
