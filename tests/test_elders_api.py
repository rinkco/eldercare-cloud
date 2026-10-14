"""SPEC 01 步骤 4：老人档案、访问范围与紧急联系人集成测试。"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import AuditLog, Device, Elder, ElderAccess, User
from app.security import hash_password
from tests.helpers import unique_phone

EXTRA_FAMILY_PASSWORD = "extra-family-pass-123"


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_elder(
    client: TestClient, token: str, name: str, phone: str | None = None
) -> dict:
    """经接口新建老人；SPEC 06 起手机号必填，未指定时用随机手机号。"""
    response = client.post(
        "/api/v1/elders",
        headers=_headers(token),
        json={
            "name": name,
            "phone": phone or unique_phone(),
            "gender": "female",
            "height_cm": 160,
            "weight_kg": 55.5,
        },
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


def _create_family_user(db, display_name: str = "额外家属") -> User:
    session, _ = db
    user = User(
        username=f"t-extra-{uuid.uuid4().hex[:8]}",
        password_hash=hash_password(EXTRA_FAMILY_PASSWORD),
        role="family",
        display_name=display_name,
    )
    session.add(user)
    session.commit()
    return user


def _delete_user(db, user_id: int) -> None:
    session, _ = db
    session.execute(delete(AuditLog).where(AuditLog.user_id == user_id))
    session.execute(delete(User).where(User.id == user_id))
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


def test_elder_responses_drop_member_role(
    client: TestClient, db, seeded_users
) -> None:
    """SPEC 04：响应不再含 my_role；家属成员权限一致（均可编辑档案）。

    SPEC 06：成员增删收敛为仅 admin，家属只读。
    """
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    admin_elder = _create_elder(client, admin_token, "统一权限-管理员创建")
    family_elder = _create_elder(client, family_token, "统一权限-家属创建")
    elder_ids = [admin_elder["id"], family_elder["id"]]
    other = _create_family_user(db)

    try:
        assert "my_role" not in admin_elder
        assert "my_role" not in family_elder

        family_listing = client.get(
            "/api/v1/elders", headers=_headers(family_token)
        )
        assert family_listing.status_code == 200
        assert [item["id"] for item in family_listing.json()] == [
            family_elder["id"]
        ]
        assert all("my_role" not in item for item in family_listing.json())

        # SPEC 06：成员增删仅 admin；家属提交整体替换一律 403
        assert (
            client.put(
                f"/api/v1/elders/{family_elder['id']}/access",
                headers=_headers(family_token),
                json=[{"user_id": seeded_users.family.id}],
            ).status_code
            == 403
        )

        granted = client.put(
            f"/api/v1/elders/{family_elder['id']}/access",
            headers=_headers(admin_token),
            json=[
                {"user_id": seeded_users.family.id, "relation": "creator"},
                {"user_id": other.id, "relation": "son"},
            ],
        )
        assert granted.status_code == 200

        other_token = _login(client, other.username, EXTRA_FAMILY_PASSWORD)
        detail = client.get(
            f"/api/v1/elders/{family_elder['id']}",
            headers=_headers(other_token),
        )
        assert detail.status_code == 200
        assert "my_role" not in detail.json()

        updated = client.put(
            f"/api/v1/elders/{family_elder['id']}",
            headers=_headers(other_token),
            json={"address": "统一权限地址"},
        )
        assert updated.status_code == 200
        assert updated.json()["address"] == "统一权限地址"
        assert "my_role" not in updated.json()
    finally:
        _cleanup_elders(db, elder_ids)
        _delete_user(db, other.id)


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


def test_access_grant_and_admin_only_management(
    client: TestClient, db, seeded_users
) -> None:
    """SPEC 04：家属成员权限一致——可编辑档案、不可删老人。

    SPEC 05：整体替换允许空列表（清空全部绑定）。
    SPEC 06：成员增删与候选检索收敛为仅 admin；家属对成员列表只读。
    """
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    elder = _create_elder(client, admin_token, "测试成员权限老人")
    elder_id = elder["id"]
    family_id = seeded_users.family.id
    session, _ = db

    try:
        empty = client.get(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(admin_token),
        )
        assert empty.status_code == 200
        assert empty.json() == []

        granted = client.put(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(admin_token),
            json=[{"user_id": family_id, "relation": "daughter"}],
        )
        assert granted.status_code == 200
        body = granted.json()
        assert len(body) == 1
        assert body[0]["user_id"] == family_id
        assert body[0]["username"] == seeded_users.family.username
        assert set(body[0]) == {
            "id",
            "user_id",
            "username",
            "display_name",
            "relation",
        }
        session.expire_all()
        actions = set(
            session.execute(
                select(AuditLog.action).where(AuditLog.target_id == elder_id)
            ).scalars()
        )
        assert "update_elder_access" in actions

        # 家属成员：可见成员列表、可改档案，但不能删老人、不能增删成员
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(family_token)
            ).status_code
            == 200
        )
        updated = client.put(
            f"/api/v1/elders/{elder_id}",
            headers=_headers(family_token),
            json={"address": "家属修改地址"},
        )
        assert updated.status_code == 200
        assert updated.json()["address"] == "家属修改地址"
        assert (
            client.delete(
                f"/api/v1/elders/{elder_id}", headers=_headers(family_token)
            ).status_code
            == 403
        )
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(family_token),
            ).status_code
            == 200
        )
        assert (
            client.put(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(family_token),
                json=[{"user_id": family_id, "relation": "daughter"}],
            ).status_code
            == 403
        )
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}/access/candidates",
                headers=_headers(family_token),
                params={"q": "x"},
            ).status_code
            == 403
        )

        # SPEC 05：空列表表示清空全部绑定（取消最后一位成员），返回 200 与空列表
        cleared = client.put(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(admin_token),
            json=[],
        )
        assert cleared.status_code == 200
        assert cleared.json() == []
        # 校验：成员不重复、只能关联 family 账号、账号不存在 404
        assert (
            client.put(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(admin_token),
                json=[
                    {"user_id": family_id},
                    {"user_id": family_id},
                ],
            ).status_code
            == 422
        )
        assert (
            client.put(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(admin_token),
                json=[{"user_id": seeded_users.admin.id}],
            ).status_code
            == 422
        )
        assert (
            client.put(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(admin_token),
                json=[{"user_id": 999999999}],
            ).status_code
            == 404
        )
    finally:
        _cleanup_elders(db, [elder_id])


def test_family_cannot_manage_members(
    client: TestClient, db, seeded_users
) -> None:
    """SPEC 06：家属不再能增删成员，成员列表对家属只读。

    管理员仍可用整体替换增删（含清空最后一位成员，SPEC 05 语义保留在 admin 侧）。
    """
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    elder = _create_elder(client, family_token, "家属成员管理老人")
    elder_id = elder["id"]
    other = _create_family_user(db)

    try:
        members = client.get(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(family_token),
        )
        assert members.status_code == 200
        assert [item["username"] for item in members.json()] == [
            seeded_users.family.username
        ]

        # 家属提交整体替换与候选检索都 403
        assert (
            client.put(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(family_token),
                json=[
                    {"user_id": seeded_users.family.id, "relation": "creator"},
                    {"user_id": other.id, "relation": "son"},
                ],
            ).status_code
            == 403
        )
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}/access/candidates",
                headers=_headers(family_token),
                params={"q": other.username},
            ).status_code
            == 403
        )

        # 成员列表未被改动：仍然只有创建者
        unchanged = client.get(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(family_token),
        )
        assert [item["user_id"] for item in unchanged.json()] == [
            seeded_users.family.id
        ]

        # 管理员仍可增删成员（SPEC 04/05 语义保留在 admin 侧）
        granted = client.put(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(admin_token),
            json=[
                {"user_id": seeded_users.family.id, "relation": "creator"},
                {"user_id": other.id, "relation": "son"},
            ],
        )
        assert granted.status_code == 200
        assert {item["user_id"] for item in granted.json()} == {
            seeded_users.family.id,
            other.id,
        }

        other_token = _login(client, other.username, EXTRA_FAMILY_PASSWORD)
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(other_token)
            ).status_code
            == 200
        )

        # 家属不能移除他人，只能解除自己的绑定（自助解绑，见访问范围用例）
        assert (
            client.put(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(other_token),
                json=[
                    {"user_id": seeded_users.family.id, "relation": "creator"}
                ],
            ).status_code
            == 403
        )
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(other_token)
            ).status_code
            == 200
        )

        # SPEC 05：最后一位成员也可以由管理员清空，随后家属失去访问
        cleared = client.put(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(admin_token),
            json=[],
        )
        assert cleared.status_code == 200
        assert cleared.json() == []
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(family_token)
            ).status_code
            == 403
        )
    finally:
        _cleanup_elders(db, [elder_id])
        _delete_user(db, other.id)


def test_family_reads_bound_devices_readonly(
    client: TestClient, db, seeded_users
) -> None:
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    elder = _create_elder(client, admin_token, "测试家属只读设备")
    elder_id = elder["id"]
    session, _ = db
    device: dict | None = None

    try:
        # 未授权时家属看不到该老人的设备
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}/devices",
                headers=_headers(family_token),
            ).status_code
            == 403
        )

        created = client.post(
            "/api/v1/devices",
            headers=_headers(admin_token),
            json={
                "device_uid": f"esp32-{uuid.uuid4().hex[:10]}",
                "kind": "esp32",
            },
        )
        assert created.status_code == 201
        device = created.json()
        bound = client.post(
            f"/api/v1/devices/{device['id']}/bind",
            headers=_headers(admin_token),
            json={"elder_id": elder_id},
        )
        assert bound.status_code == 200

        granted = client.put(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(admin_token),
            json=[{"user_id": seeded_users.family.id, "relation": "daughter"}],
        )
        assert granted.status_code == 200

        listing = client.get(
            f"/api/v1/elders/{elder_id}/devices",
            headers=_headers(family_token),
        )
        assert listing.status_code == 200
        assert [item["id"] for item in listing.json()] == [device["id"]]

        # 家属仍不能使用 admin 设备接口
        assert (
            client.post(
                "/api/v1/devices",
                headers=_headers(family_token),
                json={
                    "device_uid": f"esp32-{uuid.uuid4().hex[:10]}",
                    "kind": "esp32",
                },
            ).status_code
            == 403
        )
    finally:
        if device is not None:
            session.execute(
                delete(AuditLog).where(
                    AuditLog.target_type == "device",
                    AuditLog.target_id == device["id"],
                )
            )
            session.execute(delete(Device).where(Device.id == device["id"]))
            session.commit()
        _cleanup_elders(db, [elder_id])


def test_access_candidates_search(
    client: TestClient, db, seeded_users
) -> None:
    """SPEC 03 步骤 3：候选家属检索的鉴权、匹配、排除与参数边界。

    SPEC 06：候选检索收敛为仅 admin（家属一律 403）。
    """
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    elder = _create_elder(client, family_token, "候选检索老人")
    elder_id = elder["id"]
    # 关键字带随机后缀，避免与 seed 演示账号的显示名碰撞
    tag = f"cs{uuid.uuid4().hex[:6]}"
    first = _create_family_user(db, display_name=f"候选家属甲-{tag}")
    second = _create_family_user(db, display_name=f"候选家属乙-{tag}")
    url = f"/api/v1/elders/{elder_id}/access/candidates"

    try:
        # SPEC 06：家属（即使已关联）不能检索候选
        assert (
            client.get(
                url, headers=_headers(family_token), params={"q": tag}
            ).status_code
            == 403
        )

        # admin 按显示名包含匹配，按 ID 升序，字段只有三个
        by_name = client.get(
            url, headers=_headers(admin_token), params={"q": tag}
        )
        assert by_name.status_code == 200
        assert [item["id"] for item in by_name.json()] == sorted(
            [first.id, second.id]
        )
        assert set(by_name.json()[0]) == {"id", "username", "display_name"}
        assert by_name.json()[0]["display_name"] == f"候选家属甲-{tag}"

        # admin 也可检索；账号匹配大小写不敏感
        by_username = client.get(
            url,
            headers=_headers(admin_token),
            params={"q": first.username.upper()},
        )
        assert by_username.status_code == 200
        assert [item["id"] for item in by_username.json()] == [first.id]

        # 仅返回全局角色 family：admin 账号不会被搜到
        admin_probe = client.get(
            url,
            headers=_headers(admin_token),
            params={"q": seeded_users.admin.username.upper()},
        )
        assert admin_probe.status_code == 200
        assert admin_probe.json() == []

        # 排除已是该老人成员的账号
        granted = client.put(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(admin_token),
            json=[
                {"user_id": seeded_users.family.id, "relation": "creator"},
                {"user_id": first.id, "relation": "son"},
            ],
        )
        assert granted.status_code == 200
        after_grant = client.get(
            url, headers=_headers(admin_token), params={"q": tag}
        )
        assert [item["id"] for item in after_grant.json()] == [second.id]

        # SPEC 06：已关联家属成员与未关联家属都是 403
        member_token = _login(client, first.username, EXTRA_FAMILY_PASSWORD)
        member_view = client.get(
            url, headers=_headers(member_token), params={"q": tag}
        )
        assert member_view.status_code == 403
        stranger_token = _login(client, second.username, EXTRA_FAMILY_PASSWORD)
        assert (
            client.get(
                url, headers=_headers(stranger_token), params={"q": tag}
            ).status_code
            == 403
        )

        # q 边界：空串、缺失、超 32 字符均 422
        assert (
            client.get(
                url, headers=_headers(admin_token), params={"q": ""}
            ).status_code
            == 422
        )
        assert (
            client.get(url, headers=_headers(admin_token)).status_code == 422
        )
        assert (
            client.get(
                url, headers=_headers(admin_token), params={"q": "x" * 33}
            ).status_code
            == 422
        )
    finally:
        _cleanup_elders(db, [elder_id])
        _delete_user(db, first.id)
        _delete_user(db, second.id)


def test_access_candidates_limit_ten(
    client: TestClient, db, seeded_users
) -> None:
    """候选检索最多返回 10 条，且按账号 ID 升序。"""
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = _create_elder(client, admin_token, "候选上限老人")
    tag = f"limit{uuid.uuid4().hex[:6]}"
    created = [
        _create_family_user(db, display_name=f"上限候选-{tag}")
        for _ in range(12)
    ]

    try:
        response = client.get(
            f"/api/v1/elders/{elder['id']}/access/candidates",
            headers=_headers(admin_token),
            params={"q": tag},
        )
        assert response.status_code == 200
        ids = [item["id"] for item in response.json()]
        assert len(ids) == 10
        assert ids == sorted(ids)
        assert ids == sorted(user.id for user in created)[:10]
    finally:
        _cleanup_elders(db, [elder["id"]])
        for user in created:
            _delete_user(db, user.id)


def test_create_elder_phone_rules(client: TestClient, db, seeded_users) -> None:
    """SPEC 06：新建老人手机号必填、11 位格式校验、全局唯一。"""
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    phone = unique_phone()
    elder = _create_elder(client, token, "手机号校验老人", phone=phone)

    try:
        assert elder["phone"] == phone

        missing = client.post(
            "/api/v1/elders", headers=_headers(token), json={"name": "缺手机号老人"}
        )
        assert missing.status_code == 422

        for bad_phone in (
            "",
            "1380000000",
            "138000000030",
            "23800000003",
            "1380000000a",
        ):
            invalid = client.post(
                "/api/v1/elders",
                headers=_headers(token),
                json={"name": "格式错误老人", "phone": bad_phone},
            )
            assert invalid.status_code == 422, bad_phone

        duplicated = client.post(
            "/api/v1/elders",
            headers=_headers(token),
            json={"name": "重复手机号老人", "phone": phone},
        )
        assert duplicated.status_code == 409
        assert "添加老人" in duplicated.json()["detail"]

        detail = client.get(
            f"/api/v1/elders/{elder['id']}", headers=_headers(token)
        )
        assert detail.status_code == 200
        assert detail.json()["phone"] == phone
    finally:
        _cleanup_elders(db, [elder["id"]])


def test_update_elder_phone_rules(client: TestClient, db, seeded_users) -> None:
    """SPEC 06：手机号可改、不可清空、不得与其他老人重复。"""
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    first = _create_elder(client, token, "手机号更新老人甲")
    second = _create_elder(client, token, "手机号更新老人乙")
    url = f"/api/v1/elders/{first['id']}"

    try:
        new_phone = unique_phone()
        updated = client.put(
            url, headers=_headers(token), json={"phone": new_phone}
        )
        assert updated.status_code == 200
        assert updated.json()["phone"] == new_phone

        # 改成自己的手机号不算冲突
        same = client.put(
            url, headers=_headers(token), json={"phone": new_phone}
        )
        assert same.status_code == 200

        conflict = client.put(
            url, headers=_headers(token), json={"phone": second["phone"]}
        )
        assert conflict.status_code == 409
        assert "添加老人" in conflict.json()["detail"]

        # 手机号不可清空：显式 null → 422
        cleared = client.put(
            url, headers=_headers(token), json={"phone": None}
        )
        assert cleared.status_code == 422
        assert "phone 不能为 null" in cleared.text

        # 非法格式 → 422
        assert (
            client.put(
                url, headers=_headers(token), json={"phone": "12345678901"}
            ).status_code
            == 422
        )

        # 省略手机号：保持不变
        renamed = client.put(
            url, headers=_headers(token), json={"address": "手机号更新地址"}
        )
        assert renamed.status_code == 200
        assert renamed.json()["phone"] == new_phone
        assert renamed.json()["address"] == "手机号更新地址"
    finally:
        _cleanup_elders(db, [first["id"], second["id"]])


def test_add_elder_by_phone_for_family(
    client: TestClient, db, seeded_users
) -> None:
    """SPEC 06：家属凭手机号添加老人=绑定自己；未命中 404、重复绑定 409。"""
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    elder = _create_elder(client, admin_token, "手机号添加老人")
    elder_id = elder["id"]
    url = "/api/v1/elders/add-by-phone"
    session, _ = db

    try:
        # admin 创建的档案对家属不可见，需凭手机号自助添加
        listing = client.get("/api/v1/elders", headers=_headers(family_token))
        assert elder_id not in [item["id"] for item in listing.json()]

        assert client.post(url, json={"phone": elder["phone"]}).status_code == 401

        miss = client.post(
            url, headers=_headers(family_token), json={"phone": unique_phone()}
        )
        assert miss.status_code == 404
        assert "新建老人" in miss.json()["detail"]

        assert (
            client.post(
                url, headers=_headers(family_token), json={"phone": "123"}
            ).status_code
            == 422
        )
        assert (
            client.post(
                url,
                headers=_headers(family_token),
                json={"phone": elder["phone"], "extra": 1},
            ).status_code
            == 422
        )

        added = client.post(
            url, headers=_headers(family_token), json={"phone": elder["phone"]}
        )
        assert added.status_code == 200
        assert added.json()["id"] == elder_id
        assert added.json()["phone"] == elder["phone"]

        listing_after = client.get(
            "/api/v1/elders", headers=_headers(family_token)
        )
        assert elder_id in [item["id"] for item in listing_after.json()]

        session.expire_all()
        access = session.execute(
            select(ElderAccess).where(
                ElderAccess.elder_id == elder_id,
                ElderAccess.user_id == seeded_users.family.id,
            )
        ).scalar_one()
        assert access.relation is None
        actions = set(
            session.execute(
                select(AuditLog.action).where(AuditLog.target_id == elder_id)
            ).scalars()
        )
        assert "add_elder_by_phone" in actions

        again = client.post(
            url, headers=_headers(family_token), json={"phone": elder["phone"]}
        )
        assert again.status_code == 409
        assert "已与当前账号绑定" in again.json()["detail"]
    finally:
        _cleanup_elders(db, [elder_id])


def test_add_elder_by_phone_for_admin_does_not_bind(
    client: TestClient, db, seeded_users
) -> None:
    """SPEC 06：管理员按手机号添加=仅检索定位，不产生绑定、不写审计。"""
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    elder = _create_elder(client, admin_token, "管理员检索老人")
    elder_id = elder["id"]
    url = "/api/v1/elders/add-by-phone"
    session, _ = db

    try:
        found = client.post(
            url, headers=_headers(admin_token), json={"phone": elder["phone"]}
        )
        assert found.status_code == 200
        assert found.json()["id"] == elder_id

        assert (
            client.post(
                url,
                headers=_headers(admin_token),
                json={"phone": unique_phone()},
            ).status_code
            == 404
        )

        session.expire_all()
        assert (
            session.execute(
                select(ElderAccess).where(ElderAccess.elder_id == elder_id)
            ).first()
            is None
        )
        actions = set(
            session.execute(
                select(AuditLog.action).where(AuditLog.target_id == elder_id)
            ).scalars()
        )
        assert "add_elder_by_phone" not in actions
    finally:
        _cleanup_elders(db, [elder_id])


def test_family_removes_self_elder_access(
    client: TestClient, db, seeded_users
) -> None:
    """SPEC 06：家属自助解绑——解自己、允许最后一位、未绑定 404、admin 403。"""
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    # 家属创建老人：自动绑定自己，且是唯一成员
    elder = _create_elder(client, family_token, "家属自助解绑老人")
    elder_id = elder["id"]
    stranger = _create_family_user(db, display_name="未绑定家属")
    url = f"/api/v1/elders/{elder_id}/access/me"
    session, _ = db

    try:
        # admin 不能走家属自助解绑
        assert (
            client.delete(url, headers=_headers(admin_token)).status_code == 403
        )

        # 未绑定的家属 → 404
        stranger_token = _login(
            client, stranger.username, EXTRA_FAMILY_PASSWORD
        )
        assert (
            client.delete(url, headers=_headers(stranger_token)).status_code
            == 404
        )

        # 解除自己的绑定（最后一位成员，允许）
        removed = client.delete(url, headers=_headers(family_token))
        assert removed.status_code == 204
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(family_token)
            ).status_code
            == 403
        )
        listing = client.get("/api/v1/elders", headers=_headers(family_token))
        assert elder_id not in [item["id"] for item in listing.json()]

        # 老人档案仍存在（admin 可见）
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(admin_token)
            ).status_code
            == 200
        )

        # 再次解绑 → 404
        assert (
            client.delete(url, headers=_headers(family_token)).status_code
            == 404
        )

        session.expire_all()
        actions = set(
            session.execute(
                select(AuditLog.action).where(AuditLog.target_id == elder_id)
            ).scalars()
        )
        assert "remove_self_elder_access" in actions
    finally:
        _cleanup_elders(db, [elder_id])
        _delete_user(db, stranger.id)


def test_legacy_elder_without_phone_is_returned(
    client: TestClient, db, seeded_users
) -> None:
    """SPEC 06：存量档案 phone 为 NULL 时接口照常返回，值为 null。"""
    token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    session, _ = db
    elder = Elder(name=f"存量老人-{uuid.uuid4().hex[:6]}")
    session.add(elder)
    session.commit()

    try:
        detail = client.get(
            f"/api/v1/elders/{elder.id}", headers=_headers(token)
        )
        assert detail.status_code == 200
        assert detail.json()["phone"] is None

        listing = client.get("/api/v1/elders", headers=_headers(token))
        row = next(item for item in listing.json() if item["id"] == elder.id)
        assert row["phone"] is None
    finally:
        _cleanup_elders(db, [elder.id])


def test_family_self_unbind_keeps_other_members(
    client: TestClient, db, seeded_users
) -> None:
    """SPEC 06：多成员老人里家属自助解绑只删自己那一行。

    另一位成员的绑定行保留、访问权与编辑权不受影响，管理员仍能看到该成员。
    """
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    other = _create_family_user(db, display_name="同老人另一成员")
    # 家属创建老人：自动绑定自己，随后由管理员再加入另一位成员
    elder = _create_elder(client, family_token, "多成员自助解绑老人")
    elder_id = elder["id"]

    try:
        granted = client.put(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(admin_token),
            json=[
                {"user_id": seeded_users.family.id, "relation": "creator"},
                {"user_id": other.id, "relation": "son"},
            ],
        )
        assert granted.status_code == 200
        assert {item["user_id"] for item in granted.json()} == {
            seeded_users.family.id,
            other.id,
        }

        other_token = _login(client, other.username, EXTRA_FAMILY_PASSWORD)
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(other_token)
            ).status_code
            == 200
        )

        # 家属只解除自己：另一位成员的行必须保留
        removed = client.delete(
            f"/api/v1/elders/{elder_id}/access/me",
            headers=_headers(family_token),
        )
        assert removed.status_code == 204
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(family_token)
            ).status_code
            == 403
        )
        assert (
            client.delete(
                f"/api/v1/elders/{elder_id}/access/me",
                headers=_headers(family_token),
            ).status_code
            == 404
        )

        members = client.get(
            f"/api/v1/elders/{elder_id}/access", headers=_headers(admin_token)
        )
        assert members.status_code == 200
        assert [item["user_id"] for item in members.json()] == [other.id]

        # 另一位成员照常可访问、可编辑
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(other_token)
            ).status_code
            == 200
        )
        updated = client.put(
            f"/api/v1/elders/{elder_id}",
            headers=_headers(other_token),
            json={"address": "多成员自助解绑地址"},
        )
        assert updated.status_code == 200
        assert updated.json()["address"] == "多成员自助解绑地址"
    finally:
        _cleanup_elders(db, [elder_id])
        _delete_user(db, other.id)
