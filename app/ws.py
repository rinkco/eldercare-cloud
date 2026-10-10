"""WebSocket 实时推送：新告警与新遥测摘要。"""

import asyncio
import logging
import time
from dataclasses import dataclass
from dataclasses import field
from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.db import SessionLocal
from app.models import ElderAccess, User
from app.security import TokenError, decode_access_token

logger = logging.getLogger("eldercare.ws")


@dataclass
class _Client:
    websocket: WebSocket
    user_id: int
    role: str
    elder_ids: set[int] | None
    expires_at: datetime
    checked_at: float
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class RealtimeHub:
    """管理 WebSocket 连接并按老人可见范围广播。"""

    def __init__(self) -> None:
        self._clients: dict[WebSocket, _Client] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def register(
        self,
        websocket: WebSocket,
        user_id: int,
        role: str,
        expires_at: datetime,
    ) -> None:
        elder_ids: set[int] | None = None
        if role == "family":
            elder_ids = self._load_elder_ids(user_id)
        self._clients[websocket] = _Client(
            websocket=websocket,
            user_id=user_id,
            role=role,
            elder_ids=elder_ids,
            expires_at=expires_at,
            checked_at=time.monotonic(),
        )
        await websocket.send_json({"type": "ready"})
        logger.info("WebSocket 已连接 user_id=%s role=%s", user_id, role)

    @staticmethod
    def _load_elder_ids(user_id: int) -> set[int]:
        with SessionLocal() as db:
            return set(
                db.execute(
                    select(ElderAccess.elder_id).where(
                        ElderAccess.user_id == user_id
                    )
                ).scalars()
            )

    def disconnect(self, websocket: WebSocket) -> None:
        self._clients.pop(websocket, None)

    def publish_threadsafe(
        self, payload: dict, *, elder_id: int | None = None
    ) -> None:
        """供 MQTT/后台线程调用：把广播调度回事件循环。"""
        loop = self._loop
        if loop is None or loop.is_closed():
            logger.warning("WS 广播被跳过：事件循环未绑定")
            return
        future = asyncio.run_coroutine_threadsafe(
            self.broadcast(payload, elder_id=elder_id), loop
        )
        future.add_done_callback(self._log_future_error)

    @staticmethod
    def _log_future_error(future) -> None:
        try:
            future.result()
        except Exception as exc:  # pragma: no cover - 后台调度异常
            logger.error("WS 广播任务失败：%s", exc)

    def _authorized(self, client: _Client, elder_id: int | None) -> bool:
        """校验 token 是否过期，并周期性复核用户角色与访问关系。"""
        if datetime.now(timezone.utc) >= client.expires_at:
            return False

        if time.monotonic() - client.checked_at >= 30:
            with SessionLocal() as db:
                user = db.get(User, client.user_id)
                if user is None or user.role not in ("admin", "family"):
                    return False
                client.role = user.role
                client.elder_ids = (
                    self._load_elder_ids(client.user_id)
                    if user.role == "family"
                    else None
                )
                client.checked_at = time.monotonic()

        if elder_id is None or client.role == "admin":
            return True
        return client.elder_ids is not None and elder_id in client.elder_ids

    async def broadcast(
        self, payload: dict, *, elder_id: int | None = None
    ) -> None:
        dead: list[WebSocket] = []
        tasks: list[tuple[WebSocket, asyncio.Task]] = []
        for websocket, client in list(self._clients.items()):
            if not self._authorized(client, elder_id):
                dead.append(websocket)
                continue
            tasks.append(
                (websocket, asyncio.create_task(self._send(client, payload)))
            )

        results = await asyncio.gather(
            *(task for _, task in tasks), return_exceptions=True
        )
        for (websocket, _), result in zip(tasks, results):
            if result is not True:
                dead.append(websocket)

        for websocket in dict.fromkeys(dead):
            self._clients.pop(websocket, None)
            try:
                await websocket.close(code=4401)
            except Exception:
                pass

    @staticmethod
    async def _send(client: _Client, payload: dict) -> bool:
        try:
            async with client.send_lock:
                await asyncio.wait_for(
                    client.websocket.send_json(payload), timeout=2
                )
            return True
        except Exception:
            return False


hub = RealtimeHub()

router = APIRouter(tags=["实时推送"])


@router.websocket("/api/v1/ws")
async def websocket_endpoint(
    websocket: WebSocket, token: str = Query(default="")
) -> None:
    """实时推送：鉴权后接收告警与遥测摘要。"""
    await websocket.accept()
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
        expires_at = datetime.fromtimestamp(float(payload["exp"]), tz=timezone.utc)
    except (
        TokenError,
        KeyError,
        TypeError,
        ValueError,
        OSError,
        OverflowError,
    ):
        await websocket.close(code=4401)
        return

    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None or user.role not in ("admin", "family"):
            await websocket.close(code=4403)
            return
        role = user.role

    try:
        await hub.register(websocket, user_id, role, expires_at)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket 连接异常 user_id=%s", user_id)
    finally:
        hub.disconnect(websocket)




def publish_alert(
    *,
    alert_id: int,
    event_id: int,
    elder_id: int,
    elder_name: str,
    event_type: str,
    severity: str,
    occurred_at,
) -> None:
    hub.publish_threadsafe(
        {
            "type": "alert",
            "alert": {
                "id": alert_id,
                "event_id": event_id,
                "elder_id": elder_id,
                "elder_name": elder_name,
                "event_type": event_type,
                "severity": severity,
                "occurred_at": occurred_at.isoformat(),
                "status": "new",
            },
        },
        elder_id=elder_id,
    )


def publish_telemetry(
    *,
    elder_id: int,
    device_uid: str,
    metric: str,
    value_num: float | None,
    value_text: str | None,
    lat: float | None,
    lon: float | None,
    meta: dict | None = None,
    recorded_at,
) -> None:
    hub.publish_threadsafe(
        {
            "type": "telemetry",
            "telemetry": {
                "elder_id": elder_id,
                "device_uid": device_uid,
                "metric": metric,
                "value_num": value_num,
                "value_text": value_text,
                "lat": lat,
                "lon": lon,
                "meta_json": meta or {},
                "recorded_at": recorded_at.isoformat(),
            },
        },
        elder_id=elder_id,
    )
