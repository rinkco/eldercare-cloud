"""账号管理接口：管理员查看与编辑账号。

公开注册见 ``POST /api/v1/auth/register``；本模块提供管理台的用户列表
查询与编辑（显示名 / 手机号 / 角色 / 重置密码），账号名不可修改。
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.db import get_db
from app.deps import require_roles
from app.models import Elder, ElderAccess, User
from app.schemas import UserElderOut, UserOut, UserUpdate
from app.security import hash_password

router = APIRouter(prefix="/api/v1/users", tags=["用户管理"])


@router.get(
    "",
    response_model=list[UserOut],
    summary="用户列表（仅 admin）",
)
def list_users(
    _: User = Depends(require_roles("admin")), db: Session = Depends(get_db)
) -> list[User]:
    """管理员查看全部账号。"""
    return list(db.execute(select(User).order_by(User.id)).scalars())


@router.get(
    "/{user_id}/elders",
    response_model=list[UserElderOut],
    summary="账号关联的老人（仅 admin）",
    description=(
        "用户列表「监护关系」列与抽屉的数据来源：返回该账号关联的全部老人"
        "及其成员角色，按 elder_id 升序；admin 账号通常返回空数组。"
    ),
    responses={
        403: {
            "description": "非 admin 调用",
            "content": {"application/json": {"example": {"detail": "权限不足"}}},
        },
        404: {
            "description": "用户不存在",
            "content": {
                "application/json": {"example": {"detail": "用户不存在"}}
            },
        },
    },
)
def list_user_elders(
    user_id: int,
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[UserElderOut]:
    """管理员查看某账号的监护关系（先校验 admin 权限，再校验账号存在）。"""
    exists = db.execute(select(User.id).where(User.id == user_id)).first()
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在"
        )

    rows = db.execute(
        select(
            ElderAccess.elder_id,
            Elder.name,
            ElderAccess.role,
            ElderAccess.relation,
        )
        .join(Elder, Elder.id == ElderAccess.elder_id)
        .where(ElderAccess.user_id == user_id)
        .order_by(ElderAccess.elder_id)
    ).all()
    return [
        UserElderOut(
            elder_id=elder_id, name=name, role=role, relation=relation
        )
        for elder_id, name, role, relation in rows
    ]


@router.patch(
    "/{user_id}",
    response_model=UserOut,
    summary="编辑用户（仅 admin）",
    response_description="返回更新后的账号信息",
    responses={
        400: {
            "description": "业务校验失败（例如降级系统中最后一个管理员）",
            "content": {
                "application/json": {
                    "example": {"detail": "系统需要至少保留一个管理员"}
                }
            },
        },
        404: {
            "description": "用户不存在",
            "content": {
                "application/json": {"example": {"detail": "用户不存在"}}
            },
        },
    },
)
def update_user(
    user_id: int,
    payload: UserUpdate,
    request: Request,
    current: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> User:
    """管理员编辑账号：显示名、手机号、角色与重置密码。

    账号名（username）不可修改；降级管理员时保证系统保留至少一个管理员。
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在"
        )

    changes: dict[str, object] = {}
    fields = payload.model_fields_set

    if "display_name" in fields:
        user.display_name = (payload.display_name or "").strip() or None
        changes["display_name"] = user.display_name
    if "phone" in fields:
        user.phone = (payload.phone or "").strip() or None
        changes["phone"] = user.phone

    if payload.role is not None and payload.role != user.role:
        if user.role == "admin" and payload.role != "admin":
            admin_count = db.execute(
                select(func.count())
                .select_from(User)
                .where(User.role == "admin")
            ).scalar_one()
            if admin_count <= 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="系统需要至少保留一个管理员",
                )
        user.role = payload.role
        changes["role"] = payload.role

    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
        changes["password"] = "reset"

    if changes:
        write_audit(
            db,
            user_id=current.id,
            action="user_update",
            target_type="user",
            target_id=user.id,
            ip=request.client.host if request.client else None,
            detail=changes,
        )
        db.commit()
        db.refresh(user)

    return user
