"""SPEC 02 步骤 1：电子围栏接口集成测试。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import AuditLog, Elder, ElderAccess, Geofence


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _fence(name: str, radius: int = 500) -> dict:
    return {
        "name": name,
        "center_lat": 31.2304,
        "center_lon": 121.4737,
        "radius_m": radius,
        "enabled": True,
    }


@pytest.fixture
def geo_context(client: TestClient, db, seeded_users):
    session, _ = db
    admin_token = _login(
        client, seeded_users.admin.username, seeded_users.admin_password
    )
    family_token = _login(
        client, seeded_users.family.username, seeded_users.family_password
    )
    linked = client.post(
        "/api/v1/elders",
        headers=_headers(admin_token),
        json={"name": "围栏测试老人"},
    ).json()
    unlinked = client.post(
        "/api/v1/elders",
        headers=_headers(admin_token),
        json={"name": "围栏未关联老人"},
    ).json()
    session.add(
        ElderAccess(
            elder_id=linked["id"],
            user_id=seeded_users.family.id,
            relation="daughter",
        )
    )
    session.commit()

    yield {
        "admin_token": admin_token,
        "family_token": family_token,
        "linked": linked,
        "unlinked": unlinked,
    }

    elder_ids = [linked["id"], unlinked["id"]]
    session.execute(delete(Geofence).where(Geofence.elder_id.in_(elder_ids)))
    session.execute(
        delete(AuditLog).where(
            AuditLog.target_type == "elder",
            AuditLog.target_id.in_(elder_ids),
        )
    )
    session.execute(
        delete(ElderAccess).where(ElderAccess.elder_id.in_(elder_ids))
    )
    session.execute(delete(Elder).where(Elder.id.in_(elder_ids)))
    session.commit()


def test_geofence_replace_flow_and_audit(
    client: TestClient, db, geo_context
) -> None:
    token = geo_context["admin_token"]
    elder_id = geo_context["linked"]["id"]

    empty = client.get(
        f"/api/v1/geofences/{elder_id}", headers=_headers(token)
    )
    assert empty.status_code == 200
    assert empty.json() == []

    created = client.put(
        f"/api/v1/geofences/{elder_id}",
        headers=_headers(token),
        json=[_fence("家"), _fence("公园", radius=1200)],
    )
    assert created.status_code == 200
    assert [item["name"] for item in created.json()] == ["家", "公园"]

    listed = client.get(
        f"/api/v1/geofences/{elder_id}", headers=_headers(token)
    )
    assert len(listed.json()) == 2

    cleared = client.put(
        f"/api/v1/geofences/{elder_id}", headers=_headers(token), json=[]
    )
    assert cleared.status_code == 200
    assert cleared.json() == []
    assert (
        client.get(
            f"/api/v1/geofences/{elder_id}", headers=_headers(token)
        ).json()
        == []
    )

    session, _ = db
    session.expire_all()
    audit = session.execute(
        select(AuditLog).where(
            AuditLog.action == "update_geofences",
            AuditLog.target_type == "elder",
            AuditLog.target_id == elder_id,
        )
    ).scalars().all()
    assert len(audit) == 2


def test_geofence_validation(client: TestClient, geo_context) -> None:
    token = geo_context["admin_token"]
    elder_id = geo_context["linked"]["id"]
    url = f"/api/v1/geofences/{elder_id}"

    invalid_payloads = [
        [_fence("半径过小", radius=49)],
        [_fence("半径过大", radius=5001)],
        [{**_fence("纬度越界北"), "center_lat": 90.1}],
        [{**_fence("纬度越界南"), "center_lat": -90.1}],
        [{**_fence("经度越界东"), "center_lon": 180.1}],
        [{**_fence("经度越界西"), "center_lon": -180.1}],
        [{**_fence("空名称"), "name": ""}],
        [{**_fence("名称过长"), "name": "x" * 65}],
        [{**_fence("多余字段"), "extra": 1}],
        [{**_fence("宽松布尔-整数1"), "enabled": 1}],
        [{**_fence("宽松布尔-整数0"), "enabled": 0}],
        [{**_fence("宽松布尔-字符串"), "enabled": "false"}],
        [{**_fence("宽松布尔-null"), "enabled": None}],
    ]
    for payload in invalid_payloads:
        response = client.put(url, headers=_headers(token), json=payload)
        assert response.status_code == 422, payload


def test_geofence_radius_bounds_accepted(
    client: TestClient, geo_context
) -> None:
    token = geo_context["admin_token"]
    elder_id = geo_context["linked"]["id"]
    url = f"/api/v1/geofences/{elder_id}"

    for radius in (50, 5000):
        response = client.put(
            url,
            headers=_headers(token),
            json=[_fence(f"半径边界{radius}", radius=radius)],
        )
        assert response.status_code == 200, radius
        (item,) = response.json()
        assert item["radius_m"] == radius
        assert item["enabled"] is True


def test_geofence_missing_elder_returns_404(
    client: TestClient, geo_context
) -> None:
    token = geo_context["admin_token"]
    # 远超自增序列取值，保证该老人不存在
    missing_id = 10**12

    read = client.get(
        f"/api/v1/geofences/{missing_id}", headers=_headers(token)
    )
    write = client.put(
        f"/api/v1/geofences/{missing_id}",
        headers=_headers(token),
        json=[_fence("不存在的老人")],
    )
    assert read.status_code == 404
    assert write.status_code == 404


def test_geofence_replace_isolated_between_elders(
    client: TestClient, geo_context
) -> None:
    """整体替换老人 A 的围栏不得删除老人 B 的围栏。"""
    token = geo_context["admin_token"]
    linked_id = geo_context["linked"]["id"]
    unlinked_id = geo_context["unlinked"]["id"]

    first = client.put(
        f"/api/v1/geofences/{linked_id}",
        headers=_headers(token),
        json=[_fence("老人A-旧围栏")],
    )
    second = client.put(
        f"/api/v1/geofences/{unlinked_id}",
        headers=_headers(token),
        json=[_fence("老人B-围栏")],
    )
    assert first.status_code == 200
    assert second.status_code == 200

    replaced = client.put(
        f"/api/v1/geofences/{linked_id}",
        headers=_headers(token),
        json=[_fence("老人A-新围栏")],
    )
    assert replaced.status_code == 200

    other = client.get(
        f"/api/v1/geofences/{unlinked_id}", headers=_headers(token)
    )
    assert other.status_code == 200
    assert [item["name"] for item in other.json()] == ["老人B-围栏"]


def test_geofence_family_can_read_and_write_linked_elder(
    client: TestClient, geo_context
) -> None:
    family_token = geo_context["family_token"]
    linked_id = geo_context["linked"]["id"]
    url = f"/api/v1/geofences/{linked_id}"

    initial = client.get(url, headers=_headers(family_token))
    assert initial.status_code == 200
    assert initial.json() == []

    saved = client.put(
        url, headers=_headers(family_token), json=[_fence("家属设置的围栏")]
    )
    assert saved.status_code == 200
    assert [item["name"] for item in saved.json()] == ["家属设置的围栏"]
    assert saved.json()[0]["enabled"] is True

    listed = client.get(url, headers=_headers(family_token))
    assert listed.status_code == 200
    assert [item["name"] for item in listed.json()] == ["家属设置的围栏"]


def test_geofence_family_visibility(client: TestClient, geo_context) -> None:
    family_token = geo_context["family_token"]
    linked_id = geo_context["linked"]["id"]
    unlinked_id = geo_context["unlinked"]["id"]

    allowed = client.get(
        f"/api/v1/geofences/{linked_id}", headers=_headers(family_token)
    )
    denied_read = client.get(
        f"/api/v1/geofences/{unlinked_id}", headers=_headers(family_token)
    )
    denied_write = client.put(
        f"/api/v1/geofences/{unlinked_id}",
        headers=_headers(family_token),
        json=[_fence("越权围栏")],
    )

    assert allowed.status_code == 200
    assert denied_read.status_code == 403
    assert denied_write.status_code == 403


def test_concurrent_geofence_replace_keeps_single_snapshot(
    client: TestClient, db, geo_context
) -> None:
    """并发整体替换必须串行化：最终结果是某一次请求的完整快照，而非并集。"""
    from concurrent.futures import ThreadPoolExecutor

    from app.main import app

    token = geo_context["admin_token"]
    elder_id = geo_context["linked"]["id"]
    url = f"/api/v1/geofences/{elder_id}"
    payload_a = [_fence("A1"), _fence("A2")]
    payload_b = [_fence("B1")]

    def replace(payload: list[dict]) -> int:
        thread_client = TestClient(app)
        response = thread_client.put(url, headers=_headers(token), json=payload)
        return response.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(replace, [payload_a, payload_b]))

    assert statuses == [200, 200]
    names = [
        item["name"]
        for item in client.get(url, headers=_headers(token)).json()
    ]
    assert names in (["A1", "A2"], ["B1"])
