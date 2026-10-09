"""SPEC 02：迁移 0003 存量 elder 账号并入 family 的回归测试。

在临时数据库中先升级到 0002，插入历史 elder 账号，再升级到 head 校验数据转换。
宿主无数据库时自动跳过。
"""

import uuid
from collections.abc import Iterator
from urllib.parse import quote_plus

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.config import settings
from app.db import get_db
from app.main import app
from app.security import hash_password


def _dsn(database: str) -> str:
    return (
        f"host={settings.postgres_host} port={settings.postgres_port} "
        f"user={settings.postgres_user} password={settings.postgres_password} "
        f"dbname={database}"
    )


def _sqlalchemy_url(database: str) -> str:
    user = quote_plus(settings.postgres_user)
    password = quote_plus(settings.postgres_password)
    return (
        f"postgresql+psycopg://{user}:{password}"
        f"@{settings.postgres_host}:{settings.postgres_port}/{database}"
    )


@pytest.fixture
def migration_database(monkeypatch, database_available) -> Iterator[str]:
    """创建临时数据库供迁移测试使用，并用 monkeypatch 恢复 Alembic 环境变量。"""
    if not database_available:
        pytest.skip("数据库不可用，跳过迁移回归测试")

    database = f"eldercare_mig_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(_dsn("postgres"), autocommit=True) as admin:
        admin.execute(f'CREATE DATABASE "{database}"')

    monkeypatch.setenv("ALEMBIC_DATABASE_URL", _sqlalchemy_url(database))
    try:
        yield database
    finally:
        with psycopg.connect(_dsn("postgres"), autocommit=True) as admin:
            admin.execute(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')


def test_existing_elder_user_is_migrated_to_family(migration_database) -> None:
    config = Config("alembic.ini")
    command.upgrade(config, "0002_device_uid_format")

    with psycopg.connect(_dsn(migration_database)) as connection:
        connection.execute(
            "INSERT INTO users (username, password_hash, role) "
            "VALUES ('legacy-elder', 'x', 'elder')"
        )
        connection.commit()

    command.upgrade(config, "head")

    with psycopg.connect(_dsn(migration_database)) as connection:
        role = connection.execute(
            "SELECT role FROM users WHERE username = 'legacy-elder'"
        ).fetchone()[0]
        assert role == "family"

        constraint = connection.execute(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conname = 'ck_users_role'"
        ).fetchone()[0]
        assert "elder" not in constraint
        assert "family" in constraint

        index_names = {
            row[0]
            for row in connection.execute(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = 'public'"
            ).fetchall()
        }
        assert "ix_elder_access_user_id" in index_names

        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "INSERT INTO users (username, password_hash, role) "
                "VALUES ('new-elder', 'x', 'elder')"
            )


def test_migrated_elder_can_login_and_sees_no_elders(migration_database) -> None:
    """规格验收项：历史 elder 迁移为 family 后可登录，且无关联时看不到老人数据。"""
    password = "legacy-pass-123"
    config = Config("alembic.ini")
    command.upgrade(config, "0002_device_uid_format")

    with psycopg.connect(_dsn(migration_database)) as connection:
        connection.execute(
            "INSERT INTO users (username, password_hash, role) "
            "VALUES ('legacy-login', %s, 'elder')",
            (hash_password(password),),
        )
        # 库里存在老人数据，但该账号没有任何 elder_access 关联
        connection.execute("INSERT INTO elders (name) VALUES ('历史老人')")
        connection.commit()

    command.upgrade(config, "head")

    with psycopg.connect(_dsn(migration_database)) as connection:
        role = connection.execute(
            "SELECT role FROM users WHERE username = 'legacy-login'"
        ).fetchone()[0]
        assert role == "family"

    # 走应用自身的登录与列表接口：把 get_db 指向临时库
    engine = create_engine(
        _sqlalchemy_url(migration_database), poolclass=NullPool
    )
    testing_session = sessionmaker(
        bind=engine, autoflush=False, expire_on_commit=False
    )

    def override_get_db():
        session = testing_session()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "legacy-login", "password": password},
        )
        assert login.status_code == 200
        assert login.json()["role"] == "family"

        elders = client.get(
            "/api/v1/elders",
            headers={
                "Authorization": f"Bearer {login.json()['access_token']}"
            },
        )
        assert elders.status_code == 200
        assert elders.json() == []
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()
