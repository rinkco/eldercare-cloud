"""共享测试夹具：真实数据库会话与测试账号。"""

import uuid
from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.exc import OperationalError

from app.db import SessionLocal, engine
from app.main import app
from app.models import AuditLog, User
from app.security import hash_password

ADMIN_PASSWORD = "admin-pass-123"
FAMILY_PASSWORD = "family-pass-123"
ELDER_PASSWORD = "elder-pass-123"


@dataclass
class TestUsers:
    admin: User
    family: User
    elder: User
    admin_password: str
    family_password: str
    elder_password: str


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="session")
def database_available() -> bool:
    try:
        with engine.connect():
            return True
    except OperationalError:
        return False


@pytest.fixture
def db(database_available: bool) -> Iterator:
    if not database_available:
        pytest.skip("数据库不可用，跳过数据库集成测试")

    session = SessionLocal()
    created_ids: list[int] = []
    try:
        yield session, created_ids
    finally:
        if created_ids:
            session.execute(delete(AuditLog).where(AuditLog.user_id.in_(created_ids)))
            session.execute(delete(User).where(User.id.in_(created_ids)))
            session.commit()
        session.close()


@pytest.fixture
def seeded_users(db) -> TestUsers:
    session, created_ids = db
    suffix = uuid.uuid4().hex[:8]
    admin = User(
        username=f"t-admin-{suffix}",
        password_hash=hash_password(ADMIN_PASSWORD),
        role="admin",
        display_name="测试管理员",
    )
    family = User(
        username=f"t-family-{suffix}",
        password_hash=hash_password(FAMILY_PASSWORD),
        role="family",
        display_name="测试家属",
    )
    elder = User(
        username=f"t-elder-{suffix}",
        password_hash=hash_password(ELDER_PASSWORD),
        role="elder",
        display_name="测试老人",
    )
    session.add_all([admin, family, elder])
    session.commit()
    created_ids.extend([admin.id, family.id, elder.id])
    return TestUsers(
        admin=admin,
        family=family,
        elder=elder,
        admin_password=ADMIN_PASSWORD,
        family_password=FAMILY_PASSWORD,
        elder_password=ELDER_PASSWORD,
    )
