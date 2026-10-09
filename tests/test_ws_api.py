"""SPEC 01 步骤 9：WebSocket 实时推送集成测试（需要运行中的 compose 栈）。

延迟口径：告警在数据库中产生（alerts.created_at）到客户端通过
WebSocket 收到的间隔，要求小于 1 秒。
"""

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone

import pytest
import websockets
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from websockets.exceptions import ConnectionClosed

from app.db import SessionLocal
from app.models import Alert, AuditLog, Device, Elder, Event, Notification, Telemetry
from tests.helpers import publish_mqtt

WS_URL = "ws://127.0.0.1:8000/api/v1/ws"


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
def ws_context(client: TestClient, db, seeded_users):
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = client.post(
        "/api/v1/elders",
        headers=_headers(admin_token),
        json={"name": "WebSocket 测试老人"},
    ).json()
    uid = f"esp32-{uuid.uuid4().hex[:10]}"
    device = client.post(
        "/api/v1/devices",
        headers=_headers(admin_token),
        json={"device_uid": uid, "kind": "esp32"},
    ).json()
    client.post(
        f"/api/v1/devices/{device['id']}/bind",
        headers=_headers(admin_token),
        json={"elder_id": elder["id"]},
    )

    yield {"token": admin_token, "elder": elder, "device": device, "uid": uid}

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
    session.execute(delete(Event).where(Event.id.in_(event_ids or [0])))
    session.execute(delete(Telemetry).where(Telemetry.device_id == device["id"]))
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


def test_alert_is_pushed_within_one_second(ws_context) -> None:
    uid = ws_context["uid"]
    elder_id = ws_context["elder"]["id"]

    async def scenario():
        async with websockets.connect(
            f"{WS_URL}?token={ws_context['token']}"
        ) as websocket:
            ready = json.loads(await websocket.recv())
            assert ready == {"type": "ready"}
            await asyncio.to_thread(
                publish_mqtt,
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
            while True:
                data = json.loads(await websocket.recv())
                if (
                    data.get("type") == "alert"
                    and data["alert"]["elder_id"] == elder_id
                ):
                    return data, datetime.now(timezone.utc)

    payload, received_at = asyncio.run(asyncio.wait_for(scenario(), timeout=5))

    assert payload["type"] == "alert"
    assert payload["alert"]["event_type"] == "fall"
    assert payload["alert"]["elder_id"] == elder_id

    with SessionLocal() as session:
        created_at = session.get(Alert, payload["alert"]["id"]).created_at
    latency = (received_at - created_at).total_seconds()
    assert 0 <= latency < 1.0


def test_invalid_token_is_rejected(ws_context) -> None:
    async def scenario():
        async with websockets.connect(
            f"{WS_URL}?token=invalid-token"
        ) as websocket:
            await websocket.recv()

    with pytest.raises(ConnectionClosed) as excinfo:
        asyncio.run(asyncio.wait_for(scenario(), timeout=5))

    assert excinfo.value.rcvd is not None
    assert excinfo.value.rcvd.code == 4401


def test_telemetry_is_pushed(ws_context) -> None:
    uid = ws_context["uid"]

    async def scenario():
        async with websockets.connect(
            f"{WS_URL}?token={ws_context['token']}"
        ) as websocket:
            await websocket.recv()  # ready
            await asyncio.to_thread(
                publish_mqtt,
                f"iot/v1/{uid}/telemetry",
                {
                    "device_uid": uid,
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "metric": "heart_rate",
                    "value": 66,
                },
            )
            while True:
                data = json.loads(await websocket.recv())
                if data.get("type") == "telemetry" and data["telemetry"][
                    "elder_id"
                ] == ws_context["elder"]["id"]:
                    return data

    data = asyncio.run(asyncio.wait_for(scenario(), timeout=5))
    assert data["telemetry"]["metric"] == "heart_rate"
    assert data["telemetry"]["value_num"] == 66


def test_access_log_token_is_redacted() -> None:
    from app.logging_utils import install_log_redaction

    install_log_redaction()
    cases = [
        (
            "uvicorn.access",
            '%s - "%s %s HTTP/%s" %d',
            (
                "127.0.0.1:1234",
                "GET",
                "/api/v1/ws?token=secret.jwt.value&x=1",
                "1.1",
                101,
            ),
        ),
        (
            "uvicorn.error",
            '%s - "WebSocket %s" [accepted]',
            ("127.0.0.1:1234", "/api/v1/ws?token=secret.jwt.value"),
        ),
    ]
    for logger_name, message, args in cases:
        record = logging.LogRecord(
            name=logger_name,
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg=message,
            args=args,
            exc_info=None,
        )
        assert logging.getLogger(logger_name).filter(record) is not False
        rendered = record.getMessage()
        assert "secret.jwt.value" not in rendered
        assert "token=***" in rendered


def test_hub_filters_by_elder_visibility() -> None:
    """单元级验证：admin 全量、family 只看关联老人。"""
    import asyncio
    from datetime import timedelta

    from app.ws import RealtimeHub, _Client

    class FakeWebSocket:
        def __init__(self) -> None:
            self.sent: list[dict] = []

        async def send_json(self, payload: dict) -> None:
            self.sent.append(payload)

        async def close(self, code: int = 1000) -> None:
            return None

    async def scenario() -> tuple[list, list, list]:
        hub = RealtimeHub()
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
        checked_at = time.monotonic()
        linked = FakeWebSocket()
        unlinked = FakeWebSocket()
        admin = FakeWebSocket()
        hub._clients[linked] = _Client(linked, 1, "family", {10}, expires_at, checked_at)
        hub._clients[unlinked] = _Client(unlinked, 2, "family", {20}, expires_at, checked_at)
        hub._clients[admin] = _Client(admin, 3, "admin", None, expires_at, checked_at)

        await hub.broadcast({"type": "alert"}, elder_id=10)
        return linked.sent, unlinked.sent, admin.sent

    linked_sent, unlinked_sent, admin_sent = asyncio.run(scenario())
    assert linked_sent == [{"type": "alert"}]
    assert unlinked_sent == []
    assert admin_sent == [{"type": "alert"}]
