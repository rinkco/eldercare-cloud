"""账号管理接口（临时验收端点）。

GET /api/v1/users 不在 SPEC 01 冻结的 REST 表中，是为了完成
「family 访问管理接口返回 403」这一验收项而提供的最小管理员端点，
后续账号管理正式化时应并入规格并考虑字段裁剪与分页。
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_roles
from app.models import User
from app.schemas import UserOut

router = APIRouter(prefix="/api/v1/users", tags=["用户管理"])


@router.get(
    "",
    response_model=list[UserOut],
    summary="用户列表（仅 admin，临时验收端点）",
)
def list_users(
    _: User = Depends(require_roles("admin")), db: Session = Depends(get_db)
) -> list[User]:
    """管理员查看全部账号。"""
    return list(db.execute(select(User).order_by(User.id)).scalars())
