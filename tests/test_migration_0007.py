"""SPEC 06：迁移 0007 为 elders 增加手机号（可空 + 唯一索引）的回归测试。

在临时数据库中先升级到 0006，插入无手机号的存量老人，再升级到 head
校验列、唯一索引与存量 NULL 保留；随后回滚验证 downgrade 可用。
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


def _elder_columns(connection: psycopg.Connection) -> set[str]:
    return {
        row[0]
        for row in connection.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'elders'"
        ).fetchall()
    }


def _elder_indexes(connection: psycopg.Connection) -> dict[str, str]:
    return {
        name: definition
        for name, definition in connection.execute(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE tablename = 'elders'"
        ).fetchall()
    }


@pytest.fixture
def migration_database(monkeypatch, database_available) -> Iterator[str]:
    """创建临时数据库供迁移测试使用，并用 monkeypatch 恢复 Alembic 环境变量。"""
    if not database_available:
        pytest.skip("数据库不可用，跳过迁移回归测试")

    database = f"eldercare_mig7_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(_dsn("postgres"), autocommit=True) as admin:
        admin.execute(f'CREATE DATABASE "{database}"')

    monkeypatch.setenv("ALEMBIC_DATABASE_URL", _sqlalchemy_url(database))
    try:
        yield database
    finally:
        with psycopg.connect(_dsn("postgres"), autocommit=True) as admin:
            admin.execute(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')


def test_elder_phone_migration(migration_database) -> None:
    config = Config("alembic.ini")
    command.upgrade(config, "0006_drop_elder_access_role")

    # 迁移前的存量档案没有手机号
    with psycopg.connect(_dsn(migration_database)) as connection:
        assert "phone" not in _elder_columns(connection)
        connection.execute(
            "INSERT INTO elders (name) VALUES ('存量老人甲'), ('存量老人乙')"
        )
        connection.commit()

    command.upgrade(config, "head")

    with psycopg.connect(_dsn(migration_database)) as connection:
        assert "phone" in _elder_columns(connection)

        # 存量行保持 NULL（可空列兼容历史数据）
        phones = dict(
            connection.execute("SELECT name, phone FROM elders").fetchall()
        )
        assert phones == {"存量老人甲": None, "存量老人乙": None}

        # 唯一索引存在，且多个 NULL 不互相冲突
        indexes = _elder_indexes(connection)
        assert "uq_elders_phone" in indexes
        assert "UNIQUE" in indexes["uq_elders_phone"].upper()

        connection.execute(
            "INSERT INTO elders (name, phone) "
            "VALUES ('有手机号老人甲', '13800000003'), "
            "('有手机号老人乙', '13800000004')"
        )
        connection.commit()

        with pytest.raises(psycopg.errors.UniqueViolation):
            connection.execute(
                "INSERT INTO elders (name, phone) "
                "VALUES ('重复手机号老人', '13800000003')"
            )

    # downgrade：删除唯一索引与手机号列
    command.downgrade(config, "0006_drop_elder_access_role")
    with psycopg.connect(_dsn(migration_database)) as connection:
        assert "phone" not in _elder_columns(connection)
        assert "uq_elders_phone" not in _elder_indexes(connection)
