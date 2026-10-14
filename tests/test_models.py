"""SPEC 01 步骤 2：数据模型元数据测试。"""

import uuid

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError, OperationalError

from app.db import engine
from app.models import Base, User

EXPECTED_TABLES = {
    "users",
    "elders",
    "elder_access",
    "elder_contacts",
    "devices",
    "telemetry",
    "events",
    "alerts",
    "notifications",
    "geofences",
    "audit_logs",
}


def test_all_spec_tables_are_defined() -> None:
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_required_indexes_are_defined() -> None:
    expected_indexes = {
        ("telemetry", "ix_telemetry_elder_metric_recorded"),
        ("events", "ix_events_elder_occurred"),
        ("notifications", "ix_notifications_alert_id"),
        ("elder_access", "ix_elder_access_user_id"),
        ("elders", "uq_elders_phone"),
    }

    actual = {
        (table.name, index.name)
        for table in Base.metadata.tables.values()
        for index in table.indexes
    }

    assert expected_indexes <= actual


def test_migrated_database_contains_all_spec_tables() -> None:
    """容器内运行时校验真实数据库；宿主无数据库时跳过。"""
    try:
        with engine.connect() as connection:
            table_names = set(inspect(connection).get_table_names())
    except OperationalError:
        pytest.skip("数据库不可用，跳过迁移集成检查")

    assert EXPECTED_TABLES <= table_names


def test_migrated_database_contains_required_indexes() -> None:
    """容器内在真实数据库上校验必需索引（含 SPEC 02 新增索引）。"""
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            actual = {
                (table, index["name"])
                for table in (
                    "telemetry",
                    "events",
                    "notifications",
                    "elder_access",
                    "elders",
                )
                for index in inspector.get_indexes(table)
            }
    except OperationalError:
        pytest.skip("数据库不可用，跳过索引集成检查")

    assert {
        ("telemetry", "ix_telemetry_elder_metric_recorded"),
        ("events", "ix_events_elder_occurred"),
        ("notifications", "ix_notifications_alert_id"),
        ("elder_access", "ix_elder_access_user_id"),
        ("elders", "uq_elders_phone"),
    } <= actual


def test_elder_access_metadata_has_no_role_column() -> None:
    """SPEC 04：成员角色取消，elder_access 模型不再有 role 列。"""
    columns = {
        column.name for column in Base.metadata.tables["elder_access"].columns
    }
    assert "role" not in columns


def test_elder_metadata_has_phone_column() -> None:
    """SPEC 06：老人档案新增手机号列，且模型声明唯一索引。"""
    elders = Base.metadata.tables["elders"]
    assert "phone" in {column.name for column in elders.columns}
    assert {
        (index.name, index.unique) for index in elders.indexes
    } == {("uq_elders_phone", True)}


def test_migrated_database_elder_access_has_no_role_column() -> None:
    """容器内在真实数据库上校验 role 列已随迁移 0006 删除。"""
    try:
        with engine.connect() as connection:
            columns = {
                column["name"]
                for column in inspect(connection).get_columns("elder_access")
            }
    except OperationalError:
        pytest.skip("数据库不可用，跳过迁移集成检查")

    assert "role" not in columns


def test_elder_role_is_rejected_by_database(db) -> None:
    """SPEC 02：角色收敛为 admin / family，elder 账号不再允许写入。"""
    session, _ = db
    session.add(
        User(
            username=f"t-invalid-{uuid.uuid4().hex[:8]}",
            password_hash="x",
            role="elder",
        )
    )

    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()
