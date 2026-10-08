"""审计日志写入（登录与管理员写操作）。"""

from sqlalchemy.orm import Session

from app.models import AuditLog


def write_audit(
    db: Session,
    *,
    user_id: int | None,
    action: str,
    target_type: str | None = None,
    target_id: int | None = None,
    ip: str | None = None,
    detail: dict | None = None,
) -> None:
    """把审计记录加入当前会话，由调用方统一提交。"""
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            ip=ip,
            detail_json=detail or {},
        )
    )
