"""老人监护云平台后端应用入口（SPEC 01）。

教学演示项目，仅用于课设答辩，不接入真实个人数据与真实医疗场景。
"""

import logging
import asyncio
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory
from fastapi import Depends, FastAPI, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings, validate_security_settings
from app.db import get_db
from app.logging_utils import install_log_redaction
from app.mqtt.service import mqtt_service
from app.monitor import offline_monitor
from app.routers.auth import router as auth_router
from app.routers.devices import router as devices_router
from app.routers.elders import router as elders_router
from app.routers.events import router as events_router
from app.routers.geofences import router as geofences_router
from app.routers.telemetry import router as telemetry_router
from app.routers.users import router as users_router
from app.ws import hub, router as ws_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
# WebSocket token 走查询参数，必须避免进入 uvicorn 访问/错误日志
install_log_redaction()

APP_NAME = "老人监护云平台 API"

OPENAPI_TAGS = [
    {"name": "系统", "description": "健康与就绪探针。"},
    {"name": "认证", "description": "注册、登录并签发 JWT。"},
    {"name": "用户管理", "description": "管理员查看与编辑账号（仅 admin）。"},
    {
        "name": "老人档案",
        "description": "老人档案与紧急联系人；family 仅能访问已关联的老人。",
    },
    {"name": "遥测与趋势", "description": "遥测查询与小时/天健康趋势。"},
    {"name": "设备管理", "description": "设备注册、列表与绑定（仅 admin）。"},
    {"name": "电子围栏", "description": "电子围栏读取与整表替换。"},
    {"name": "事件与告警", "description": "事件列表、告警确认与通知记录。"},
    {"name": "实时推送", "description": "WebSocket 实时推送（JWT 通过查询参数传递）。"},
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    """启动时校验安全配置，配置不合格直接拒绝启动。"""
    validate_security_settings(settings.jwt_secret)
    hub.bind_loop(asyncio.get_running_loop())
    mqtt_service.start()
    offline_monitor.start()
    try:
        yield
    finally:
        offline_monitor.stop()
        mqtt_service.stop()


app = FastAPI(
    title=APP_NAME,
    version="0.2.0",
    description=(
        "老人跌倒检测健康监护系统云平台后端（教学演示）："
        "MQTT 设备接入、健康与位置数据、告警通知、账号注册与用户管理。"
        "除公开接口外，请先调用 `/api/v1/auth/login` 获取 JWT，"
        "再在 Swagger 右上角 Authorize 中填入。"
    ),
    openapi_tags=OPENAPI_TAGS,
    lifespan=lifespan,
)

app.include_router(auth_router)
app.include_router(devices_router)
app.include_router(elders_router)
app.include_router(telemetry_router)
app.include_router(events_router)
app.include_router(geofences_router)
app.include_router(users_router)
app.include_router(ws_router)


@lru_cache
def _migration_head() -> str | None:
    """读取仓库内迁移脚本的 head revision。"""
    config_path = Path(__file__).resolve().parent.parent / "alembic.ini"
    script = ScriptDirectory.from_config(AlembicConfig(str(config_path)))
    return script.get_current_head()


@app.get("/healthz", tags=["系统"], summary="存活探针")
def healthz() -> dict[str, str]:
    """返回服务存活状态，供 Docker 健康检查与演示环境探针使用。"""
    return {"status": "ok"}


@app.get("/readyz", tags=["系统"], summary="就绪探针")
def readyz(
    response: Response, db: Session = Depends(get_db)
) -> dict[str, str]:
    """检查数据库、迁移版本与 MQTT 连接；未就绪时返回 503。"""
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "unavailable",
            "database": "down",
            "migration": "unknown",
            "mqtt": "unknown",
        }

    try:
        db_revision = db.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one_or_none()
    except SQLAlchemyError:
        db_revision = None

    if db_revision is None or db_revision != _migration_head():
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "unavailable",
            "database": "ok",
            "migration": "pending",
            "mqtt": "unknown",
        }

    if not mqtt_service.is_connected():
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "unavailable",
            "database": "ok",
            "migration": "ok",
            "mqtt": "down",
        }

    return {"status": "ok", "database": "ok", "migration": "ok", "mqtt": "ok"}
