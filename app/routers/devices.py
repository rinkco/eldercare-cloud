"""设备注册、列表与绑定接口（仅 admin）。"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.db import get_db
from app.deps import require_roles
from app.models import Device, Elder, User
from app.schemas import DeviceBind, DeviceCreate, DeviceOut

router = APIRouter(prefix="/api/v1/devices", tags=["设备管理"])


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get("", response_model=list[DeviceOut], summary="设备列表（仅 admin）")
def list_devices(
    _: User = Depends(require_roles("admin")), db: Session = Depends(get_db)
) -> list[Device]:
    return list(db.execute(select(Device).order_by(Device.id)).scalars())


@router.post(
    "",
    response_model=DeviceOut,
    status_code=status.HTTP_201_CREATED,
    summary="注册设备（仅 admin）",
)
def create_device(
    payload: DeviceCreate,
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> Device:
    exists = db.execute(
        select(Device.id).where(Device.device_uid == payload.device_uid)
    ).first()
    if exists is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="设备 UID 已存在"
        )

    device = Device(**payload.model_dump())
    db.add(device)
    try:
        db.flush()
    except IntegrityError as exc:
        # 并发注册同一 UID 时，以数据库唯一约束为最终裁决
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="设备 UID 已存在"
        ) from exc

    write_audit(
        db,
        user_id=user.id,
        action="create_device",
        target_type="device",
        target_id=device.id,
        ip=_client_ip(request),
        detail={"device_uid": device.device_uid, "kind": device.kind},
    )
    db.commit()
    db.refresh(device)
    return device


@router.post(
    "/{device_id}/bind",
    response_model=DeviceOut,
    summary="绑定设备到老人（仅 admin）",
    description="一台设备同一时刻只能绑定一位老人；重复绑定或绑定已占用设备返回 409。",
)
def bind_device(
    device_id: int,
    payload: DeviceBind,
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> Device:
    # 统一锁顺序：先锁 Elder、再锁 Device，避免与「删除老人」（同样先
    # Elder 后 Device）并发时形成循环等待。
    elder = db.execute(
        select(Elder).where(Elder.id == payload.elder_id).with_for_update()
    ).scalar_one_or_none()
    if elder is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="老人档案不存在"
        )

    # 行锁保证并发绑定只有一个请求能成功
    device = db.execute(
        select(Device).where(Device.id == device_id).with_for_update()
    ).scalar_one_or_none()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="设备不存在"
        )
    if device.status == "disabled":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="设备已停用，无法绑定"
        )
    if device.elder_id == payload.elder_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="设备已绑定该老人，请勿重复绑定",
        )
    if device.elder_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="设备已被其他老人占用",
        )

    device.elder_id = payload.elder_id
    device.bound_at = datetime.now(timezone.utc)

    write_audit(
        db,
        user_id=user.id,
        action="bind_device",
        target_type="device",
        target_id=device.id,
        ip=_client_ip(request),
        detail={"device_uid": device.device_uid, "elder_id": payload.elder_id},
    )
    db.commit()
    db.refresh(device)
    return device


@router.post(
    "/{device_id}/unbind",
    response_model=DeviceOut,
    summary="解绑设备（仅 admin）",
    description=(
        "把设备从当前老人解绑并清空 bound_at；未绑定设备返回 409。"
        "解绑后设备仍保留历史遥测与事件，新的上行消息按未绑定丢弃。"
    ),
)
def unbind_device(
    device_id: int,
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> Device:
    device = db.execute(
        select(Device).where(Device.id == device_id).with_for_update()
    ).scalar_one_or_none()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="设备不存在"
        )
    if device.elder_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="设备未绑定老人"
        )

    previous_elder_id = device.elder_id
    device.elder_id = None
    device.bound_at = None

    write_audit(
        db,
        user_id=user.id,
        action="unbind_device",
        target_type="device",
        target_id=device.id,
        ip=_client_ip(request),
        detail={
            "device_uid": device.device_uid,
            "elder_id": previous_elder_id,
            "reason": "manual",
        },
    )
    db.commit()
    db.refresh(device)
    return device
