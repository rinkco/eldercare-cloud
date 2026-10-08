"""SPEC 01 步骤 6：MQTT 端到端入库集成测试（需要数据库与 broker）。"""

import time
import uuid
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.config import settings
from app.db import SessionLocal
from app.models import AuditLog, Device, Elder, Event, Telemetry
from tests.helpers import publish_mqtt as _publish


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def broker_available() -> bool:
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"test-probe-{uuid.uuid4().hex[:8]}",
    )
    client.username_pw_set(settings.mqtt_user, settings.mqtt_password)
    try:
        client.connect(settings.mqtt_host, settings.mqtt_port, keepalive=5)
        client.disconnect()
        return True
    except OSError:
        return False


@pytest.fixture
def bound_device(client: TestClient, db, seeded_users, broker_available):
    if not broker_available:
        pytest.skip("MQTT broker 不可用，跳过接入集成测试")

    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = client.post(
        "/api/v1/elders", headers=_headers(token), json={"name": "MQTT 测试老人"}
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
    session.execute(delete(Telemetry).where(Telemetry.device_id == device["id"]))
    session.execute(delete(Event).where(Event.device_id == device["id"]))
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


def _wait_for(predicate, timeout: float = 5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.1)
    return None


def test_telemetry_is_stored_within_two_seconds(
    client: TestClient, bound_device
) -> None:
    _, elder, device, uid = bound_device
    started = time.monotonic()

    _publish(
        f"iot/v1/{uid}/telemetry",
        {
            "device_uid": uid,
            "ts": datetime.now(timezone.utc).isoformat(),
            "metric": "heart_rate",
            "value": 78,
        },
    )

    def find_row():
        with SessionLocal() as session:
            return session.execute(
                select(Telemetry).where(
                    Telemetry.device_id == device["id"],
                    Telemetry.metric == "heart_rate",
                )
            ).scalar_one_or_none()

    row = _wait_for(find_row)
    elapsed = time.monotonic() - started

    assert row is not None, "2 秒内未在 telemetry 表中找到心率记录"
    assert row.elder_id == elder["id"]
    assert row.value_num == 78
    assert elapsed < 2.0


def test_status_message_updates_device_state(
    client: TestClient, bound_device
) -> None:
    _, _, device, uid = bound_device

    _publish(
        f"iot/v1/{uid}/status",
        {
            "device_uid": uid,
            "ts": datetime.now(timezone.utc).isoformat(),
            "battery": 42,
        },
    )

    def check():
        with SessionLocal() as session:
            stored = session.get(Device, device["id"])
            if stored.status == "online" and stored.battery_percent == 42:
                return stored
        return None

    assert _wait_for(check) is not None


def test_event_message_is_stored(client: TestClient, bound_device) -> None:
    _, _, device, uid = bound_device

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

    def check():
        with SessionLocal() as session:
            return session.execute(
                select(Event).where(
                    Event.device_id == device["id"], Event.type == "fall"
                )
            ).scalar_one_or_none()

    row = _wait_for(check)
    assert row is not None
    assert row.confidence == pytest.approx(0.97)
    assert row.payload_json == {"source": "mpu6050"}


def test_invalid_metric_is_dropped(client: TestClient, bound_device) -> None:
    _, _, device, uid = bound_device

    _publish(
        f"iot/v1/{uid}/telemetry",
        {
            "device_uid": uid,
            "ts": datetime.now(timezone.utc).isoformat(),
            "metric": "unknown-metric",
            "value": 1,
        },
    )
    time.sleep(0.8)

    with SessionLocal() as session:
        rows = list(
            session.execute(
                select(Telemetry).where(Telemetry.device_id == device["id"])
            ).scalars()
        )
    assert rows == []


def test_duplicate_telemetry_is_ignored(
    client: TestClient, bound_device
) -> None:
    _, _, device, uid = bound_device
    payload = {
        "device_uid": uid,
        "ts": datetime.now(timezone.utc).isoformat(),
        "metric": "heart_rate",
        "value": 66,
    }

    _publish(f"iot/v1/{uid}/telemetry", payload)
    _publish(f"iot/v1/{uid}/telemetry", payload)
    time.sleep(1.0)

    with SessionLocal() as session:
        rows = list(
            session.execute(
                select(Telemetry).where(
                    Telemetry.device_id == device["id"],
                    Telemetry.metric == "heart_rate",
                )
            ).scalars()
        )
    assert len(rows) == 1
