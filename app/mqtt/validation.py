"""MQTT 上行主题与载荷解析校验。

主题：iot/v1/{device_uid}/telemetry | event | status
约定：QoS 1、UTF-8 JSON、ts 为带时区的 ISO 8601（UTC）。
"""

import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone

METRICS = {
    "heart_rate",
    "spo2",
    "steps",
    "activity",
    "gait",
    "location",
    "battery",
}
EVENT_TYPES = {"fall", "sos", "geofence_exit", "low_battery"}
SEVERITIES = {"info", "warning", "critical"}
TOPIC_KINDS = {"telemetry", "event", "status"}


class PayloadError(ValueError):
    """载荷或主题不合法。"""


@dataclass(frozen=True)
class TelemetryMessage:
    metric: str
    value_num: float | None
    value_text: str | None
    lat: float | None
    lon: float | None
    recorded_at: datetime


@dataclass(frozen=True)
class EventMessage:
    type: str
    severity: str
    confidence: float | None
    occurred_at: datetime
    payload: dict


@dataclass(frozen=True)
class StatusMessage:
    recorded_at: datetime
    battery_percent: int | None


def parse_topic(topic: str) -> tuple[str, str]:
    """返回 (device_uid, kind)；主题格式不对时抛 PayloadError。"""
    parts = topic.split("/")
    if (
        len(parts) != 4
        or parts[0] != "iot"
        or parts[1] != "v1"
        or not parts[2]
        or parts[3] not in TOPIC_KINDS
    ):
        raise PayloadError(f"主题格式不合法：{topic}")
    return parts[2], parts[3]


def decode_json(raw_payload: bytes) -> dict:
    """解析 UTF-8 JSON 对象载荷。"""
    try:
        data = json.loads(
            raw_payload.decode("utf-8"), parse_constant=_reject_constant
        )
    except (UnicodeDecodeError, json.JSONDecodeError, PayloadError) as exc:
        raise PayloadError("载荷不是合法 UTF-8 JSON") from exc
    if not isinstance(data, dict):
        raise PayloadError("JSON 顶层必须是对象")
    return data


def parse_timestamp(value: object) -> datetime:
    """解析 ISO 8601 时间并要求显式时区；统一转 UTC。"""
    if not isinstance(value, str):
        raise PayloadError("ts 必须是字符串")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PayloadError("ts 不是合法 ISO 8601 时间") from exc
    if parsed.tzinfo is None:
        raise PayloadError("ts 必须带时区（UTC）")
    return parsed.astimezone(timezone.utc)


def parse_telemetry(data: dict) -> TelemetryMessage:
    """校验遥测载荷。"""
    metric = data.get("metric")
    if metric not in METRICS:
        raise PayloadError(f"metric 不合法：{metric!r}")

    value_num: float | None = None
    value_text: str | None = None
    lat: float | None = None
    lon: float | None = None

    if metric == "location":
        lat = _number(data, "lat", minimum=-90, maximum=90)
        lon = _number(data, "lon", minimum=-180, maximum=180)
    elif metric in ("activity", "gait"):
        if "value" in data:
            value_num = _number(data, "value")
        elif isinstance(data.get("value_text"), str) and data["value_text"]:
            value_text = data["value_text"]
        else:
            raise PayloadError(f"{metric} 需要 value 或 value_text")
    else:
        value_num = _number(data, "value")

    if metric == "battery" and not 0 <= (value_num or 0) <= 100:
        raise PayloadError("battery 必须在 0-100 之间")
    if metric == "heart_rate" and not 20 <= (value_num or 0) <= 250:
        raise PayloadError("heart_rate 必须在 20-250 之间")
    if metric == "spo2" and not 0 <= (value_num or 0) <= 100:
        raise PayloadError("spo2 必须在 0-100 之间")
    if metric == "steps" and (value_num or 0) < 0:
        raise PayloadError("steps 不能为负数")

    return TelemetryMessage(
        metric=metric,
        value_num=value_num,
        value_text=value_text,
        lat=lat,
        lon=lon,
        recorded_at=parse_timestamp(data.get("ts")),
    )


def parse_event(data: dict) -> EventMessage:
    """校验设备事件载荷。"""
    event_type = data.get("type")
    if event_type not in EVENT_TYPES:
        raise PayloadError(f"事件类型不合法：{event_type!r}")

    severity = data.get("severity")
    if severity not in SEVERITIES:
        raise PayloadError(f"severity 不合法：{severity!r}")

    confidence = data.get("confidence")
    if confidence is not None:
        if isinstance(confidence, bool) or not isinstance(
            confidence, (int, float)
        ):
            raise PayloadError("confidence 必须是数值")
        if not 0 <= float(confidence) <= 1:
            raise PayloadError("confidence 必须在 0-1 之间")

    payload = data.get("payload", {})
    if not isinstance(payload, dict):
        raise PayloadError("payload 必须是对象")

    return EventMessage(
        type=event_type,
        severity=severity,
        confidence=float(confidence) if confidence is not None else None,
        occurred_at=parse_timestamp(data.get("ts")),
        payload=payload,
    )


def parse_status(data: dict) -> StatusMessage:
    """校验在线心跳与电量载荷。"""
    raw_battery = data.get("battery", data.get("value"))
    battery_percent: int | None = None
    if raw_battery is not None:
        if isinstance(raw_battery, bool) or not isinstance(
            raw_battery, (int, float)
        ):
            raise PayloadError("battery 必须是数值")
        try:
            battery_number = float(raw_battery)
        except (ValueError, OverflowError) as exc:
            raise PayloadError("battery 不是有效数值") from exc
        if not math.isfinite(battery_number):
            raise PayloadError("battery 必须是有限数值")
        battery_percent = int(battery_number)
        if not 0 <= battery_percent <= 100:
            raise PayloadError("battery 必须在 0-100 之间")

    return StatusMessage(
        recorded_at=parse_timestamp(data.get("ts")),
        battery_percent=battery_percent,
    )


def _number(
    data: dict,
    key: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PayloadError(f"{key} 必须是数值")
    try:
        number = float(value)
    except (ValueError, OverflowError) as exc:
        raise PayloadError(f"{key} 不是有效数值") from exc
    if not math.isfinite(number):
        raise PayloadError(f"{key} 必须是有限数值")
    if minimum is not None and number < minimum:
        raise PayloadError(f"{key} 不能小于 {minimum}")
    if maximum is not None and number > maximum:
        raise PayloadError(f"{key} 不能大于 {maximum}")
    return number


def _reject_constant(value: str) -> float:
    """json.loads 的 parse_constant：拒绝 NaN/Infinity。"""
    raise PayloadError(f"不允许的非有限数值：{value}")
