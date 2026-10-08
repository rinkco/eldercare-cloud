"""SPEC 01 步骤 8：遥测/事件/告警查询与健康趋势聚合集成测试。"""

import uuid
from datetime import datetime, timedelta, timezone

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
    Telemetry,
)


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
def query_context(client: TestClient, db, seeded_users):
    session, _ = db
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )

    linked = client.post(
        "/api/v1/elders",
        headers=_headers(admin_token),
        json={"name": "查询测试老人-已关联"},
    ).json()
    unlinked = client.post(
        "/api/v1/elders",
        headers=_headers(admin_token),
        json={"name": "查询测试老人-未关联"},
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
        json={"elder_id": linked["id"]},
    )
    session.add(
        ElderAccess(
            elder_id=linked["id"],
            user_id=seeded_users.family.id,
            relation="daughter",
        )
    )
    session.commit()

    yield {
        "admin_token": admin_token,
        "family_token": family_token,
        "linked": linked,
        "unlinked": unlinked,
        "device": device,
        "family_id": seeded_users.family.id,
    }

    elder_ids = [linked["id"], unlinked["id"]]
    event_ids = list(
        session.execute(
            select(Event.id).where(Event.elder_id.in_(elder_ids))
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
    session.execute(delete(Telemetry).where(Telemetry.elder_id.in_(elder_ids)))
    session.execute(
        delete(ElderAccess).where(ElderAccess.elder_id.in_(elder_ids))
    )
    session.execute(
        delete(AuditLog).where(
            AuditLog.target_type == "device",
            AuditLog.target_id == device["id"],
        )
    )
    session.execute(
        delete(AuditLog).where(
            AuditLog.target_type == "elder",
            AuditLog.target_id.in_(elder_ids),
        )
    )
    session.execute(delete(Device).where(Device.id == device["id"]))
    session.execute(delete(Elder).where(Elder.id.in_(elder_ids)))
    session.commit()


def _seed_telemetry(context, session) -> datetime:
    base = datetime(2026, 10, 8, 2, 0, tzinfo=timezone.utc)
    elder_id = context["linked"]["id"]
    device_id = context["device"]["id"]
    session.add_all(
        [
            Telemetry(
                device_id=device_id,
                elder_id=elder_id,
                metric="heart_rate",
                value_num=60,
                recorded_at=base,
            ),
            Telemetry(
                device_id=device_id,
                elder_id=elder_id,
                metric="heart_rate",
                value_num=80,
                recorded_at=base + timedelta(minutes=30),
            ),
            Telemetry(
                device_id=device_id,
                elder_id=elder_id,
                metric="heart_rate",
                value_num=90,
                recorded_at=base + timedelta(hours=1),
            ),
            Telemetry(
                device_id=device_id,
                elder_id=elder_id,
                metric="spo2",
                value_num=95,
                recorded_at=base,
            ),
            Telemetry(
                device_id=device_id,
                elder_id=elder_id,
                metric="spo2",
                value_num=97,
                recorded_at=base + timedelta(minutes=30),
            ),
            Telemetry(
                device_id=device_id,
                elder_id=elder_id,
                metric="steps",
                value_num=100,
                recorded_at=base,
            ),
            Telemetry(
                device_id=device_id,
                elder_id=elder_id,
                metric="steps",
                value_num=150,
                recorded_at=base + timedelta(minutes=30),
            ),
            Telemetry(
                device_id=device_id,
                elder_id=elder_id,
                metric="activity",
                value_text="walking",
                recorded_at=base,
            ),
            Telemetry(
                device_id=device_id,
                elder_id=elder_id,
                metric="activity",
                value_text="walking",
                recorded_at=base + timedelta(minutes=10),
            ),
            Telemetry(
                device_id=device_id,
                elder_id=elder_id,
                metric="activity",
                value_text="resting",
                recorded_at=base + timedelta(minutes=20),
            ),
        ]
    )
    session.commit()
    return base


def test_telemetry_query_with_metric_and_time_filters(
    client: TestClient, db, query_context
) -> None:
    session, _ = db
    base = _seed_telemetry(query_context, session)
    elder_id = query_context["linked"]["id"]
    token = query_context["admin_token"]

    all_heart_rate = client.get(
        f"/api/v1/elders/{elder_id}/telemetry",
        headers=_headers(token),
        params={"metric": "heart_rate"},
    )
    assert all_heart_rate.status_code == 200
    rows = all_heart_rate.json()
    assert len(rows) == 3
    assert rows[0]["value_num"] == 90

    filtered = client.get(
        f"/api/v1/elders/{elder_id}/telemetry",
        headers=_headers(token),
        params={
            "metric": "heart_rate",
            "start": (base + timedelta(minutes=20)).isoformat(),
            "end": (base + timedelta(minutes=40)).isoformat(),
        },
    )
    assert [row["value_num"] for row in filtered.json()] == [80]


def test_health_trends_hour(
    client: TestClient, db, query_context
) -> None:
    session, _ = db
    _seed_telemetry(query_context, session)
    elder_id = query_context["linked"]["id"]

    response = client.get(
        f"/api/v1/elders/{elder_id}/health-trends",
        headers=_headers(query_context["admin_token"]),
        params={"interval": "hour"},
    )

    assert response.status_code == 200
    buckets = response.json()
    assert len(buckets) == 2
    first = buckets[0]
    assert first["heart_rate"] == {"avg": 70.0, "min": 60.0, "max": 80.0, "count": 2}
    assert first["spo2"]["avg"] == 96.0
    assert first["steps_total"] == 250.0
    activity = {item["activity"]: item["count"] for item in first["activity"]}
    assert activity == {"walking": 2, "resting": 1}
    assert buckets[1]["heart_rate"]["avg"] == 90.0
    assert buckets[1]["steps_total"] is None


def test_health_trends_day(
    client: TestClient, db, query_context
) -> None:
    session, _ = db
    _seed_telemetry(query_context, session)
    elder_id = query_context["linked"]["id"]

    response = client.get(
        f"/api/v1/elders/{elder_id}/health-trends",
        headers=_headers(query_context["admin_token"]),
        params={"interval": "day"},
    )

    buckets = response.json()
    assert len(buckets) == 1
    stats = buckets[0]["heart_rate"]
    assert stats["count"] == 3
    assert stats["min"] == 60.0
    assert stats["max"] == 90.0
    assert buckets[0]["steps_total"] == 250.0


def test_events_visibility_and_filter(
    client: TestClient, db, query_context
) -> None:
    session, _ = db
    base = datetime(2026, 10, 8, 2, 0, tzinfo=timezone.utc)
    session.add_all(
        [
            Event(
                elder_id=query_context["linked"]["id"],
                device_id=query_context["device"]["id"],
                type="sos",
                severity="critical",
                occurred_at=base,
                payload_json={},
            ),
            Event(
                elder_id=query_context["unlinked"]["id"],
                device_id=query_context["device"]["id"],
                type="fall",
                severity="critical",
                occurred_at=base + timedelta(minutes=1),
                payload_json={},
            ),
        ]
    )
    session.commit()

    family_events = client.get(
        "/api/v1/events", headers=_headers(query_context["family_token"])
    ).json()
    assert [item["type"] for item in family_events] == ["sos"]

    admin_fall = client.get(
        "/api/v1/events",
        headers=_headers(query_context["admin_token"]),
        params={
            "type": "fall",
            "elder_id": query_context["unlinked"]["id"],
        },
    ).json()
    assert [item["elder_id"] for item in admin_fall] == [
        query_context["unlinked"]["id"]
    ]


def test_alert_query_and_acknowledge(
    client: TestClient, db, query_context
) -> None:
    session, _ = db
    base = datetime(2026, 10, 8, 2, 0, tzinfo=timezone.utc)
    linked_event = Event(
        elder_id=query_context["linked"]["id"],
        device_id=query_context["device"]["id"],
        type="fall",
        severity="critical",
        occurred_at=base,
        payload_json={},
    )
    unlinked_event = Event(
        elder_id=query_context["unlinked"]["id"],
        device_id=query_context["device"]["id"],
        type="sos",
        severity="critical",
        occurred_at=base,
        payload_json={},
    )
    session.add_all([linked_event, unlinked_event])
    session.flush()
    linked_alert = Alert(event_id=linked_event.id, elder_id=linked_event.elder_id)
    unlinked_alert = Alert(
        event_id=unlinked_event.id, elder_id=unlinked_event.elder_id
    )
    session.add_all([linked_alert, unlinked_alert])
    session.commit()

    family_token = query_context["family_token"]
    alerts = client.get(
        "/api/v1/alerts", headers=_headers(family_token)
    ).json()
    assert [item["id"] for item in alerts] == [linked_alert.id]

    ack = client.post(
        f"/api/v1/alerts/{linked_alert.id}/ack", headers=_headers(family_token)
    )
    assert ack.status_code == 200
    body = ack.json()
    assert body["status"] == "handled"
    assert body["handled_by"] == query_context["family_id"]
    assert body["handled_at"] is not None

    session.expire_all()
    audit = session.execute(
        select(AuditLog).where(
            AuditLog.action == "ack_alert",
            AuditLog.target_id == linked_alert.id,
        )
    ).scalar_one_or_none()
    assert audit is not None

    repeated = client.post(
        f"/api/v1/alerts/{linked_alert.id}/ack", headers=_headers(family_token)
    )
    assert repeated.status_code == 200
    assert repeated.json()["status"] == "handled"
    session.expire_all()
    audit_count = len(
        list(
            session.execute(
                select(AuditLog).where(
                    AuditLog.action == "ack_alert",
                    AuditLog.target_id == linked_alert.id,
                )
            ).scalars()
        )
    )
    assert audit_count == 1

    forbidden = client.post(
        f"/api/v1/alerts/{unlinked_alert.id}/ack",
        headers=_headers(family_token),
    )
    assert forbidden.status_code == 403

    missing = client.post(
        "/api/v1/alerts/99999999/ack", headers=_headers(family_token)
    )
    assert missing.status_code == 404


def test_naive_datetime_is_rejected(
    client: TestClient, db, query_context
) -> None:
    elder_id = query_context["linked"]["id"]
    token = query_context["admin_token"]

    response = client.get(
        f"/api/v1/elders/{elder_id}/health-trends",
        headers=_headers(token),
        params={"start": "2026-10-08T02:00:00"},
    )

    assert response.status_code == 422


def test_trends_ignore_null_values(
    client: TestClient, db, query_context
) -> None:
    session, _ = db
    base = datetime(2026, 10, 8, 2, 0, tzinfo=timezone.utc)
    session.add(
        Telemetry(
            device_id=query_context["device"]["id"],
            elder_id=query_context["linked"]["id"],
            metric="heart_rate",
            value_num=None,
            recorded_at=base,
        )
    )
    session.commit()

    response = client.get(
        f"/api/v1/elders/{query_context['linked']['id']}/health-trends",
        headers=_headers(query_context["admin_token"]),
    )

    assert response.status_code == 200
    assert response.json() == []


def test_family_cannot_query_unlinked_elder_telemetry(
    client: TestClient, db, query_context
) -> None:
    response = client.get(
        f"/api/v1/elders/{query_context['unlinked']['id']}/telemetry",
        headers=_headers(query_context["family_token"]),
    )

    assert response.status_code == 403
