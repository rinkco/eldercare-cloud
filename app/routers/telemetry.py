"""遥测查询与健康趋势聚合接口。"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.access import get_elder_for_user
from app.db import get_db
from app.deps import require_roles
from app.models import Telemetry, User
from app.schemas import (
    ActivityCount,
    MetricStats,
    TelemetryOut,
    TrendBucket,
)
from app.timeutils import ensure_utc

router = APIRouter(prefix="/api/v1/elders", tags=["遥测与趋势"])


@router.get(
    "/{elder_id}/telemetry",
    response_model=list[TelemetryOut],
    summary="遥测查询（admin / family）",
    description="开始/结束时间必须带时区；返回按 recorded_at 倒序。",
)
def list_telemetry(
    elder_id: int,
    metric: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[Telemetry]:
    get_elder_for_user(db, user, elder_id)
    start = ensure_utc(start, "start")
    end = ensure_utc(end, "end")

    statement = select(Telemetry).where(Telemetry.elder_id == elder_id)
    if metric is not None:
        statement = statement.where(Telemetry.metric == metric)
    if start is not None:
        statement = statement.where(Telemetry.recorded_at >= start)
    if end is not None:
        statement = statement.where(Telemetry.recorded_at <= end)
    statement = statement.order_by(
        Telemetry.recorded_at.desc(), Telemetry.id.desc()
    ).limit(limit)
    return list(db.execute(statement).scalars())


@router.get(
    "/{elder_id}/health-trends",
    response_model=list[TrendBucket],
    summary="健康趋势聚合（interval=hour 或 day）",
    description=(
        "按 UTC 小时/天分桶：心率与血氧返回 avg/min/max/count；"
        "steps 按区间增量求和；activity 返回采样计数（假设每台设备单主上报）。"
    ),
)
def health_trends(
    elder_id: int,
    interval: Literal["hour", "day"] = "hour",
    start: datetime | None = None,
    end: datetime | None = None,
    user: User = Depends(require_roles("admin", "family")),
    db: Session = Depends(get_db),
) -> list[TrendBucket]:
    """按小时/天聚合心率、血氧、步数与活动状态。"""
    get_elder_for_user(db, user, elder_id)
    start = ensure_utc(start, "start")
    end = ensure_utc(end, "end")

    bucket = func.date_trunc(interval, Telemetry.recorded_at).label("bucket")
    base_filters = [Telemetry.elder_id == elder_id]
    if start is not None:
        base_filters.append(Telemetry.recorded_at >= start)
    if end is not None:
        base_filters.append(Telemetry.recorded_at <= end)

    buckets: dict[datetime, TrendBucket] = {}

    def bucket_for(value: datetime) -> TrendBucket:
        return buckets.setdefault(value, TrendBucket(bucket_start=value))

    for metric in ("heart_rate", "spo2"):
        rows = db.execute(
            select(
                bucket,
                func.avg(Telemetry.value_num),
                func.min(Telemetry.value_num),
                func.max(Telemetry.value_num),
                func.count(Telemetry.value_num),
            )
            .where(
                *base_filters,
                Telemetry.metric == metric,
                Telemetry.value_num.is_not(None),
            )
            .group_by(bucket)
            .order_by(bucket)
        ).all()
        for bucket_start, avg, minimum, maximum, count in rows:
            stats = MetricStats(
                avg=float(avg),
                min=float(minimum),
                max=float(maximum),
                count=int(count),
            )
            setattr(bucket_for(bucket_start), metric, stats)

    steps_rows = db.execute(
        select(bucket, func.sum(Telemetry.value_num))
        .where(*base_filters, Telemetry.metric == "steps")
        .group_by(bucket)
        .order_by(bucket)
    ).all()
    for bucket_start, total in steps_rows:
        bucket_for(bucket_start).steps_total = float(total or 0)

    activity_rows = db.execute(
        select(bucket, Telemetry.value_text, func.count(Telemetry.id))
        .where(*base_filters, Telemetry.metric == "activity")
        .group_by(bucket, Telemetry.value_text)
        .order_by(bucket)
    ).all()
    for bucket_start, activity, count in activity_rows:
        bucket_for(bucket_start).activity.append(
            ActivityCount(activity=activity or "unknown", count=int(count))
        )

    return [buckets[key] for key in sorted(buckets)]
