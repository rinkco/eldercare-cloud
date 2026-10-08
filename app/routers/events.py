"""事件查询、告警查询与告警确认接口。"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import get_elder_for_user
from app.audit import write_audit
from app.db import get_db
from app.deps import require_roles
from app.models import Alert, ElderAccess, Event, User
from app.schemas import AlertOut, EventOut
from app.timeutils import ensure_utc

router = APIRouter(prefix="/api/v1", tags=["事件与告警"])


def _alert_out(alert: Alert, event: Event) -> AlertOut:
    return AlertOut(
        id=alert.id,
        event_id=alert.event_id,
        elder_id=alert.elder_id,
        status=alert.status,
        created_at=alert.created_at,
        handled_at=alert.handled_at,
        handled_by=alert.handled_by,
        event_type=event.type,
        severity=event.severity,
    )


@router.get("/events", response_model=list[EventOut], summary="事件查询")
def list_events(
    elder_id: int | None = None,
    event_type: str | None = Query(default=None, alias="type"),
    event_status: str | None = Query(default=None, alias="status"),
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[Event]:
    statement = select(Event)
    if user.role == "family":
        statement = statement.join(
            ElderAccess, ElderAccess.elder_id == Event.elder_id
        ).where(ElderAccess.user_id == user.id)
    if elder_id is not None:
        statement = statement.where(Event.elder_id == elder_id)
    start = ensure_utc(start, "start")
    end = ensure_utc(end, "end")
    if event_type is not None:
        statement = statement.where(Event.type == event_type)
    if event_status is not None:
        statement = statement.where(Event.status == event_status)
    if start is not None:
        statement = statement.where(Event.occurred_at >= start)
    if end is not None:
        statement = statement.where(Event.occurred_at <= end)
    statement = statement.order_by(
        Event.occurred_at.desc(), Event.id.desc()
    ).limit(limit)
    return list(db.execute(statement).scalars())


@router.get("/alerts", response_model=list[AlertOut], summary="告警查询")
def list_alerts(
    elder_id: int | None = None,
    alert_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[AlertOut]:
    statement = select(Alert, Event).join(Event, Event.id == Alert.event_id)
    if user.role == "family":
        statement = statement.join(
            ElderAccess, ElderAccess.elder_id == Alert.elder_id
        ).where(ElderAccess.user_id == user.id)
    if elder_id is not None:
        statement = statement.where(Alert.elder_id == elder_id)
    if alert_status is not None:
        statement = statement.where(Alert.status == alert_status)
    statement = statement.order_by(Alert.created_at.desc(), Alert.id.desc()).limit(
        limit
    )
    return [
        _alert_out(alert, event) for alert, event in db.execute(statement).all()
    ]


@router.post(
    "/alerts/{alert_id}/ack",
    response_model=AlertOut,
    summary="告警确认（admin / family）",
    description=(
        "把告警从 new 置为 handled 并记录处理人；重复确认幂等。"
        "events 表是原始事件记录，不随告警确认变更状态。"
    ),
)
def acknowledge_alert(
    alert_id: int,
    request: Request,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> AlertOut:
    # 行锁保证并发确认只有一个请求完成状态转换与审计
    alert = db.execute(
        select(Alert).where(Alert.id == alert_id).with_for_update()
    ).scalar_one_or_none()
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="告警不存在"
        )
    # family 只能确认与自己关联老人的告警
    get_elder_for_user(db, user, alert.elder_id)

    if alert.status == "new":
        alert.status = "handled"
        alert.handled_at = datetime.now(timezone.utc)
        alert.handled_by = user.id
        write_audit(
            db,
            user_id=user.id,
            action="ack_alert",
            target_type="alert",
            target_id=alert.id,
            ip=request.client.host if request.client else None,
            detail={"event_id": alert.event_id},
        )
        db.commit()
        db.refresh(alert)

    event = db.get(Event, alert.event_id)
    return _alert_out(alert, event)
