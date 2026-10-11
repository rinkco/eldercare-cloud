"""SPEC 01 步骤 4：老人档案、访问范围与紧急联系人集成测试。"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import AuditLog, Device, Elder, ElderAccess, User
from app.security import hash_password

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


def test_elder_responses_include_my_role(
    client: TestClient, db, seeded_users
) -> None:
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    admin_elder = _create_elder(client, admin_token, "角色测试-管理员创建")
    family_elder = _create_elder(client, family_token, "角色测试-家属创建")
    elder_ids = [admin_elder["id"], family_elder["id"]]
    other = _create_family_user(db)

    try:
        # 创建者视角
        assert admin_elder["my_role"] == "admin"
        assert family_elder["my_role"] == "owner"

        # admin 列表：全部为 admin
        admin_listing = client.get("/api/v1/elders", headers=_headers(admin_token))
        assert admin_listing.status_code == 200
        admin_roles = {
            item["id"]: item["my_role"] for item in admin_listing.json()
        }
        assert admin_roles[admin_elder["id"]] == "admin"
        assert admin_roles[family_elder["id"]] == "admin"

        # family 列表：仅关联老人，角色 owner
        family_listing = client.get(
            "/api/v1/elders", headers=_headers(family_token)
        )
        assert family_listing.status_code == 200
        assert {
            item["id"]: item["my_role"] for item in family_listing.json()
        } == {family_elder["id"]: "owner"}

        # 额外家属以 member 授权后，列表与详情的角色应为 member
        granted = client.put(
            f"/api/v1/elders/{family_elder['id']}/access",
            headers=_headers(admin_token),
            json=[
                {"user_id": seeded_users.family.id, "role": "owner"},
                {"user_id": other.id, "role": "member"},
            ],
        )
        assert granted.status_code == 200
        other_token = _login(client, other.username, EXTRA_FAMILY_PASSWORD)

        other_listing = client.get(
            "/api/v1/elders", headers=_headers(other_token)
        )
        assert {
            item["id"]: item["my_role"] for item in other_listing.json()
        } == {family_elder["id"]: "member"}

        other_detail = client.get(
            f"/api/v1/elders/{family_elder['id']}", headers=_headers(other_token)
        )
        assert other_detail.status_code == 200
        assert other_detail.json()["my_role"] == "member"

        # owner 的详情与更新响应
        owner_detail = client.get(
            f"/api/v1/elders/{family_elder['id']}", headers=_headers(family_token)
        )
        assert owner_detail.json()["my_role"] == "owner"
        updated = client.put(
            f"/api/v1/elders/{family_elder['id']}",
            headers=_headers(family_token),
            json={"address": "角色测试地址"},
        )
        assert updated.status_code == 200
        assert updated.json()["my_role"] == "owner"
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


def test_access_grant_and_member_permissions(
    client: TestClient, db, seeded_users
) -> None:
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
            json=[
                {
                    "user_id": family_id,
                    "role": "member",
                    "relation": "daughter",
                }
            ],
        )
        assert granted.status_code == 200
        body = granted.json()
        assert len(body) == 1
        assert body[0]["user_id"] == family_id
        assert body[0]["username"] == seeded_users.family.username
        assert body[0]["role"] == "member"

        # member：可见，但不能改档案、不能删老人、不能查看/管理成员
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(family_token)
            ).status_code
            == 200
        )
        assert (
            client.put(
                f"/api/v1/elders/{elder_id}",
                headers=_headers(family_token),
                json={"address": "成员不应改"},
            ).status_code
            == 403
        )
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
            == 403
        )
        assert (
            client.put(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(family_token),
                json=[{"user_id": family_id, "role": "owner"}],
            ).status_code
            == 403
        )

        # 校验：至少一位 owner、成员不重复、只能关联 family 账号
        assert (
            client.put(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(admin_token),
                json=[],
            ).status_code
            == 422
        )
        assert (
            client.put(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(admin_token),
                json=[
                    {"user_id": family_id, "role": "owner"},
                    {"user_id": family_id, "role": "member"},
                ],
            ).status_code
            == 422
        )
        assert (
            client.put(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(admin_token),
                json=[{"user_id": seeded_users.admin.id, "role": "owner"}],
            ).status_code
            == 422
        )

        # 升为 owner 后可查看成员并编辑档案
        promoted = client.put(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(admin_token),
            json=[
                {
                    "user_id": family_id,
                    "role": "owner",
                    "relation": "daughter",
                }
            ],
        )
        assert promoted.status_code == 200
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}/access",
                headers=_headers(family_token),
            ).status_code
            == 200
        )
        updated = client.put(
            f"/api/v1/elders/{elder_id}",
            headers=_headers(family_token),
            json={"address": "主照护者修改地址"},
        )
        assert updated.status_code == 200
        assert updated.json()["address"] == "主照护者修改地址"

        session.expire_all()
        actions = set(
            session.execute(
                select(AuditLog.action).where(AuditLog.target_id == elder_id)
            ).scalars()
        )
        assert "update_elder_access" in actions
    finally:
        _cleanup_elders(db, [elder_id])


def test_family_owner_can_grant_and_revoke_members(
    client: TestClient, db, seeded_users
) -> None:
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    elder = _create_elder(client, family_token, "家属主照护者授权老人")
    elder_id = elder["id"]
    other = _create_family_user(db)

    try:
        members = client.get(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(family_token),
        )
        assert members.status_code == 200
        assert [item["role"] for item in members.json()] == ["owner"]

        granted = client.put(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(family_token),
            json=[
                {
                    "user_id": seeded_users.family.id,
                    "role": "owner",
                    "relation": "creator",
                },
                {"user_id": other.id, "role": "member", "relation": "son"},
            ],
        )
        assert granted.status_code == 200
        assert {item["user_id"]: item["role"] for item in granted.json()} == {
            seeded_users.family.id: "owner",
            other.id: "member",
        }

        other_token = _login(client, other.username, EXTRA_FAMILY_PASSWORD)
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(other_token)
            ).status_code
            == 200
        )

        revoked = client.put(
            f"/api/v1/elders/{elder_id}/access",
            headers=_headers(family_token),
            json=[
                {
                    "user_id": seeded_users.family.id,
                    "role": "owner",
                    "relation": "creator",
                }
            ],
        )
        assert revoked.status_code == 200
        assert (
            client.get(
                f"/api/v1/elders/{elder_id}", headers=_headers(other_token)
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
            json=[
                {
                    "user_id": seeded_users.family.id,
                    "role": "member",
                    "relation": "daughter",
                }
            ],
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
    """SPEC 03 步骤 3：候选家属检索的鉴权、匹配、排除与参数边界。"""
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
        # owner（老人创建者）按显示名包含匹配，按 ID 升序，字段只有三个
        by_name = client.get(
            url, headers=_headers(family_token), params={"q": tag}
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
                {"user_id": seeded_users.family.id, "role": "owner"},
                {"user_id": first.id, "role": "member"},
            ],
        )
        assert granted.status_code == 200
        after_grant = client.get(
            url, headers=_headers(family_token), params={"q": tag}
        )
        assert [item["id"] for item in after_grant.json()] == [second.id]

        # member 与未关联家属均 403（member 不发请求可搜；未关联家属看不到老人）
        member_token = _login(client, first.username, EXTRA_FAMILY_PASSWORD)
        assert (
            client.get(
                url, headers=_headers(member_token), params={"q": tag}
            ).status_code
            == 403
        )
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
