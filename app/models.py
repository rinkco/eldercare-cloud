"""SQLAlchemy 数据模型：SPEC 01「数据模型」基线。

包含 11 张表：users / elders / elder_access / elder_contacts / devices /
telemetry / events / alerts / notifications / geofences / audit_logs。
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class User(Base):
    """账号与角色。"""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'family')", name="ck_users_role"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16))
    display_name: Mapped[str | None] = mapped_column(String(64))
    phone: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Elder(Base):
    """老人档案。"""

    __tablename__ = "elders"
    # 手机号是老人的身份标识（SPEC 06）：唯一索引兼作并发兜底
    __table_args__ = (Index("uq_elders_phone", "phone", unique=True),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    phone: Mapped[str | None] = mapped_column(String(32))
    gender: Mapped[str | None] = mapped_column(String(16))
    birth_date: Mapped[date | None] = mapped_column(Date)
    height_cm: Mapped[int | None] = mapped_column(SmallInteger)
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    address: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ElderAccess(Base):
    """账号与老人的访问关系（家属成员之间不区分权限层级）。"""

    __tablename__ = "elder_access"
    __table_args__ = (
        UniqueConstraint("elder_id", "user_id", name="uq_elder_access_elder_user"),
        Index("ix_elder_access_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    elder_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("elders.id", ondelete="CASCADE")
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE")
    )
    relation: Mapped[str | None] = mapped_column(String(32))


class ElderContact(Base):
    """紧急联系人。"""

    __tablename__ = "elder_contacts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    elder_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("elders.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(64))
    phone: Mapped[str] = mapped_column(String(32))
    relation: Mapped[str | None] = mapped_column(String(32))
    priority: Mapped[int] = mapped_column(SmallInteger, server_default=text("1"))
    is_primary: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false")
    )


class Device(Base):
    """设备注册与绑定。"""

    __tablename__ = "devices"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('esp32', 'phone', 'wearable', 'lora_node')",
            name="ck_devices_kind",
        ),
        CheckConstraint(
            "status IN ('online', 'offline', 'disabled')", name="ck_devices_status"
        ),
        CheckConstraint(
            "battery_percent IS NULL OR battery_percent BETWEEN 0 AND 100",
            name="ck_devices_battery",
        ),
        CheckConstraint(
            "device_uid ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'",
            name="ck_devices_uid_format",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    device_uid: Mapped[str] = mapped_column(String(64), unique=True)
    kind: Mapped[str] = mapped_column(String(16))
    model: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(
        String(16), server_default=text("'offline'")
    )
    elder_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("elders.id", ondelete="SET NULL")
    )
    battery_percent: Mapped[int | None] = mapped_column(SmallInteger)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bound_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Telemetry(Base):
    """降采样遥测数据。"""

    __tablename__ = "telemetry"
    __table_args__ = (
        Index(
            "ix_telemetry_elder_metric_recorded",
            "elder_id",
            "metric",
            "recorded_at",
        ),
        CheckConstraint(
            "metric IN ('heart_rate', 'spo2', 'steps', 'activity', 'gait', "
            "'location', 'battery')",
            name="ck_telemetry_metric",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    device_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("devices.id", ondelete="CASCADE")
    )
    elder_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("elders.id", ondelete="CASCADE")
    )
    metric: Mapped[str] = mapped_column(String(16))
    value_num: Mapped[float | None] = mapped_column(Float)
    value_text: Mapped[str | None] = mapped_column(Text)
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    meta_json: Mapped[dict] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb")
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Event(Base):
    """设备与规则产生的原始事件。"""

    __tablename__ = "events"
    __table_args__ = (
        Index("ix_events_elder_occurred", "elder_id", "occurred_at"),
        CheckConstraint(
            "type IN ('fall', 'sos', 'geofence_exit', 'low_battery', "
            "'device_offline')",
            name="ck_events_type",
        ),
        CheckConstraint(
            "status IN ('new', 'handled', 'closed')", name="ck_events_status"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    elder_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("elders.id", ondelete="CASCADE")
    )
    device_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("devices.id", ondelete="CASCADE")
    )
    type: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(16))
    confidence: Mapped[float | None] = mapped_column(Float)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_json: Mapped[dict] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb")
    )
    meta_json: Mapped[dict] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb")
    )
    status: Mapped[str] = mapped_column(String(16), server_default=text("'new'"))


class Alert(Base):
    """告警生命周期。"""

    __tablename__ = "alerts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('new', 'handled', 'closed')", name="ck_alerts_status"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    event_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("events.id", ondelete="CASCADE")
    )
    elder_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("elders.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(String(16), server_default=text("'new'"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    handled_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )


class Notification(Base):
    """通知模拟适配器的发送记录。"""

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_alert_id", "alert_id"),
        CheckConstraint(
            "channel IN ('sms', 'wechat', 'console')",
            name="ck_notifications_channel",
        ),
        CheckConstraint(
            "status IN ('pending', 'sent', 'failed')",
            name="ck_notifications_status",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    alert_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("alerts.id", ondelete="CASCADE")
    )
    contact_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("elder_contacts.id", ondelete="SET NULL")
    )
    channel: Mapped[str] = mapped_column(
        String(16), server_default=text("'console'")
    )
    target: Mapped[str | None] = mapped_column(String(128))
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(16), server_default=text("'pending'")
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)


class Geofence(Base):
    """电子围栏。"""

    __tablename__ = "geofences"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    elder_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("elders.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(64))
    center_lat: Mapped[float] = mapped_column(Float)
    center_lon: Mapped[float] = mapped_column(Float)
    radius_m: Mapped[int] = mapped_column(Integer)
    enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class AuditLog(Base):
    """审计日志：登录与管理员写操作。"""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(64))
    target_type: Mapped[str | None] = mapped_column(String(32))
    target_id: Mapped[int | None] = mapped_column(BigInteger)
    ip: Mapped[str | None] = mapped_column(String(45))
    detail_json: Mapped[dict] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
