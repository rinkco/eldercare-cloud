"""电子围栏读写接口（admin / family，仅可见范围）。"""

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.access import get_elder_for_user
from app.audit import write_audit
from app.db import get_db
from app.deps import require_roles
from app.models import Geofence, User
from app.schemas import GeofenceIn, GeofenceOut

router = APIRouter(prefix="/api/v1/geofences", tags=["电子围栏"])


@router.get(
    "/{elder_id}",
    response_model=list[GeofenceOut],
    summary="围栏列表（admin / family）",
)
def list_geofences(
    elder_id: int,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[Geofence]:
    get_elder_for_user(db, user, elder_id)
    return list(
        db.execute(
            select(Geofence)
            .where(Geofence.elder_id == elder_id)
            .order_by(Geofence.id)
        ).scalars()
    )


@router.put(
    "/{elder_id}",
    response_model=list[GeofenceOut],
    summary="整体替换围栏（admin / family）",
    description="整体替换：提交列表覆盖该老人全部围栏，空数组表示清空。",
)
def replace_geofences(
    elder_id: int,
    payload: list[GeofenceIn],
    request: Request,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[Geofence]:
    elder = get_elder_for_user(db, user, elder_id, for_update=True)

    db.execute(delete(Geofence).where(Geofence.elder_id == elder_id))
    fences = [
        Geofence(elder_id=elder_id, **item.model_dump()) for item in payload
    ]
    db.add_all(fences)
    # 提交前 flush 取回主键；SessionLocal 配置了 expire_on_commit=False，
    # 提交后对象属性仍可读，无需逐条 refresh（避免 N+1 与并发删除导致的 500）
    db.flush()

    write_audit(
        db,
        user_id=user.id,
        action="update_geofences",
        target_type="elder",
        target_id=elder.id,
        ip=request.client.host if request.client else None,
        detail={"count": len(fences)},
    )
    db.commit()
    return fences
