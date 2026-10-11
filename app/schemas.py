"""接口请求/响应模型。"""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class LoginRequest(BaseModel):
    """登录请求。"""

    username: str = Field(min_length=1, max_length=64, description="账号")
    password: str = Field(min_length=1, max_length=128, description="密码")

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"username": "family", "password": "family123456"}]
        }
    )


class RegisterRequest(BaseModel):
    """公开注册请求：仅创建 family 角色账号。"""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "username": "zhang-family",
                    "password": "family-pass-123",
                    "display_name": "张奶奶女儿",
                    "phone": "13800000000",
                }
            ]
        },
    )

    username: str = Field(
        min_length=3,
        max_length=32,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="账号：3-32 位字母、数字、下划线或连字符，全局唯一",
    )
    password: str = Field(
        min_length=6,
        max_length=64,
        description="密码：6-64 字符，且不超过 72 字节",
    )
    display_name: str | None = Field(
        default=None, max_length=64, description="显示名（可选）"
    )
    phone: str | None = Field(
        default=None, max_length=32, description="手机号（可选，不校验格式）"
    )

    @model_validator(mode="after")
    def _reject_password_over_bcrypt_limit(self) -> "RegisterRequest":
        """bcrypt 只处理前 72 字节，超长密码直接拒绝。"""
        if len(self.password.encode("utf-8")) > 72:
            raise ValueError("密码超过 bcrypt 的 72 字节上限")
        return self


class TokenResponse(BaseModel):
    access_token: str = Field(description="JWT；REST 与 WebSocket 鉴权都使用它")
    token_type: str = Field(default="bearer", description="当前固定为 bearer")
    expires_in: int = Field(description="有效期秒数")
    role: str = Field(description="角色：admin 或 family")


class UserOut(BaseModel):
    """账号信息（不含密码哈希）。"""

    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "examples": [
                {
                    "id": 3,
                    "username": "zhang-family",
                    "role": "family",
                    "display_name": "张奶奶女儿",
                    "phone": "13800000000",
                }
            ]
        },
    )

    id: int = Field(description="用户 ID")
    username: str = Field(description="账号")
    role: str = Field(description="角色：admin 或 family")
    display_name: str | None = Field(default=None, description="显示名")
    phone: str | None = Field(default=None, description="手机号")


class UserUpdate(BaseModel):
    """管理员编辑用户：省略字段表示不修改，显式 null 表示清空。"""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "display_name": "张奶奶女儿",
                    "phone": "13800000000",
                    "role": "family",
                    "password": "new-pass-456",
                }
            ]
        },
    )

    display_name: str | None = Field(
        default=None, max_length=64, description="显示名；传 null 表示清空"
    )
    phone: str | None = Field(
        default=None, max_length=32, description="手机号；传 null 表示清空"
    )
    role: Literal["admin", "family"] | None = Field(
        default=None, description="角色：admin 或 family；省略不修改，不允许显式 null"
    )
    password: str | None = Field(
        default=None,
        min_length=6,
        max_length=64,
        description="重置密码：6-64 字符、≤72 字节；省略表示不修改",
    )

    @model_validator(mode="after")
    def _validate_update(self) -> "UserUpdate":
        if "role" in self.model_fields_set and self.role is None:
            raise ValueError("role 不能为 null")
        if self.password is not None and len(self.password.encode("utf-8")) > 72:
            raise ValueError("密码超过 bcrypt 的 72 字节上限")
        return self


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
    my_role: Literal["admin", "owner", "member"] = Field(
        description="当前调用者在该老人上的角色：admin / owner / member"
    )


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


class AccessMemberIn(BaseModel):
    """监护成员整体替换的单行入参。"""

    model_config = ConfigDict(extra="forbid")

    user_id: int = Field(gt=0, description="家属账号 ID")
    role: Literal["owner", "member"] = Field(
        description="owner=主照护者（可管理成员），member=普通成员"
    )
    relation: str | None = Field(default=None, max_length=32)


class AccessMemberOut(BaseModel):
    """监护成员列表项（含账号展示信息）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    username: str
    display_name: str | None = None
    role: str
    relation: str | None = None


class UserElderOut(BaseModel):
    """账号关联的老人（用户列表「监护关系」抽屉）。"""

    elder_id: int = Field(description="老人 ID")
    name: str = Field(description="老人姓名")
    role: Literal["owner", "member"] = Field(
        description="该账号在这位老人上的成员角色"
    )
    relation: str | None = Field(default=None, description="与老人的关系（只读展示）")


class AccessCandidateOut(BaseModel):
    """可作为监护成员添加的候选家属账号。"""

    id: int = Field(description="账号 ID")
    username: str = Field(description="账号")
    display_name: str | None = Field(default=None, description="显示名")


class DeviceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # UID 会进入 MQTT 主题层级，禁止 / + # 空格等字符
    device_uid: str = Field(
        min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
    )
    kind: Literal["esp32", "phone", "wearable", "lora_node"]
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
    meta_json: dict = Field(default_factory=dict)
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
    meta_json: dict = Field(default_factory=dict)
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
    occurred_at: datetime
    elder_name: str | None = None


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
