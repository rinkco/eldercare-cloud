"""SPEC 01 步骤 2：数据模型元数据测试。"""

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError

from app.db import engine
from app.models import Base

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
