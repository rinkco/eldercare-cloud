"""种子演示数据（可重复执行，幂等）。

用法：
    docker compose exec backend python -m scripts.seed

账号默认值可用环境变量覆盖：
    SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD
    SEED_FAMILY_USERNAME / SEED_FAMILY_PASSWORD
    SEED_TEST_USERNAME / SEED_TEST_PASSWORD（测试账号，随演示老人一起授权）
    SEED_GUEST_USERNAME / SEED_GUEST_PASSWORD
        （未关联任何老人的候选家属账号，重跑时清除其历史关联）

SPEC 04 起家属成员不区分角色，脚本会删除主照护者时代的旧演示账号
family-owner（若存在）。
"""

import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import (
    Device,
    Elder,
    ElderAccess,
    ElderContact,
    Geofence,
    Telemetry,
    User,
)
from app.security import hash_password

ADMIN_USERNAME = os.getenv("SEED_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("SEED_ADMIN_PASSWORD", "admin123456")
FAMILY_USERNAME = os.getenv("SEED_FAMILY_USERNAME", "family")
FAMILY_PASSWORD = os.getenv("SEED_FAMILY_PASSWORD", "family123456")
TEST_USERNAME = os.getenv("SEED_TEST_USERNAME", "laowang")
TEST_PASSWORD = os.getenv("SEED_TEST_PASSWORD", "123456")
GUEST_USERNAME = os.getenv("SEED_GUEST_USERNAME", "family-guest")
GUEST_PASSWORD = os.getenv("SEED_GUEST_PASSWORD", "guest123456")
# 主照护者（owner）时代的旧演示账号：SPEC 04 取消成员角色后不再使用
LEGACY_OWNER_USERNAME = "family-owner"
DEMO_ELDER_NAME = "演示老人-张奶奶"
DEMO_DEVICE_UID = "esp32-demo-0001"


def _get_or_create_user(
    db: Session, username: str, password: str, role: str, display_name: str
) -> User:
    user = db.execute(
        select(User).where(User.username == username)
    ).scalar_one_or_none()
    if user is not None:
        # 收敛到配置状态：脚本打印的口令必须真实可用
        user.role = role
        user.display_name = display_name
        user.password_hash = hash_password(password)
        return user
    user = User(
        username=username,
        password_hash=hash_password(password),
        role=role,
        display_name=display_name,
    )
    db.add(user)
    db.flush()
    return user


def _get_or_create_elder(db: Session) -> Elder:
    elder = db.execute(
        select(Elder).where(Elder.name == DEMO_ELDER_NAME)
    ).scalar_one_or_none()
    if elder is not None:
        return elder
    elder = Elder(
        name=DEMO_ELDER_NAME,
        gender="female",
        height_cm=158,
        weight_kg=56,
        address="上海市浦东新区演示路 1 号",
        notes="课设演示数据",
    )
    db.add(elder)
    db.flush()
    return elder


def _ensure_access(
    db: Session, elder: Elder, user: User, relation: str | None
) -> None:
    """显式写入老人-账号监护关系；重复执行时把 relation 收敛为配置值。"""
    access = db.execute(
        select(ElderAccess).where(
            ElderAccess.elder_id == elder.id,
            ElderAccess.user_id == user.id,
        )
    ).scalar_one_or_none()
    if access is None:
        db.add(
            ElderAccess(
                elder_id=elder.id,
                user_id=user.id,
                relation=relation,
            )
        )
        return
    access.relation = relation


def _remove_legacy_owner(db: Session) -> bool:
    """删除主照护者（owner）时代的旧演示账号及其全部关联。"""
    user = db.execute(
        select(User).where(User.username == LEGACY_OWNER_USERNAME)
    ).scalar_one_or_none()
    if user is None:
        return False
    db.execute(delete(ElderAccess).where(ElderAccess.user_id == user.id))
    db.execute(delete(User).where(User.id == user.id))
    return True


def _ensure_contacts(db: Session, elder: Elder) -> None:
    demo_contacts = [
        ("张小明", "13800000001", "son", 1, True),
        ("张小红", "13800000002", "daughter", 2, False),
    ]
    for name, phone, relation, priority, is_primary in demo_contacts:
        contact = db.execute(
            select(ElderContact).where(
                ElderContact.elder_id == elder.id,
                ElderContact.name == name,
            )
        ).scalar_one_or_none()
        if contact is None:
            db.add(
                ElderContact(
                    elder_id=elder.id,
                    name=name,
                    phone=phone,
                    relation=relation,
                    priority=priority,
                    is_primary=is_primary,
                )
            )
        else:
            contact.phone = phone
            contact.relation = relation
            contact.priority = priority
            contact.is_primary = is_primary


def _ensure_geofence(db: Session, elder: Elder) -> None:
    name = "家附近围栏"
    fence = db.execute(
        select(Geofence).where(
            Geofence.elder_id == elder.id, Geofence.name == name
        )
    ).scalar_one_or_none()
    if fence is None:
        db.add(
            Geofence(
                elder_id=elder.id,
                name=name,
                center_lat=31.2304,
                center_lon=121.4737,
                radius_m=500,
            )
        )
    else:
        fence.center_lat = 31.2304
        fence.center_lon = 121.4737
        fence.radius_m = 500
        fence.enabled = True


def _ensure_device(db: Session, elder: Elder) -> Device:
    device = db.execute(
        select(Device).where(Device.device_uid == DEMO_DEVICE_UID)
    ).scalar_one_or_none()
    if device is None:
        device = Device(
            device_uid=DEMO_DEVICE_UID,
            kind="esp32",
            model="ESP32-Demo",
            status="offline",
            elder_id=elder.id,
            bound_at=datetime.now(timezone.utc),
        )
        db.add(device)
        db.flush()
    elif device.elder_id != elder.id:
        device.elder_id = elder.id
        device.bound_at = datetime.now(timezone.utc)
    return device


def _ensure_telemetry(db: Session, elder: Elder, device: Device) -> int:
    """补齐最近 24 小时确定性演示遥测（按 metric+时间点收敛）。"""
    now_hour = datetime.now(timezone.utc).replace(
        minute=0, second=0, microsecond=0
    )
    window = [now_hour - timedelta(hours=23 - index) for index in range(24)]
    existing = {
        (metric, recorded_at)
        for metric, recorded_at in db.execute(
            select(Telemetry.metric, Telemetry.recorded_at).where(
                Telemetry.elder_id == elder.id,
                Telemetry.recorded_at >= window[0],
            )
        ).all()
    }

    activities = ["walking", "resting", "sleeping"]
    rows: list[Telemetry] = []
    for index, recorded_at in enumerate(window):
        points = [
            ("heart_rate", 65 + (index * 7) % 25, None),
            ("spo2", 95 + index % 5, None),
            ("steps", 100 + (index * 13) % 300, None),
            ("activity", None, activities[index % len(activities)]),
        ]
        for metric, value_num, value_text in points:
            if (metric, recorded_at) in existing:
                continue
            rows.append(
                Telemetry(
                    device_id=device.id,
                    elder_id=elder.id,
                    metric=metric,
                    value_num=value_num,
                    value_text=value_text,
                    recorded_at=recorded_at,
                )
            )
    db.add_all(rows)
    return len(rows)


def main() -> None:
    with SessionLocal() as db:
        admin = _get_or_create_user(
            db, ADMIN_USERNAME, ADMIN_PASSWORD, "admin", "演示管理员"
        )
        family = _get_or_create_user(
            db, FAMILY_USERNAME, FAMILY_PASSWORD, "family", "演示家属"
        )
        tester = _get_or_create_user(
            db, TEST_USERNAME, TEST_PASSWORD, "family", "老王"
        )
        guest = _get_or_create_user(
            db, GUEST_USERNAME, GUEST_PASSWORD, "family", "演示候选家属"
        )
        elder = _get_or_create_elder(db)
        # 候选演示账号必须保持"未关联任何老人"：演示或 e2e 可能已把它加进老人，
        # 这里先清掉它的历史关联，再收敛下面两行（顺序保证同名配置也不会互相破坏）
        db.execute(delete(ElderAccess).where(ElderAccess.user_id == guest.id))
        # 家属成员权限一致（SPEC 04）：family 与测试账号都只建立关联，不带角色
        _ensure_access(db, elder, family, "daughter")
        _ensure_access(db, elder, tester, None)
        legacy_removed = _remove_legacy_owner(db)
        _ensure_contacts(db, elder)
        _ensure_geofence(db, elder)
        device = _ensure_device(db, elder)
        telemetry_rows = _ensure_telemetry(db, elder, device)
        db.commit()

    print("种子数据就绪：")
    print(f"  管理员：{ADMIN_USERNAME} / {ADMIN_PASSWORD}")
    print(f"  家属：{FAMILY_USERNAME} / {FAMILY_PASSWORD}")
    print(f"  测试账号：{TEST_USERNAME} / {TEST_PASSWORD}")
    print(f"  候选家属（未关联老人）：{GUEST_USERNAME} / {GUEST_PASSWORD}")
    if legacy_removed:
        print(f"  已移除旧演示账号：{LEGACY_OWNER_USERNAME}（成员角色已取消）")
    print(f"  老人：  {DEMO_ELDER_NAME}（id={elder.id}）")
    print(f"  设备：  {DEMO_DEVICE_UID}（id={device.id}）")
    print(f"  遥测：  本次新增 {telemetry_rows} 条（已存在则跳过）")
    print("提示：以上为教学演示账号，请勿用于生产环境。")


if __name__ == "__main__":
    main()
