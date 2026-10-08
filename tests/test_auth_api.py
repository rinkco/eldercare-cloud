"""SPEC 01 步骤 3：登录、JWT 与角色权限集成测试（需要数据库）。

宿主上没有数据库时自动跳过；容器内运行 pytest 时会真实执行。
"""

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import AuditLog
from app.security import decode_access_token


def _login(client: TestClient, username: str, password: str):
    return client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )


def test_login_success_returns_jwt_and_writes_audit(
    client: TestClient, db, seeded_users
) -> None:
    admin = seeded_users.admin

    response = _login(client, admin.username, seeded_users.admin_password)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["role"] == "admin"
    assert decode_access_token(body["access_token"])["sub"] == str(admin.id)

    session, _ = db
    session.expire_all()
    audit = session.execute(
        select(AuditLog).where(
            AuditLog.user_id == admin.id, AuditLog.action == "login"
        )
    ).scalar_one_or_none()
    assert audit is not None


def test_login_with_wrong_password_returns_401_and_writes_audit(
    client: TestClient, db, seeded_users
) -> None:
    admin = seeded_users.admin

    response = _login(client, admin.username, "wrong-password")

    assert response.status_code == 401

    session, _ = db
    session.expire_all()
    audit = session.execute(
        select(AuditLog).where(
            AuditLog.user_id == admin.id, AuditLog.action == "login_failed"
        )
    ).scalar_one_or_none()
    assert audit is not None


def test_family_cannot_access_admin_endpoint(
    client: TestClient, seeded_users
) -> None:
    family = seeded_users.family
    token = _login(
        client, family.username, seeded_users.family_password
    ).json()["access_token"]

    response = client.get(
        "/api/v1/users", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 403


def test_admin_can_list_users(client: TestClient, seeded_users) -> None:
    admin = seeded_users.admin
    token = _login(
        client, admin.username, seeded_users.admin_password
    ).json()["access_token"]

    response = client.get(
        "/api/v1/users", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    usernames = [item["username"] for item in response.json()]
    assert admin.username in usernames


def test_missing_token_returns_401(client: TestClient, seeded_users) -> None:
    response = client.get("/api/v1/users")

    assert response.status_code == 401
