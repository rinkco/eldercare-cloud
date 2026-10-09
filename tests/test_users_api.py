"""账号注册与管理接口集成测试（需要数据库）。

宿主上没有数据库时自动跳过；容器内运行 pytest 时会真实执行。
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import AuditLog, User

REGISTER_PASSWORD = "register-pass-123"


@pytest.fixture
def cleanup_users(db):
    """登记测试中新建的账号，用例结束后清理审计与用户行。"""
    session, _ = db
    user_ids: list[int] = []
    yield user_ids
    if user_ids:
        session.execute(delete(AuditLog).where(AuditLog.user_id.in_(user_ids)))
        session.execute(delete(User).where(User.id.in_(user_ids)))
        session.commit()


def _register(
    client: TestClient,
    username: str,
    password: str = REGISTER_PASSWORD,
    **extra: str,
):
    return client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": password, **extra},
    )


def _login(client: TestClient, username: str, password: str):
    return client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_register_creates_family_account_and_login_works(
    client: TestClient, db, cleanup_users
) -> None:
    username = f"t-reg-{uuid.uuid4().hex[:8]}"

    response = _register(
        client, username, display_name="注册测试", phone="13800000000"
    )

    assert response.status_code == 201
    body = response.json()
    cleanup_users.append(body["id"])
    assert body["username"] == username
    assert body["role"] == "family"
    assert body["display_name"] == "注册测试"
    assert body["phone"] == "13800000000"

    login = _login(client, username, REGISTER_PASSWORD)
    assert login.status_code == 200
    assert login.json()["role"] == "family"

    session, _ = db
    session.expire_all()
    stored = session.execute(
        select(User).where(User.username == username)
    ).scalar_one()
    assert stored.password_hash != REGISTER_PASSWORD


def test_register_rejects_duplicate_username(
    client: TestClient, db, cleanup_users
) -> None:
    username = f"t-dup-{uuid.uuid4().hex[:8]}"

    first = _register(client, username)
    assert first.status_code == 201
    cleanup_users.append(first.json()["id"])

    again = _register(client, username)
    assert again.status_code == 409


def test_register_validates_payload(client: TestClient) -> None:
    suffix = uuid.uuid4().hex[:8]

    assert _register(client, "ab").status_code == 422
    assert _register(client, f"bad name {suffix}").status_code == 422
    assert (
        _register(client, f"t-short-{suffix}", password="123").status_code
        == 422
    )
    assert (
        _register(
            client, f"t-role-{suffix}", role="admin"
        ).status_code
        == 422
    )


def test_admin_can_update_user_fields_and_password(
    client: TestClient, db, seeded_users
) -> None:
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    ).json()["access_token"]
    family = seeded_users.family

    response = client.patch(
        f"/api/v1/users/{family.id}",
        headers=_bearer(admin_token),
        json={
            "display_name": "编辑后的家属",
            "phone": "13900000000",
            "role": "admin",
            "password": "new-pass-456",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == family.username
    assert body["display_name"] == "编辑后的家属"
    assert body["phone"] == "13900000000"
    assert body["role"] == "admin"

    assert _login(client, family.username, "new-pass-456").status_code == 200

    session, _ = db
    session.expire_all()
    audit = session.execute(
        select(AuditLog).where(
            AuditLog.action == "user_update",
            AuditLog.target_id == family.id,
        )
    ).scalar_one_or_none()
    assert audit is not None


def test_family_cannot_update_user(client: TestClient, seeded_users) -> None:
    token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    ).json()["access_token"]

    response = client.patch(
        f"/api/v1/users/{seeded_users.admin.id}",
        headers=_bearer(token),
        json={"display_name": "越权修改"},
    )

    assert response.status_code == 403


def test_update_unknown_user_returns_404(
    client: TestClient, seeded_users
) -> None:
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    ).json()["access_token"]

    response = client.patch(
        "/api/v1/users/999999999",
        headers=_bearer(admin_token),
        json={"display_name": "不存在"},
    )

    assert response.status_code == 404
