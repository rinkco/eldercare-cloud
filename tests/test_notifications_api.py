"""SPEC 02 步骤 1：告警通知记录查询集成测试。"""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import (
    Alert,
    AuditLog,
    Device,
    Elder,
    ElderAccess,
    Event,
    Notification,
)
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


@pytest.fixture
def notify_context(client: TestClient, db, seeded_users):
    session, _ = db
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )

    def create_elder(name: str) -> dict:
        return client.post(
            "/api/v1/elders",
            headers=_headers(admin_token),
            json={"name": name, "phone": unique_phone()},
        ).json()

    linked = create_elder("通知测试老人-已关联")
    unlinked = create_elder("通知测试老人-未关联")
    devices = {}
    for key, elder in (("linked", linked), ("unlinked", unlinked)):
        device = client.post(
            "/api/v1/devices",
            headers=_headers(admin_token),
            json={
                "device_uid": f"esp32-{uuid.uuid4().hex[:10]}",
                "kind": "esp32",
            },
        ).json()
        client.post(
            f"/api/v1/devices/{device['id']}/bind",
            headers=_headers(admin_token),
            json={"elder_id": elder["id"]},
        )
        devices[key] = device

    session.add(
        ElderAccess(
            elder_id=linked["id"],
            user_id=seeded_users.family.id,
            relation="son",
        )
    )
    now = datetime.now(timezone.utc)
    linked_event = Event(
        elder_id=linked["id"],
        device_id=devices["linked"]["id"],
        type="fall",
        severity="critical",
        occurred_at=now,
        payload_json={"source": "test"},
    )
    unlinked_event = Event(
        elder_id=unlinked["id"],
        device_id=devices["unlinked"]["id"],
        type="sos",
        severity="critical",
        occurred_at=now,
        payload_json={"source": "test"},
    )
    session.add_all([linked_event, unlinked_event])
    session.flush()
    linked_alert = Alert(event_id=linked_event.id, elder_id=linked["id"])
    unlinked_alert = Alert(event_id=unlinked_event.id, elder_id=unlinked["id"])
    session.add_all([linked_alert, unlinked_alert])
    session.flush()
    session.add_all(
        [
            Notification(
                alert_id=linked_alert.id,
                contact_id=None,
                channel="console",
                target="13800000001",
                content="测试通知一",
                status="sent",
                sent_at=now,
            ),
            Notification(
                alert_id=linked_alert.id,
                contact_id=None,
                channel="console",
                target="13800000002",
                content="测试通知二",
                status="sent",
                sent_at=now,
            ),
        ]
    )
    session.commit()

    yield {
        "admin_token": admin_token,
        "family_token": family_token,
        "linked_alert_id": linked_alert.id,
        "unlinked_alert_id": unlinked_alert.id,
        "linked": linked,
        "unlinked": unlinked,
        "devices": devices,
    }

    alert_ids = [linked_alert.id, unlinked_alert.id]
    event_ids = [linked_event.id, unlinked_event.id]
    device_ids = [devices["linked"]["id"], devices["unlinked"]["id"]]
    elder_ids = [linked["id"], unlinked["id"]]
    session.execute(
        delete(Notification).where(Notification.alert_id.in_(alert_ids))
    )
    session.execute(delete(Alert).where(Alert.id.in_(alert_ids)))
    session.execute(delete(Event).where(Event.id.in_(event_ids)))
    session.execute(
        delete(ElderAccess).where(ElderAccess.elder_id.in_(elder_ids))
    )
    session.execute(
        delete(AuditLog).where(
            AuditLog.target_type == "device",
            AuditLog.target_id.in_(device_ids),
        )
    )
    session.execute(
        delete(AuditLog).where(
            AuditLog.target_type == "elder",
            AuditLog.target_id.in_(elder_ids),
        )
    )
    session.execute(delete(Device).where(Device.id.in_(device_ids)))
    session.execute(delete(Elder).where(Elder.id.in_(elder_ids)))
    session.commit()


def test_notifications_query_admin_and_family(
    client: TestClient, notify_context
) -> None:
    alert_id = notify_context["linked_alert_id"]

    admin_response = client.get(
        f"/api/v1/alerts/{alert_id}/notifications",
        headers=_headers(notify_context["admin_token"]),
    )
    assert admin_response.status_code == 200
    rows = admin_response.json()
    assert len(rows) == 2
    assert {row["channel"] for row in rows} == {"console"}
    assert {row["status"] for row in rows} == {"sent"}
    assert rows[0]["content"] == "测试通知一"
    # 字段契约：target / sent_at / error / contact_id 均完整返回
    assert [row["target"] for row in rows] == [
        "13800000001",
        "13800000002",
    ]
    assert all(row["sent_at"] for row in rows)
    assert len({row["sent_at"] for row in rows}) == 1
    assert all(row["error"] is None for row in rows)
    assert all(row["contact_id"] is None for row in rows)

    family_response = client.get(
        f"/api/v1/alerts/{alert_id}/notifications",
        headers=_headers(notify_context["family_token"]),
    )
    assert family_response.status_code == 200
    assert len(family_response.json()) == 2


def test_notifications_visibility_and_missing(
    client: TestClient, notify_context
) -> None:
    family_token = notify_context["family_token"]

    denied = client.get(
        f"/api/v1/alerts/{notify_context['unlinked_alert_id']}/notifications",
        headers=_headers(family_token),
    )
    missing = client.get(
        "/api/v1/alerts/99999999/notifications",
        headers=_headers(family_token),
    )

    assert denied.status_code == 403
    assert missing.status_code == 404
