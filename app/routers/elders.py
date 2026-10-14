"""老人档案与紧急联系人接口。"""

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access import get_elder_for_user
from app.audit import write_audit
from app.db import get_db
from app.deps import get_current_user, require_roles
from app.models import Device, Elder, ElderAccess, ElderContact, User
from app.schemas import (
    AccessCandidateOut,
    AccessMemberIn,
    AccessMemberOut,
    AddElderByPhoneIn,
    ContactIn,
    ContactOut,
    DeviceOut,
    ElderCreate,
    ElderOut,
    ElderUpdate,
)

router = APIRouter(prefix="/api/v1/elders", tags=["老人档案"])

# 候选家属检索最多返回的条数
CANDIDATE_LIMIT = 10
# 手机号重复（SPEC 06）：提示改用「添加老人」绑定已有档案
PHONE_CONFLICT_DETAIL = "该手机号已存在老人档案，请改用「添加老人」"


def _client_ip(request) -> str | None:
    return request.client.host if request.client else None


def _escape_like(value: str) -> str:
    """转义 LIKE 通配符，让关键字按字面量做包含匹配。"""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _find_elder_by_phone(db: Session, phone: str) -> Elder | None:
    """按手机号精确查找老人档案（SPEC 06 里手机号即老人身份标识）。"""
    return db.execute(
        select(Elder).where(Elder.phone == phone)
    ).scalar_one_or_none()


def _phone_conflict_exists(
    db: Session, phone: str, *, exclude_elder_id: int | None = None
) -> bool:
    """回查手机号是否已被其他老人占用（供 IntegrityError 兜底判定真因）。"""
    query = select(Elder.id).where(Elder.phone == phone)
    if exclude_elder_id is not None:
        query = query.where(Elder.id != exclude_elder_id)
    return db.execute(query.limit(1)).first() is not None


def _has_access(db: Session, elder_id: int, user_id: int) -> bool:
    """账号与老人之间是否已存在绑定行。"""
    return (
        db.execute(
            select(ElderAccess.id).where(
                ElderAccess.elder_id == elder_id,
                ElderAccess.user_id == user_id,
            )
        ).first()
        is not None
    )


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
    """新建老人档案；family 创建后自动获得访问关系（手机号必填且唯一）。"""
    if _find_elder_by_phone(db, payload.phone) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=PHONE_CONFLICT_DETAIL,
        )

    elder = Elder(**payload.model_dump())
    try:
        db.add(elder)
        db.flush()

        if user.role == "family":
            db.add(
                ElderAccess(
                    elder_id=elder.id,
                    user_id=user.id,
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
    except IntegrityError as exc:
        # 并发兜底：确认确实是手机号唯一冲突才回 409，其他完整性问题照旧抛出
        # （回滚会同时撤销该老人的 ElderAccess 行与本条审计）
        db.rollback()
        if _phone_conflict_exists(db, payload.phone):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=PHONE_CONFLICT_DETAIL,
            ) from exc
        raise
    db.refresh(elder)
    return elder


@router.post(
    "/add-by-phone",
    response_model=ElderOut,
    summary="按手机号添加老人（admin / family）",
    description=(
        "按老人手机号精确检索档案：家属命中后自动绑定当前账号（不区分关系），"
        "管理员仅检索定位、不产生绑定；未命中返回 404。"
    ),
)
def add_elder_by_phone(
    payload: AddElderByPhoneIn,
    request: Request,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> Elder:
    """家属凭手机号自助绑定老人；管理员只查不绑（SPEC 06）。"""
    elder = _find_elder_by_phone(db, payload.phone)
    if elder is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到该手机号对应的老人档案，请核对或改用「新建老人」",
        )

    if user.role != "family":
        # 管理员只做检索定位：不产生绑定，也不写审计
        return elder

    # 同时绑定/解绑后 rollback 都可能让 elder 实例过期，这里固定取值
    elder_id = elder.id
    user_id = user.id

    if _has_access(db, elder_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该老人已与当前账号绑定",
        )

    db.add(ElderAccess(elder_id=elder_id, user_id=user_id, relation=None))
    write_audit(
        db,
        user_id=user_id,
        action="add_elder_by_phone",
        target_type="elder",
        target_id=elder_id,
        ip=_client_ip(request),
        detail={"phone": payload.phone},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        # 并发兜底：确认是同一账号重复绑定（uq_elder_access_elder_user）才 409
        db.rollback()
        if _has_access(db, elder_id, user_id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="该老人已与当前账号绑定",
            ) from exc
        raise
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
    elder = get_elder_for_user(db, user, elder_id, for_update=True)
    changes = payload.model_dump(exclude_unset=True)

    if changes.get("phone") is not None:
        # 手机号唯一：撞其他老人时报 409（排除自身）
        other = _find_elder_by_phone(db, changes["phone"])
        if other is not None and other.id != elder.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=PHONE_CONFLICT_DETAIL,
            )

    for field, value in changes.items():
        setattr(elder, field, value)

    write_audit(
        db,
        user_id=user.id,
        action="update_elder",
        target_type="elder",
        target_id=elder.id,
        ip=_client_ip(request),
        detail={"fields": sorted(changes)},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        # 并发兜底：只有确认是「撞其他老人的手机号」才回 409，其他问题照旧抛出
        db.rollback()
        new_phone = changes.get("phone")
        if new_phone is not None and _phone_conflict_exists(
            db, new_phone, exclude_elder_id=elder_id
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=PHONE_CONFLICT_DETAIL,
            ) from exc
        raise
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
            relation=access.relation,
        )
        for access, member in rows
    ]


@router.get(
    "/{elder_id}/access",
    response_model=list[AccessMemberOut],
    summary="监护成员列表（admin / 家属）",
)
def list_elder_access(
    elder_id: int,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[AccessMemberOut]:
    """admin 或该老人的家属成员查看监护成员。"""
    get_elder_for_user(db, user, elder_id)
    return _access_rows(db, elder_id)


@router.put(
    "/{elder_id}/access",
    response_model=list[AccessMemberOut],
    summary="整体替换监护成员（仅 admin）",
    description=(
        "整体替换：提交列表覆盖该老人全部监护成员，允许空列表（即取消全部绑定，SPEC 05）；"
        "只能关联 family 账号，成员重复返回 422。SPEC 06 起成员增删仅管理员可用，"
        "家属自助绑定请用「按手机号添加老人」，自助解绑请用解除自己绑定接口。"
    ),
)
def replace_elder_access(
    elder_id: int,
    payload: list[AccessMemberIn],
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[AccessMemberOut]:
    """管理员整体替换监护成员（允许空列表，即取消全部绑定），写审计 `update_elder_access`。"""
    elder = get_elder_for_user(db, user, elder_id, for_update=True)

    user_ids = [item.user_id for item in payload]
    if len(user_ids) != len(set(user_ids)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="监护成员不能重复",
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
        detail={"count": len(rows)},
    )
    db.commit()
    return _access_rows(db, elder_id)


@router.delete(
    "/{elder_id}/access/me",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="解除自己与老人的绑定（仅 family）",
    description=(
        "家属自助取消绑定：只删除当前账号与该老人的关联（允许解除最后一位成员），"
        "老人档案与历史数据保留，仅影响该账号的可见性。"
    ),
)
def remove_self_elder_access(
    elder_id: int,
    request: Request,
    user: User = Depends(require_roles("family")),
    db: Session = Depends(get_db),
) -> Response:
    """家属解除自己与老人的绑定，写审计 `remove_self_elder_access`。"""
    access = db.execute(
        select(ElderAccess).where(
            ElderAccess.elder_id == elder_id,
            ElderAccess.user_id == user.id,
        )
    ).scalar_one_or_none()
    if access is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="未绑定该老人"
        )

    db.delete(access)
    write_audit(
        db,
        user_id=user.id,
        action="remove_self_elder_access",
        target_type="elder",
        target_id=elder_id,
        ip=_client_ip(request),
        detail={"user_id": user.id},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{elder_id}/access/candidates",
    response_model=list[AccessCandidateOut],
    summary="候选家属账号检索（仅 admin）",
    description=(
        "管理员检索可添加的家属账号：q 必填 1-32 字符，"
        "对账号与显示名做大小写不敏感的包含匹配；仅返回全局角色为 family "
        "且尚未关联该老人的账号，按账号 ID 升序，最多 10 条。"
    ),
)
def search_access_candidates(
    elder_id: int,
    q: str = Query(
        min_length=1, max_length=32, description="账号或显示名关键字"
    ),
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[AccessCandidateOut]:
    """管理员按关键字检索候选家属账号（SPEC 06 起家属不再可检索）。"""
    get_elder_for_user(db, user, elder_id)

    pattern = f"%{_escape_like(q)}%"
    candidates = db.execute(
        select(User)
        .where(
            User.role == "family",
            or_(
                User.username.ilike(pattern, escape="\\"),
                User.display_name.ilike(pattern, escape="\\"),
            ),
            User.id.not_in(
                select(ElderAccess.user_id).where(
                    ElderAccess.elder_id == elder_id
                )
            ),
        )
        .order_by(User.id)
        .limit(CANDIDATE_LIMIT)
    ).scalars()
    return [
        AccessCandidateOut(
            id=candidate.id,
            username=candidate.username,
            display_name=candidate.display_name,
        )
        for candidate in candidates
    ]


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
