"""事件规则、告警生成与通知模拟适配器。"""

import logging
import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Alert,
    Device,
    Elder,
    ElderContact,
    Event,
    Geofence,
    Notification,
    Telemetry,
)
from app.ws import publish_alert

logger = logging.getLogger("eldercare.alerts")

LOW_BATTERY_THRESHOLD = 20
OFFLINE_THRESHOLD_SECONDS = 120
EARTH_RADIUS_M = 6371000.0

EVENT_LABELS = {
    "fall": "跌倒",
    "sos": "SOS 求助",
    "geofence_exit": "电子围栏越界",
    "low_battery": "设备低电量",
    "device_offline": "设备离线",
}


def haversine_m(
    lat1: float, lon1: float, lat2: float, lon2: float
) -> float:
    """两个经纬度点之间的球面距离（米）。"""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def create_event(
    db: Session,
    *,
    elder_id: int,
    device_id: int,
    event_type: str,
    severity: str,
    occurred_at: datetime,
    confidence: float | None = None,
    payload: dict | None = None,
) -> Event:
    """写入事件（调用方负责提交事务）。"""
    event = Event(
        elder_id=elder_id,
        device_id=device_id,
        type=event_type,
        severity=severity,
        confidence=confidence,
        occurred_at=occurred_at,
        payload_json=payload or {},
    )
    db.add(event)
    db.flush()
    return event


def create_alert_with_notifications(db: Session, event: Event) -> Alert:
    """为事件生成告警，并通过通知模拟适配器写入通知记录。"""
    alert = Alert(event_id=event.id, elder_id=event.elder_id)
    db.add(alert)
    db.flush()

    contacts = list(
        db.execute(
            select(ElderContact)
            .where(ElderContact.elder_id == event.elder_id)
            .order_by(ElderContact.priority, ElderContact.id)
        ).scalars()
    )
    elder = db.get(Elder, event.elder_id)
    content = _notification_content(elder, event)
    sent_at = datetime.now(timezone.utc)

    if not contacts:
        # 没有紧急联系人时也保留一条通知，保证告警链路可见
        db.add(
            Notification(
                alert_id=alert.id,
                contact_id=None,
                channel="console",
                target=None,
                content=content,
                status="sent",
                sent_at=sent_at,
            )
        )
        logger.info("[通知模拟] %s", content)
        return alert

    for contact in contacts:
        db.add(
            Notification(
                alert_id=alert.id,
                contact_id=contact.id,
                channel="console",
                target=contact.phone,
                content=content,
                status="sent",
                sent_at=sent_at,
            )
        )
        logger.info(
            "[通知模拟] 联系人=%s 电话=%s：%s",
            contact.name,
            contact.phone,
            content,
        )
    return alert


def _notification_content(elder: Elder | None, event: Event) -> str:
    elder_name = elder.name if elder is not None else f"老人#{event.elder_id}"
    label = EVENT_LABELS.get(event.type, event.type)
    return f"【{event.severity}】{elder_name} 触发{label}，请及时处理。"


def maybe_low_battery(
    db: Session,
    device: Device,
    *,
    previous_battery: int | None,
    current_battery: int,
    occurred_at: datetime,
) -> Event | None:
    """电量从 >=20 跌到 <20 时生成一次低电量事件。"""
    if device.elder_id is None:
        return None
    if current_battery >= LOW_BATTERY_THRESHOLD:
        return None
    if previous_battery is not None and previous_battery < LOW_BATTERY_THRESHOLD:
        return None

    event = create_event(
        db,
        elder_id=device.elder_id,
        device_id=device.id,
        event_type="low_battery",
        severity="warning",
        occurred_at=occurred_at,
        payload={"battery_percent": current_battery},
    )
    create_alert_with_notifications(db, event)
    return event


def maybe_geofence_exit(
    db: Session,
    device: Device,
    *,
    lat: float,
    lon: float,
    occurred_at: datetime,
) -> list[Event]:
    """当前位置越出已启用围栏（且上一位置在围栏内）时生成事件。"""
    if device.elder_id is None:
        return []

    fences = list(
        db.execute(
            select(Geofence).where(
                Geofence.elder_id == device.elder_id, Geofence.enabled.is_(True)
            )
        ).scalars()
    )
    if not fences:
        return []

    previous = db.execute(
        select(Telemetry)
        .where(
            Telemetry.elder_id == device.elder_id,
            Telemetry.device_id == device.id,
            Telemetry.metric == "location",
            Telemetry.recorded_at < occurred_at,
        )
        .order_by(Telemetry.recorded_at.desc(), Telemetry.id.desc())
        .limit(1)
    ).scalar_one_or_none()

    events: list[Event] = []
    for fence in fences:
        distance = haversine_m(lat, lon, fence.center_lat, fence.center_lon)
        if distance <= fence.radius_m:
            continue
        # 没有历史位置时按“上一位置在围栏内”处理：首次上报越界即告警
        previous_inside = True
        if previous is not None and previous.lat is not None and previous.lon is not None:
            previous_distance = haversine_m(
                previous.lat, previous.lon, fence.center_lat, fence.center_lon
            )
            previous_inside = previous_distance <= fence.radius_m
        if not previous_inside:
            continue

        event = create_event(
            db,
            elder_id=device.elder_id,
            device_id=device.id,
            event_type="geofence_exit",
            severity="warning",
            occurred_at=occurred_at,
            payload={
                "geofence_id": fence.id,
                "geofence_name": fence.name,
                "distance_m": round(distance, 1),
            },
        )
        create_alert_with_notifications(db, event)
        events.append(event)
    return events


def sweep_offline_devices(
    db: Session, *, now: datetime | None = None
) -> list[Event]:
    """把超过 120 秒无消息的在线设备标记离线并生成告警。"""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=OFFLINE_THRESHOLD_SECONDS)

    devices = list(
        db.execute(
            select(Device)
            .where(
                Device.status == "online",
                Device.last_seen_at.is_not(None),
                Device.last_seen_at < cutoff,
            )
            .with_for_update(skip_locked=True)
        ).scalars()
    )

    events: list[Event] = []
    for device in devices:
        device.status = "offline"
        if device.elder_id is None:
            continue
        event = create_event(
            db,
            elder_id=device.elder_id,
            device_id=device.id,
            event_type="device_offline",
            severity="warning",
            occurred_at=now,
            payload={
                "last_seen_at": device.last_seen_at.isoformat()
                if device.last_seen_at
                else None
            },
        )
        create_alert_with_notifications(db, event)
        events.append(event)

    db.commit()

    for event in events:
        alert = db.execute(
            select(Alert).where(Alert.event_id == event.id)
        ).scalar_one_or_none()
        elder = db.get(Elder, event.elder_id)
        if alert is None:
            continue
        publish_alert(
            alert_id=alert.id,
            event_id=event.id,
            elder_id=event.elder_id,
            elder_name=elder.name if elder is not None else f"老人#{event.elder_id}",
            event_type=event.type,
            severity=event.severity,
            occurred_at=event.occurred_at,
        )
    return events
