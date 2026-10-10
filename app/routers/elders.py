"""老人档案与紧急联系人接口。"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.access import get_elder_for_user, require_elder_role
from app.audit import write_audit
from app.db import get_db
from app.deps import get_current_user, require_roles
from app.models import Device, Elder, ElderAccess, ElderContact, User
from app.schemas import (
    AccessMemberIn,
    AccessMemberOut,
    ContactIn,
    ContactOut,
    DeviceOut,
    ElderCreate,
    ElderOut,
    ElderUpdate,
)

router = APIRouter(prefix="/api/v1/elders", tags=["老人档案"])


def _client_ip(request) -> str | None:
    return request.client.host if request.client else None


@router.get("", response_model=list[ElderOut], summary="老人列表（admin / family）")
def list_elders(
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[Elder]:
    """admin 返回全部；family 只返回已关联的老人。"""
    if user.role == "admin":
        return list(db.execute(select(Elder).order_by(Elder.id)).scalars())

    return list(
        db.execute(
            select(Elder)
            .join(ElderAccess, ElderAccess.elder_id == Elder.id)
            .where(ElderAccess.user_id == user.id)
            .order_by(Elder.id)
        ).scalars()
    )


@router.post(
    "",
    response_model=ElderOut,
    status_code=status.HTTP_201_CREATED,
    summary="新建老人（admin / family）",
)
def create_elder(
    payload: ElderCreate,
    request: Request,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> Elder:
    """新建老人档案；family 创建后自动获得访问关系。"""
    elder = Elder(**payload.model_dump())
    db.add(elder)
    db.flush()

    if user.role == "family":
        db.add(
            ElderAccess(
                elder_id=elder.id,
                user_id=user.id,
                role="owner",
                relation="creator",
            )
        )

    write_audit(
        db,
        user_id=user.id,
        action="create_elder",
        target_type="elder",
        target_id=elder.id,
        ip=_client_ip(request),
        detail={"name": elder.name},
    )
    db.commit()
    db.refresh(elder)
    return elder


@router.get("/{elder_id}", response_model=ElderOut, summary="老人详情")
def get_elder(
    elder_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Elder:
    return get_elder_for_user(db, user, elder_id)


@router.put(
    "/{elder_id}",
    response_model=ElderOut,
    summary="修改老人档案",
    description="局部更新：只更新请求中出现的字段，未出现的字段保持不变。",
)
def update_elder(
    elder_id: int,
    payload: ElderUpdate,
    request: Request,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> Elder:
    elder = require_elder_role(
        db, user, elder_id, ("admin", "owner"), for_update=True
    )
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(elder, field, value)

    write_audit(
        db,
        user_id=user.id,
        action="update_elder",
        target_type="elder",
        target_id=elder.id,
        ip=_client_ip(request),
        detail={"fields": sorted(payload.model_dump(exclude_unset=True))},
    )
    db.commit()
    db.refresh(elder)
    return elder


@router.delete(
    "/{elder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除老人档案",
)
def delete_elder(
    elder_id: int,
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> Response:
    elder = get_elder_for_user(db, user, elder_id, for_update=True)

    bound_devices = list(
        db.execute(
            select(Device)
            .where(Device.elder_id == elder.id)
            .with_for_update()
        ).scalars()
    )
    for device in bound_devices:
        device.elder_id = None
        device.bound_at = None
        write_audit(
            db,
            user_id=user.id,
            action="unbind_device",
            target_type="device",
            target_id=device.id,
            ip=_client_ip(request),
            detail={"reason": "elder_deleted", "elder_id": elder.id},
        )

    write_audit(
        db,
        user_id=user.id,
        action="delete_elder",
        target_type="elder",
        target_id=elder.id,
        ip=_client_ip(request),
        detail={"name": elder.name},
    )
    db.delete(elder)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{elder_id}/contacts",
    response_model=list[ContactOut],
    summary="紧急联系人列表",
)
def list_contacts(
    elder_id: int,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[ElderContact]:
    get_elder_for_user(db, user, elder_id)
    return list(
        db.execute(
            select(ElderContact)
            .where(ElderContact.elder_id == elder_id)
            .order_by(ElderContact.priority, ElderContact.id)
        ).scalars()
    )


@router.put(
    "/{elder_id}/contacts",
    response_model=list[ContactOut],
    summary="覆盖写入紧急联系人",
    description=(
        "整体替换：提交的列表会覆盖该老人全部紧急联系人，"
        "空数组表示清空；联系人 ID 会重新生成。最多只能有一个主联系人。"
    ),
)
def replace_contacts(
    elder_id: int,
    payload: list[ContactIn],
    request: Request,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[ElderContact]:
    """按提交的列表整体替换该老人的紧急联系人。"""
    elder = get_elder_for_user(db, user, elder_id, for_update=True)

    if sum(1 for contact in payload if contact.is_primary) > 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="最多只能有一个主联系人",
        )

    db.execute(delete(ElderContact).where(ElderContact.elder_id == elder_id))
    contacts = [
        ElderContact(elder_id=elder_id, **contact.model_dump())
        for contact in payload
    ]
    db.add_all(contacts)

    write_audit(
        db,
        user_id=user.id,
        action="update_elder_contacts",
        target_type="elder",
        target_id=elder.id,
        ip=_client_ip(request),
        detail={"count": len(contacts)},
    )
    db.commit()

    for contact in contacts:
        db.refresh(contact)
    return contacts


def _access_rows(db: Session, elder_id: int) -> list[AccessMemberOut]:
    """查询监护成员并拼上账号展示信息。"""
    rows = db.execute(
        select(ElderAccess, User)
        .join(User, User.id == ElderAccess.user_id)
        .where(ElderAccess.elder_id == elder_id)
        .order_by(ElderAccess.id)
    ).all()
    return [
        AccessMemberOut(
            id=access.id,
            user_id=access.user_id,
            username=member.username,
            display_name=member.display_name,
            role=access.role,
            relation=access.relation,
        )
        for access, member in rows
    ]


@router.get(
    "/{elder_id}/access",
    response_model=list[AccessMemberOut],
    summary="监护成员列表（admin / owner）",
)
def list_elder_access(
    elder_id: int,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[AccessMemberOut]:
    """admin 或该老人的 owner 查看监护成员。"""
    require_elder_role(db, user, elder_id, ("admin", "owner"))
    return _access_rows(db, elder_id)


@router.put(
    "/{elder_id}/access",
    response_model=list[AccessMemberOut],
    summary="整体替换监护成员（admin / owner）",
    description=(
        "整体替换：提交列表覆盖该老人全部监护成员，至少保留一位 owner；"
        "只能关联 family 账号，成员重复或缺少 owner 返回 422。"
    ),
)
def replace_elder_access(
    elder_id: int,
    payload: list[AccessMemberIn],
    request: Request,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[AccessMemberOut]:
    """admin 或 owner 整体替换监护成员，写审计 `update_elder_access`。"""
    elder = require_elder_role(
        db, user, elder_id, ("admin", "owner"), for_update=True
    )

    user_ids = [item.user_id for item in payload]
    if len(user_ids) != len(set(user_ids)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="监护成员不能重复",
        )
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="至少保留一位主照护者",
        )
    # admin 始终拥有管理权，可以只挂 member；family 操作必须保留 owner
    if user.role != "admin" and not any(
        item.role == "owner" for item in payload
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="至少保留一位主照护者",
        )

    members: dict[int, User] = {}
    if user_ids:
        members = {
            item.id: item
            for item in db.execute(
                select(User).where(User.id.in_(user_ids))
            ).scalars()
        }
    missing = [user_id for user_id in user_ids if user_id not in members]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"账号不存在：{missing[0]}",
        )
    if any(item.role != "family" for item in members.values()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="只能关联家属账号",
        )

    db.execute(delete(ElderAccess).where(ElderAccess.elder_id == elder_id))
    rows = [
        ElderAccess(
            elder_id=elder_id,
            user_id=item.user_id,
            role=item.role,
            relation=item.relation,
        )
        for item in payload
    ]
    db.add_all(rows)
    db.flush()

    write_audit(
        db,
        user_id=user.id,
        action="update_elder_access",
        target_type="elder",
        target_id=elder.id,
        ip=_client_ip(request),
        detail={
            "count": len(rows),
            "owners": sum(1 for item in payload if item.role == "owner"),
        },
    )
    db.commit()
    return _access_rows(db, elder_id)


@router.get(
    "/{elder_id}/devices",
    response_model=list[DeviceOut],
    summary="老人绑定设备（只读，admin / 家属）",
    description="家属可查看可见老人绑定的设备；注册、绑定与解绑仍仅 admin。",
)
def list_elder_devices(
    elder_id: int,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[Device]:
    get_elder_for_user(db, user, elder_id)
    return list(
        db.execute(
            select(Device).where(Device.elder_id == elder_id).order_by(Device.id)
        ).scalars()
    )
