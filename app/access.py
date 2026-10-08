"""老人数据访问范围校验（admin 全部可见，family 仅可见关联老人）。"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Elder, ElderAccess, User


def get_elder_for_user(db: Session, user: User, elder_id: int) -> Elder:
    """按角色返回可见老人；不存在 404，越权 403。"""
    if user.role not in ("admin", "family"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")

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
