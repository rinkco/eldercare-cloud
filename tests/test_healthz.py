"""SPEC 01 步骤 1-2：健康检查与就绪探针测试。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.db import get_db
from app.main import app


def test_healthz_returns_ok() -> None:
    client = TestClient(app)

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


class _FakeResult:
    def __init__(self, value: object = None) -> None:
        self._value = value

    def scalar_one_or_none(self) -> object:
        return self._value


class _FakeSession:
    def __init__(
        self,
        error: Exception | None = None,
        revision: str | None = None,
        revision_error: Exception | None = None,
    ) -> None:
        self._error = error
        self._revision = revision
        self._revision_error = revision_error

    def execute(self, statement: object) -> _FakeResult:
        if self._error is not None:
            raise self._error
        if "alembic_version" in str(statement):
            if self._revision_error is not None:
                raise self._revision_error
            return _FakeResult(self._revision)
        return _FakeResult(1)


@pytest.fixture(autouse=True)
def _clear_dependency_overrides() -> None:
    yield
    app.dependency_overrides.clear()


def test_readyz_ok_when_database_reachable_and_migrated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.main._migration_head", lambda: "rev123")
    monkeypatch.setattr("app.main.mqtt_service.is_connected", lambda: True)
    app.dependency_overrides[get_db] = lambda: _FakeSession(revision="rev123")
    client = TestClient(app)

    response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "database": "ok",
        "migration": "ok",
        "mqtt": "ok",
    }


def test_readyz_returns_503_when_database_down() -> None:
    error = OperationalError("SELECT 1", {}, Exception("connection refused"))
    app.dependency_overrides[get_db] = lambda: _FakeSession(error=error)
    client = TestClient(app)

    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json() == {
        "status": "unavailable",
        "database": "down",
        "migration": "unknown",
        "mqtt": "unknown",
    }


def test_readyz_returns_503_when_migration_not_applied(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.main._migration_head", lambda: "rev123")
    app.dependency_overrides[get_db] = lambda: _FakeSession(revision=None)
    client = TestClient(app)

    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json() == {
        "status": "unavailable",
        "database": "ok",
        "migration": "pending",
        "mqtt": "unknown",
    }


def test_readyz_returns_503_when_migration_behind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.main._migration_head", lambda: "rev123")
    app.dependency_overrides[get_db] = lambda: _FakeSession(revision="old456")
    client = TestClient(app)

    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["migration"] == "pending"


def test_readyz_returns_503_when_mqtt_disconnected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.main._migration_head", lambda: "rev123")
    monkeypatch.setattr("app.main.mqtt_service.is_connected", lambda: False)
    app.dependency_overrides[get_db] = lambda: _FakeSession(revision="rev123")
    client = TestClient(app)

    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json() == {
        "status": "unavailable",
        "database": "ok",
        "migration": "ok",
        "mqtt": "down",
    }
