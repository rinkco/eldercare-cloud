"""SPEC 01 步骤 4：老人档案、访问范围与紧急联系人集成测试。"""

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import AuditLog, Elder, ElderAccess


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
        "/api/v1/elders",
        headers=_headers(token),
        json={"name": name, "gender": "female", "height_cm": 160, "weight_kg": 55.5},
    )
    assert response.status_code == 201
    return response.json()



def _cleanup_elders(db, elder_ids: list[int]) -> None:
    session, _ = db
    if not elder_ids:
        return
    session.execute(
        delete(AuditLog).where(
            AuditLog.target_type == "elder",
            AuditLog.target_id.in_(elder_ids),
        )
    )
    session.execute(delete(Elder).where(Elder.id.in_(elder_ids)))
    session.commit()


def test_admin_elder_crud_and_audit(client: TestClient, db, seeded_users) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = _create_elder(client, token, "测试老人甲")
    elder_id = elder["id"]

    try:
        detail = client.get(f"/api/v1/elders/{elder_id}", headers=_headers(token))
        assert detail.status_code == 200
        assert detail.json()["name"] == "测试老人甲"

        updated = client.put(
            f"/api/v1/elders/{elder_id}",
            headers=_headers(token),
            json={"address": "测试地址 1 号"},
        )
        assert updated.status_code == 200
        assert updated.json()["address"] == "测试地址 1 号"

        listing = client.get("/api/v1/elders", headers=_headers(token))
        assert listing.status_code == 200
        assert elder_id in [item["id"] for item in listing.json()]

        session, _ = db
        session.expire_all()
        actions = set(
            session.execute(
                select(AuditLog.action).where(AuditLog.target_id == elder_id)
            ).scalars()
        )
        assert {"create_elder", "update_elder"} <= actions

        deleted = client.delete(
            f"/api/v1/elders/{elder_id}", headers=_headers(token)
        )
        assert deleted.status_code == 204
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(token)
            ).status_code
            == 404
        )

        session.expire_all()
        actions_after_delete = set(
            session.execute(
                select(AuditLog.action).where(AuditLog.target_id == elder_id)
            ).scalars()
        )
        assert "delete_elder" in actions_after_delete
    finally:
        _cleanup_elders(db, [elder_id])


def test_family_only_sees_linked_elders(
    client: TestClient, db, seeded_users
) -> None:
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    linked = _create_elder(client, admin_token, "测试老人已关联")
    unlinked = _create_elder(client, admin_token, "测试老人未关联")

    try:
        session, _ = db
        session.add(
            ElderAccess(
                elder_id=linked["id"],
                user_id=seeded_users.family.id,
                relation="daughter",
            )
        )
        session.commit()

        listing = client.get("/api/v1/elders", headers=_headers(family_token))
        assert listing.status_code == 200
        visible_ids = [item["id"] for item in listing.json()]
        assert linked["id"] in visible_ids
        assert unlinked["id"] not in visible_ids

        allowed = client.get(
            f"/api/v1/elders/{linked['id']}", headers=_headers(family_token)
        )
        assert allowed.status_code == 200

        denied = client.get(
            f"/api/v1/elders/{unlinked['id']}", headers=_headers(family_token)
        )
        assert denied.status_code == 403
    finally:
        _cleanup_elders(db, [linked["id"], unlinked["id"]])


def test_family_creator_gets_access(
    client: TestClient, db, seeded_users
) -> None:
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )

    elder = _create_elder(client, family_token, "家属创建老人")

    try:
        detail = client.get(
            f"/api/v1/elders/{elder['id']}", headers=_headers(family_token)
        )
        assert detail.status_code == 200
    finally:
        _cleanup_elders(db, [elder["id"]])


def test_contacts_replace_flow(client: TestClient, db, seeded_users) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = _create_elder(client, token, "测试联系人老人")
    elder_id = elder["id"]

    try:
        created = client.put(
            f"/api/v1/elders/{elder_id}/contacts",
            headers=_headers(token),
            json=[
                {
                    "name": "儿子",
                    "phone": "13800000001",
                    "relation": "son",
                    "priority": 1,
                    "is_primary": True,
                },
                {
                    "name": "女儿",
                    "phone": "13800000002",
                    "relation": "daughter",
                    "priority": 2,
                },
            ],
        )
        assert created.status_code == 200
        assert [item["name"] for item in created.json()] == ["儿子", "女儿"]

        listing = client.get(
            f"/api/v1/elders/{elder_id}/contacts", headers=_headers(token)
        )
        assert listing.status_code == 200
        assert len(listing.json()) == 2

        replaced = client.put(
            f"/api/v1/elders/{elder_id}/contacts",
            headers=_headers(token),
            json=[{"name": "邻居", "phone": "13900000003", "priority": 1}],
        )
        assert replaced.status_code == 200
        assert [item["name"] for item in replaced.json()] == ["邻居"]

        listing_after = client.get(
            f"/api/v1/elders/{elder_id}/contacts", headers=_headers(token)
        )
        assert [item["name"] for item in listing_after.json()] == ["邻居"]

        session, _ = db
        session.expire_all()
        actions = set(
            session.execute(
                select(AuditLog.action).where(AuditLog.target_id == elder_id)
            ).scalars()
        )
        assert "update_elder_contacts" in actions
    finally:
        _cleanup_elders(db, [elder_id])


def test_update_elder_rejects_explicit_null_name(
    client: TestClient, db, seeded_users
) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = _create_elder(client, token, "测试空姓名老人")

    try:
        response = client.put(
            f"/api/v1/elders/{elder['id']}",
            headers=_headers(token),
            json={"name": None},
        )
        assert response.status_code == 422
    finally:
        _cleanup_elders(db, [elder["id"]])


def test_contacts_reject_multiple_primary(
    client: TestClient, db, seeded_users
) -> None:
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = _create_elder(client, token, "测试多主联系人")

    try:
        response = client.put(
            f"/api/v1/elders/{elder['id']}/contacts",
            headers=_headers(token),
            json=[
                {"name": "A", "phone": "13800000001", "is_primary": True},
                {"name": "B", "phone": "13800000002", "is_primary": True},
            ],
        )
        assert response.status_code == 422
    finally:
        _cleanup_elders(db, [elder["id"]])
