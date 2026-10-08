"""时间参数校验工具。"""

from datetime import datetime, timezone

from fastapi import HTTPException, status


def ensure_utc(value: datetime | None, name: str) -> datetime | None:
    """拒绝无时区时间，并把带时区时间统一转换为 UTC。"""
    if value is None:
        return None
    if value.tzinfo is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{name} 必须带时区（例如 Z 或 +08:00）",
        )
    return value.astimezone(timezone.utc)
