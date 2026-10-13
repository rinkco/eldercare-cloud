"""SPEC 04：迁移 0006 删除 elder_access.role 的回归测试。

在临时数据库中先升级到 0005，插入带成员角色的历史监护关系，
再升级到 head 校验列删除与数据保留；随后回滚验证 downgrade 可用。
宿主无数据库时自动跳过。
"""

import uuid
from collections.abc import Iterator
from urllib.parse import quote_plus

import psycopg
import pytest
from alembic import command
from alembic.config import Config

from app.config import settings


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

    database = f"eldercare_mig6_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(_dsn("postgres"), autocommit=True) as admin:
        admin.execute(f'CREATE DATABASE "{database}"')

    monkeypatch.setenv("ALEMBIC_DATABASE_URL", _sqlalchemy_url(database))
    try:
        yield database
    finally:
        with psycopg.connect(_dsn("postgres"), autocommit=True) as admin:
            admin.execute(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')


def test_drop_elder_access_role_migration(migration_database) -> None:
    config = Config("alembic.ini")
    command.upgrade(config, "0005_lora_support")

    with psycopg.connect(_dsn(migration_database)) as connection:
        connection.execute(
            "INSERT INTO users (username, password_hash, role) "
            "VALUES ('mig6-owner', 'x', 'family'), ('mig6-member', 'x', 'family')"
        )
        connection.execute("INSERT INTO elders (name) VALUES ('迁移老人')")
        connection.execute(
            "INSERT INTO elder_access (elder_id, user_id, role, relation) "
            "SELECT e.id, u.id, 'owner', 'son' FROM elders e, users u "
            "WHERE e.name = '迁移老人' AND u.username = 'mig6-owner'"
        )
        connection.execute(
            "INSERT INTO elder_access (elder_id, user_id, role, relation) "
            "SELECT e.id, u.id, 'member', NULL FROM elders e, users u "
            "WHERE e.name = '迁移老人' AND u.username = 'mig6-member'"
        )
        connection.commit()

    command.upgrade(config, "head")

    with psycopg.connect(_dsn(migration_database)) as connection:
        columns = {
            row[0]
            for row in connection.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'elder_access'"
            ).fetchall()
        }
        assert "role" not in columns

        constraints = {
            row[0]
            for row in connection.execute(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid = 'elder_access'::regclass"
            ).fetchall()
        }
        assert "ck_elder_access_role" not in constraints

        rows = connection.execute(
            "SELECT u.username, a.relation FROM elder_access a "
            "JOIN users u ON u.id = a.user_id ORDER BY u.username"
        ).fetchall()
        assert rows == [("mig6-member", None), ("mig6-owner", "son")]

    # downgrade：恢复角色列并按 0004 的回填策略写入 owner
    command.downgrade(config, "0005_lora_support")
    with psycopg.connect(_dsn(migration_database)) as connection:
        roles = connection.execute(
            "SELECT DISTINCT role FROM elder_access"
        ).fetchall()
        assert roles == [("owner",)]
