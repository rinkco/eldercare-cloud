"""SPEC 01 步骤 5：设备注册、列表与绑定集成测试。"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import AuditLog, Device, Elder


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_elder(client: TestClient, token: str, name: str) -> dict:
    response = client.post(
        "/api/v1/elders", headers=_headers(token), json={"name": name}
    )
    assert response.status_code == 201
    return response.json()


def _create_device(client: TestClient, token: str, uid: str) -> dict:
    response = client.post(
        "/api/v1/devices",
        headers=_headers(token),
        json={"device_uid": uid, "kind": "esp32", "model": "ESP32-DevKit"},
    )
    assert response.status_code == 201
    return response.json()


def _cleanup(db, device_ids: list[int], elder_ids: list[int]) -> None:
    session, _ = db
    if device_ids:
        session.execute(
            delete(AuditLog).where(
                AuditLog.target_type == "device",
                AuditLog.target_id.in_(device_ids),
            )
        )
        session.execute(delete(Device).where(Device.id.in_(device_ids)))
    if elder_ids:
        session.execute(
            delete(AuditLog).where(
                AuditLog.target_type == "elder",
                AuditLog.target_id.in_(elder_ids),
            )
        )
        session.execute(delete(Elder).where(Elder.id.in_(elder_ids)))
    session.commit()


def test_device_register_list_and_bind(
    client: TestClient, db, seeded_users
) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = _create_elder(client, token, "测试设备老人")
    uid = f"esp32-{uuid.uuid4().hex[:10]}"
    device = _create_device(client, token, uid)

    try:
        listing = client.get("/api/v1/devices", headers=_headers(token))
        assert listing.status_code == 200
        assert device["id"] in [item["id"] for item in listing.json()]

        bound = client.post(
            f"/api/v1/devices/{device['id']}/bind",
            headers=_headers(token),
            json={"elder_id": elder["id"]},
        )
        assert bound.status_code == 200
        assert bound.json()["elder_id"] == elder["id"]
        assert bound.json()["bound_at"] is not None

        repeated = client.post(
            f"/api/v1/devices/{device['id']}/bind",
            headers=_headers(token),
            json={"elder_id": elder["id"]},
        )
        assert repeated.status_code == 409

        session, _ = db
        session.expire_all()
        actions = set(
            session.execute(
                select(AuditLog.action).where(
                    AuditLog.target_type == "device",
                    AuditLog.target_id == device["id"],
                )
            ).scalars()
        )
        assert {"create_device", "bind_device"} <= actions
    finally:
        _cleanup(db, [device["id"]], [elder["id"]])


def test_duplicate_device_uid_is_rejected(
    client: TestClient, db, seeded_users
) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    uid = f"esp32-{uuid.uuid4().hex[:10]}"
    device = _create_device(client, token, uid)

    try:
        duplicate = client.post(
            "/api/v1/devices",
            headers=_headers(token),
            json={"device_uid": uid, "kind": "esp32"},
        )
        assert duplicate.status_code == 409
    finally:
        _cleanup(db, [device["id"]], [])


def test_bind_occupied_device_to_another_elder_is_rejected(
    client: TestClient, db, seeded_users
) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder_a = _create_elder(client, token, "测试占用老人A")
    elder_b = _create_elder(client, token, "测试占用老人B")
    device = _create_device(client, token, f"esp32-{uuid.uuid4().hex[:10]}")

    try:
        first = client.post(
            f"/api/v1/devices/{device['id']}/bind",
            headers=_headers(token),
            json={"elder_id": elder_a["id"]},
        )
        assert first.status_code == 200

        occupied = client.post(
            f"/api/v1/devices/{device['id']}/bind",
            headers=_headers(token),
            json={"elder_id": elder_b["id"]},
        )
        assert occupied.status_code == 409
    finally:
        _cleanup(db, [device["id"]], [elder_a["id"], elder_b["id"]])


def test_bind_missing_targets_returns_404(
    client: TestClient, db, seeded_users
) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    device = _create_device(client, token, f"esp32-{uuid.uuid4().hex[:10]}")

    try:
        missing_elder = client.post(
            f"/api/v1/devices/{device['id']}/bind",
            headers=_headers(token),
            json={"elder_id": 99999999},
        )
        assert missing_elder.status_code == 404

        missing_device = client.post(
            "/api/v1/devices/99999999/bind",
            headers=_headers(token),
            json={"elder_id": 99999999},
        )
        assert missing_device.status_code == 404
    finally:
        _cleanup(db, [device["id"]], [])


def test_family_cannot_access_device_admin_apis(
    client: TestClient, seeded_users
) -> None:
    token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )

    listing = client.get("/api/v1/devices", headers=_headers(token))
    creating = client.post(
        "/api/v1/devices",
        headers=_headers(token),
        json={"device_uid": "esp32-family", "kind": "esp32"},
    )
    binding = client.post(
        "/api/v1/devices/1/bind",
        headers=_headers(token),
        json={"elder_id": 1},
    )

    assert listing.status_code == 403
    assert creating.status_code == 403
    assert binding.status_code == 403


def test_disabled_device_cannot_bind(
    client: TestClient, db, seeded_users
) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = _create_elder(client, token, "测试停用设备老人")
    device = _create_device(client, token, f"esp32-{uuid.uuid4().hex[:10]}")

    try:
        session, _ = db
        session.execute(
            Device.__table__.update()
            .where(Device.id == device["id"])
            .values(status="disabled")
        )
        session.commit()

        response = client.post(
            f"/api/v1/devices/{device['id']}/bind",
            headers=_headers(token),
            json={"elder_id": elder["id"]},
        )
        assert response.status_code == 409
    finally:
        _cleanup(db, [device["id"]], [elder["id"]])


def test_invalid_device_uid_is_rejected(
    client: TestClient, seeded_users
) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )

    for bad_uid in ["bad/uid", "bad+uid", "bad#uid", "bad uid", "x" * 65]:
        response = client.post(
            "/api/v1/devices",
            headers=_headers(token),
            json={"device_uid": bad_uid, "kind": "esp32"},
        )
        assert response.status_code == 422, bad_uid


def test_deleting_elder_clears_device_binding(
    client: TestClient, db, seeded_users
) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = _create_elder(client, token, "测试解绑老人")
    device = _create_device(client, token, f"esp32-{uuid.uuid4().hex[:10]}")

    try:
        bound = client.post(
            f"/api/v1/devices/{device['id']}/bind",
            headers=_headers(token),
            json={"elder_id": elder["id"]},
        )
        assert bound.status_code == 200

        deleted = client.delete(
            f"/api/v1/elders/{elder['id']}", headers=_headers(token)
        )
        assert deleted.status_code == 204

        session, _ = db
        session.expire_all()
        stored = session.get(Device, device["id"])
        assert stored.elder_id is None
        assert stored.bound_at is None
    finally:
        _cleanup(db, [device["id"]], [elder["id"]])


def test_unbind_device_flow(client: TestClient, db, seeded_users) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    elder_one = _create_elder(client, token, "解绑测试老人甲")
    elder_two = _create_elder(client, token, "解绑测试老人乙")
    device = _create_device(client, token, f"esp32-{uuid.uuid4().hex[:10]}")
    url = f"/api/v1/devices/{device['id']}/unbind"

    try:
        bound = client.post(
            f"/api/v1/devices/{device['id']}/bind",
            headers=_headers(token),
            json={"elder_id": elder_one["id"]},
        )
        assert bound.status_code == 200

        assert client.post(url, headers=_headers(family_token)).status_code == 403

        unbound = client.post(url, headers=_headers(token))
        assert unbound.status_code == 200
        assert unbound.json()["elder_id"] is None
        assert unbound.json()["bound_at"] is None

        assert client.post(url, headers=_headers(token)).status_code == 409

        rebound = client.post(
            f"/api/v1/devices/{device['id']}/bind",
            headers=_headers(token),
            json={"elder_id": elder_two["id"]},
        )
        assert rebound.status_code == 200
        assert rebound.json()["elder_id"] == elder_two["id"]

        session, _ = db
        session.expire_all()
        actions = set(
            session.execute(
                select(AuditLog.action).where(
                    AuditLog.target_type == "device",
                    AuditLog.target_id == device["id"],
                )
            ).scalars()
        )
        assert "unbind_device" in actions
    finally:
        _cleanup(db, [device["id"]], [elder_one["id"], elder_two["id"]])


def test_lora_node_kind_is_accepted(
    client: TestClient, db, seeded_users
) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    response = client.post(
        "/api/v1/devices",
        headers=_headers(token),
        json={
            "device_uid": f"lora-{uuid.uuid4().hex[:10]}",
            "kind": "lora_node",
        },
    )

    assert response.status_code == 201
    body = response.json()
    try:
        assert body["kind"] == "lora_node"
    finally:
        _cleanup(db, [body["id"]], [])
