"""接口请求/响应模型。"""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    role: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    display_name: str | None = None
    phone: str | None = None


class ElderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    gender: str | None = Field(default=None, max_length=16)
    birth_date: date | None = None
    height_cm: int | None = Field(default=None, ge=30, le=250)
    weight_kg: float | None = Field(default=None, ge=1, le=500)
    address: str | None = Field(default=None, max_length=255)
    notes: str | None = None


class ElderUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=64)
    gender: str | None = Field(default=None, max_length=16)
    birth_date: date | None = None
    height_cm: int | None = Field(default=None, ge=30, le=250)
    weight_kg: float | None = Field(default=None, ge=1, le=500)
    address: str | None = Field(default=None, max_length=255)
    notes: str | None = None

    @model_validator(mode="after")
    def _reject_explicit_null_name(self) -> "ElderUpdate":
        """name 是必填列：允许省略，但显式提交 null 要返回 422。"""
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name 不能为 null")
        return self


class ElderOut(ElderCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


class ContactIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    phone: str = Field(min_length=1, max_length=32)
    relation: str | None = Field(default=None, max_length=32)
    priority: int = Field(default=1, ge=1, le=99)
    is_primary: bool = False


class ContactOut(ContactIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class DeviceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # UID 会进入 MQTT 主题层级，禁止 / + # 空格等字符
    device_uid: str = Field(
        min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
    )
    kind: Literal["esp32", "phone", "wearable"]
    model: str | None = Field(default=None, max_length=64)


class DeviceBind(BaseModel):
    model_config = ConfigDict(extra="forbid")

    elder_id: int = Field(gt=0)


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_uid: str
    kind: str
    model: str | None = None
    status: str
    elder_id: int | None = None
    battery_percent: int | None = None
    last_seen_at: datetime | None = None
    bound_at: datetime | None = None


class GeofenceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    center_lat: float = Field(ge=-90, le=90)
    center_lon: float = Field(ge=-180, le=180)
    radius_m: int = Field(ge=50, le=5000)
    # 严格布尔：JSON 中只接受 true/false，拒绝 0/1/"false"/null 等宽松转换
    enabled: Annotated[bool, Field(strict=True)] = True


class GeofenceOut(GeofenceIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    alert_id: int
    contact_id: int | None = None
    channel: str
    target: str | None = None
    content: str
    status: str
    sent_at: datetime | None = None
    error: str | None = None


class TelemetryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: int
    elder_id: int
    metric: str
    value_num: float | None = None
    value_text: str | None = None
    lat: float | None = None
    lon: float | None = None
    recorded_at: datetime


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    elder_id: int
    device_id: int
    type: str
    severity: str
    confidence: float | None = None
    occurred_at: datetime
    payload_json: dict
    status: str


class AlertOut(BaseModel):
    id: int
    event_id: int
    elder_id: int
    status: str
    created_at: datetime
    handled_at: datetime | None = None
    handled_by: int | None = None
    event_type: str
    severity: str


class MetricStats(BaseModel):
    avg: float
    min: float
    max: float
    count: int


class ActivityCount(BaseModel):
    activity: str
    count: int


class TrendBucket(BaseModel):
    bucket_start: datetime
    heart_rate: MetricStats | None = None
    spo2: MetricStats | None = None
    steps_total: float | None = None
    activity: list[ActivityCount] = Field(default_factory=list)
