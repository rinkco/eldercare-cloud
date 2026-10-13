"""老人数据访问范围校验（admin 全部可见，family 仅可见关联老人）。

SPEC 04 起家属成员不再区分 owner / member：只要存在关联即可查看与维护，
因此只需要"可见性"校验，不再有成员角色门控。
"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Elder, ElderAccess, User


def get_elder_for_user(
    db: Session, user: User, elder_id: int, *, for_update: bool = False
) -> Elder:
    """按角色返回可见老人；不存在 404，越权 403。

    family 成员之间权限一致：建立关联即可查看与维护该老人；
    for_update=True 时对老人行加锁，供"整体替换"类写操作串行化使用。
    """
    if user.role not in ("admin", "family"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")

    if for_update:
        elder = db.execute(
            select(Elder).where(Elder.id == elder_id).with_for_update()
        ).scalar_one_or_none()
    else:
        elder = db.get(Elder, elder_id)
    if elder is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="老人档案不存在"
        )

    if user.role == "admin":
        return elder

    linked = db.execute(
        select(ElderAccess.id).where(
            ElderAccess.elder_id == elder_id,
            ElderAccess.user_id == user.id,
        )
    ).first()
    if linked is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该老人档案"
        )
    return elder
