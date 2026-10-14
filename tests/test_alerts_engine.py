"""SPEC 01 步骤 7：事件规则、告警与通知模拟集成测试。"""

import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.alerts import haversine_m, sweep_offline_devices
from app.db import SessionLocal
from app.models import (
    Alert,
    AuditLog,
    Device,
    Elder,
    ElderContact,
    Event,
    Geofence,
    Notification,
    Telemetry,
)
from tests.helpers import publish_mqtt as _publish
from tests.helpers import unique_phone


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_haversine_distance() -> None:
    # 上海人民广场到陆家嘴直线距离约 3.3 公里
    distance = haversine_m(31.2304, 121.4737, 31.2397, 121.4998)

    assert 2500 < distance < 4000


@pytest.fixture
def alert_device(client: TestClient, db, seeded_users):
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = client.post(
        "/api/v1/elders",
        headers=_headers(token),
        json={"name": "告警测试老人", "phone": unique_phone()},
    ).json()
    uid = f"esp32-{uuid.uuid4().hex[:10]}"
    device = client.post(
        "/api/v1/devices",
        headers=_headers(token),
        json={"device_uid": uid, "kind": "esp32"},
    ).json()
    bound = client.post(
        f"/api/v1/devices/{device['id']}/bind",
        headers=_headers(token),
        json={"elder_id": elder["id"]},
    )
    assert bound.status_code == 200

    yield token, elder, device, uid

    session, _ = db
    event_ids = list(
        session.execute(
            select(Event.id).where(Event.device_id == device["id"])
        ).scalars()
    )
    alert_ids = list(
        session.execute(
            select(Alert.id).where(Alert.event_id.in_(event_ids or [0]))
        ).scalars()
    )
    session.execute(
        delete(Notification).where(Notification.alert_id.in_(alert_ids or [0]))
    )
    session.execute(delete(Alert).where(Alert.id.in_(alert_ids or [0])))
    session.execute(delete(Event).where(Event.device_id == device["id"]))
    session.execute(delete(Telemetry).where(Telemetry.device_id == device["id"]))
    session.execute(delete(Geofence).where(Geofence.elder_id == elder["id"]))
    session.execute(delete(ElderContact).where(ElderContact.elder_id == elder["id"]))
    session.execute(
        delete(AuditLog).where(
            AuditLog.target_type == "device",
            AuditLog.target_id == device["id"],
        )
    )
    session.execute(
        delete(AuditLog).where(
            AuditLog.target_type == "elder",
            AuditLog.target_id == elder["id"],
        )
    )
    session.execute(delete(Device).where(Device.id == device["id"]))
    session.execute(delete(Elder).where(Elder.id == elder["id"]))
    session.commit()


def _wait_for_event(device_id: int, event_type: str, timeout: float = 5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with SessionLocal() as session:
            event = session.execute(
                select(Event).where(
                    Event.device_id == device_id, Event.type == event_type
                )
            ).scalar_one_or_none()
            if event is not None:
                return event.id
        time.sleep(0.1)
    return None


def test_fall_event_creates_alert_and_notification(
    client: TestClient, db, alert_device
) -> None:
    _, elder, device, uid = alert_device
    session, _ = db
    session.add(
        ElderContact(
            elder_id=elder["id"],
            name="测试儿子",
            phone="13800000001",
            relation="son",
            priority=1,
            is_primary=True,
        )
    )
    session.commit()

    _publish(
        f"iot/v1/{uid}/event",
        {
            "device_uid": uid,
            "ts": datetime.now(timezone.utc).isoformat(),
            "type": "fall",
            "severity": "critical",
            "confidence": 0.97,
            "payload": {"source": "mpu6050"},
        },
    )

    event_id = _wait_for_event(device["id"], "fall")
    assert event_id is not None
    session.expire_all()
    alert = session.execute(
        select(Alert).where(Alert.event_id == event_id)
    ).scalar_one()
    notifications = list(
        session.execute(
            select(Notification).where(Notification.alert_id == alert.id)
        ).scalars()
    )
    assert len(notifications) == 1
    assert notifications[0].status == "sent"
    assert notifications[0].channel == "console"
    assert notifications[0].target == "13800000001"


def test_low_battery_triggers_once_per_drop(
    client: TestClient, db, alert_device
) -> None:
    _, _, device, uid = alert_device

    now = datetime.now(timezone.utc)
    _publish(
        f"iot/v1/{uid}/telemetry",
        {
            "device_uid": uid,
            "ts": now.isoformat(),
            "metric": "battery",
            "value": 15,
        },
    )
    assert _wait_for_event(device["id"], "low_battery") is not None

    _publish(
        f"iot/v1/{uid}/telemetry",
        {
            "device_uid": uid,
            "ts": (now + timedelta(seconds=5)).isoformat(),
            "metric": "battery",
            "value": 14,
        },
    )
    time.sleep(1.0)

    with SessionLocal() as session:
        events = list(
            session.execute(
                select(Event).where(
                    Event.device_id == device["id"],
                    Event.type == "low_battery",
                )
            ).scalars()
        )
    assert len(events) == 1


def test_status_low_battery_triggers_alert_once(
    client: TestClient, db, alert_device
) -> None:
    _, _, device, uid = alert_device
    now = datetime.now(timezone.utc)

    _publish(
        f"iot/v1/{uid}/status",
        {
            "device_uid": uid,
            "ts": now.isoformat(),
            "battery": 19,
        },
    )
    assert _wait_for_event(device["id"], "low_battery") is not None

    _publish(
        f"iot/v1/{uid}/telemetry",
        {
            "device_uid": uid,
            "ts": (now + timedelta(seconds=5)).isoformat(),
            "metric": "battery",
            "value": 18,
        },
    )
    time.sleep(1.0)

    with SessionLocal() as session:
        events = list(
            session.execute(
                select(Event).where(
                    Event.device_id == device["id"],
                    Event.type == "low_battery",
                )
            ).scalars()
        )
    assert len(events) == 1


def test_geofence_exit_triggers_alert(
    client: TestClient, db, alert_device
) -> None:
    _, elder, device, uid = alert_device
    session, _ = db
    session.add(
        Geofence(
            elder_id=elder["id"],
            name="测试围栏",
            center_lat=31.2304,
            center_lon=121.4737,
            radius_m=500,
        )
    )
    session.commit()

    now = datetime.now(timezone.utc)
    _publish(
        f"iot/v1/{uid}/telemetry",
        {
            "device_uid": uid,
            "ts": now.isoformat(),
            "metric": "location",
            "lat": 31.2305,
            "lon": 121.4738,
        },
    )
    time.sleep(0.8)
    _publish(
        f"iot/v1/{uid}/telemetry",
        {
            "device_uid": uid,
            "ts": (now + timedelta(seconds=5)).isoformat(),
            "metric": "location",
            "lat": 31.2397,
            "lon": 121.4998,
        },
    )

    assert _wait_for_event(device["id"], "geofence_exit") is not None


def test_offline_sweep_creates_event_alert_notification(
    client: TestClient, db, alert_device
) -> None:
    _, _, device, _ = alert_device
    session, _ = db
    session.execute(
        Device.__table__.update()
        .where(Device.id == device["id"])
        .values(
            status="online",
            last_seen_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
    )
    session.commit()

    sweep_offline_devices(session)

    # 后台巡检线程可能先完成处理：以数据库中最终状态为准
    deadline = time.monotonic() + 3
    offline_events = []
    while time.monotonic() < deadline:
        session.expire_all()
        offline_events = list(
            session.execute(
                select(Event).where(
                    Event.device_id == device["id"],
                    Event.type == "device_offline",
                )
            ).scalars()
        )
        if offline_events:
            break
        time.sleep(0.2)

    assert len(offline_events) == 1

    session.expire_all()
    stored = session.get(Device, device["id"])
    assert stored.status == "offline"
    alert = session.execute(
        select(Alert).where(Alert.event_id == offline_events[0].id)
    ).scalar_one()
    notification = session.execute(
        select(Notification).where(Notification.alert_id == alert.id)
    ).scalar_one()
    assert notification.status == "sent"
