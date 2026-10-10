"""MQTT 订阅与入库服务（随 FastAPI 应用生命周期启动）。"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.alerts import maybe_geofence_exit, maybe_low_battery
from app.alerts import create_alert_with_notifications
from app.models import Device, Event, Telemetry
from app.models import Alert, Elder
from app.mqtt.validation import (
    PayloadError,
    decode_json,
    parse_event,
    parse_status,
    parse_telemetry,
    parse_topic,
)
from app.ws import publish_alert, publish_telemetry

logger = logging.getLogger("eldercare.mqtt")

SUBSCRIPTIONS = [
    ("iot/v1/+/telemetry", 1),
    ("iot/v1/+/event", 1),
    ("iot/v1/+/status", 1),
]


def handle_message(topic: str, raw_payload: bytes) -> bool:
    """处理一条上行消息。

    返回 True 表示消息已终结（成功入库或确认丢弃，可以 ACK）；
    返回 False 表示出现可重试失败（不要 ACK，等待 broker 重投）。
    """
    try:
        topic_uid, kind = parse_topic(topic)
        data = decode_json(raw_payload)
    except PayloadError as exc:
        logger.warning("丢弃非法 MQTT 消息 topic=%s：%s", topic, exc)
        return True

    if data.get("device_uid") != topic_uid:
        logger.warning(
            "载荷 device_uid=%r 与主题 %r 不一致，消息丢弃",
            data.get("device_uid"),
            topic_uid,
        )
        return True

    try:
        if kind == "telemetry":
            _handle_telemetry(topic_uid, data)
        elif kind == "event":
            _handle_event(topic_uid, data)
        else:
            _handle_status(topic_uid, data)
    except PayloadError as exc:
        logger.warning("丢弃非法 %s 载荷 device_uid=%s：%s", kind, topic_uid, exc)
        return True
    except Exception:
        logger.exception(
            "处理 %s 消息失败，未发送 PUBACK，等待 broker 重投 device_uid=%s",
            kind,
            topic_uid,
        )
        return False
    return True


def _find_device(db: Session, device_uid: str) -> Device | None:
    device = db.execute(
        select(Device).where(Device.device_uid == device_uid)
    ).scalar_one_or_none()
    if device is None:
        logger.warning("未注册设备 device_uid=%s，消息丢弃", device_uid)
        return None
    if device.status == "disabled":
        logger.warning("设备已停用 device_uid=%s，消息丢弃", device_uid)
        return None
    return device


def _touch(device: Device) -> None:
    """更新在线状态与最后活跃时间（使用服务端时间）。"""
    device.status = "online"
    device.last_seen_at = datetime.now(timezone.utc)


def _subscribe_failed(result: object) -> bool:
    """兼容 ReasonCode 与 MQTTErrorCode 两种返回类型。"""
    is_failure = getattr(result, "is_failure", None)
    if is_failure is not None:
        return bool(is_failure)
    return getattr(result, "value", result) != 0


def _handle_telemetry(device_uid: str, data: dict) -> None:
    message = parse_telemetry(data)

    with SessionLocal() as db:
        device = _find_device(db, device_uid)
        if device is None:
            return
        if device.elder_id is None:
            logger.warning("设备未绑定老人 device_uid=%s，遥测丢弃", device_uid)
            return

        duplicate = db.execute(
            select(Telemetry.id).where(
                Telemetry.device_id == device.id,
                Telemetry.metric == message.metric,
                Telemetry.recorded_at == message.recorded_at,
                Telemetry.value_num.is_not_distinct_from(message.value_num),
                Telemetry.value_text.is_not_distinct_from(message.value_text),
                Telemetry.lat.is_not_distinct_from(message.lat),
                Telemetry.lon.is_not_distinct_from(message.lon),
                Telemetry.meta_json == message.meta,
            )
        ).first()
        if duplicate is not None:
            # QoS 1 至少一次投递：重复消息只刷新设备活跃时间
            _touch(device)
            db.commit()
            logger.info("重复遥测消息已忽略 device_uid=%s", device_uid)
            return

        previous_battery = device.battery_percent
        rule_events = []
        if message.metric == "location" and message.lat is not None and message.lon is not None:
            rule_events.extend(
                maybe_geofence_exit(
                    db,
                    device,
                    lat=message.lat,
                    lon=message.lon,
                    occurred_at=message.recorded_at,
                )
            )
        if message.metric == "battery" and message.value_num is not None:
            low_event = maybe_low_battery(
                db,
                device,
                previous_battery=previous_battery,
                current_battery=int(message.value_num),
                occurred_at=message.recorded_at,
            )
            if low_event is not None:
                rule_events.append(low_event)

        db.add(
            Telemetry(
                device_id=device.id,
                elder_id=device.elder_id,
                metric=message.metric,
                value_num=message.value_num,
                value_text=message.value_text,
                lat=message.lat,
                lon=message.lon,
                meta_json=message.meta,
                recorded_at=message.recorded_at,
            )
        )
        _touch(device)
        if message.metric == "battery" and message.value_num is not None:
            device.battery_percent = int(message.value_num)
        db.commit()
        logger.info("遥测入库 device_uid=%s metric=%s", device_uid, message.metric)

        publish_telemetry(
            elder_id=device.elder_id,
            device_uid=device_uid,
            metric=message.metric,
            value_num=message.value_num,
            value_text=message.value_text,
            lat=message.lat,
            lon=message.lon,
            meta=message.meta,
            recorded_at=message.recorded_at,
        )
        _publish_rule_events(db, rule_events)


def _handle_event(device_uid: str, data: dict) -> None:
    message = parse_event(data)

    with SessionLocal() as db:
        device = _find_device(db, device_uid)
        if device is None:
            return
        if device.elder_id is None:
            logger.warning("设备未绑定老人 device_uid=%s，事件丢弃", device_uid)
            return

        duplicate = db.execute(
            select(Event.id).where(
                Event.device_id == device.id,
                Event.type == message.type,
                Event.severity == message.severity,
                Event.occurred_at == message.occurred_at,
                Event.confidence.is_not_distinct_from(message.confidence),
                Event.payload_json == message.payload,
                Event.meta_json == message.meta,
            )
        ).first()
        if duplicate is not None:
            _touch(device)
            db.commit()
            logger.info("重复事件消息已忽略 device_uid=%s", device_uid)
            return

        event = Event(
            elder_id=device.elder_id,
            device_id=device.id,
            type=message.type,
            severity=message.severity,
            confidence=message.confidence,
            occurred_at=message.occurred_at,
            payload_json=message.payload,
            meta_json=message.meta,
        )
        db.add(event)
        db.flush()
        # 设备事件与低电量/围栏规则统一走告警引擎
        alert = create_alert_with_notifications(db, event)
        _touch(device)
        db.commit()
        logger.info(
            "事件入库 device_uid=%s type=%s", device_uid, message.type
        )
        publish_alert(
            alert_id=alert.id,
            event_id=event.id,
            elder_id=event.elder_id,
            elder_name=_elder_name(db, event.elder_id),
            event_type=event.type,
            severity=event.severity,
            occurred_at=event.occurred_at,
        )


def _elder_name(db: Session, elder_id: int) -> str:
    elder = db.get(Elder, elder_id)
    return elder.name if elder is not None else f"老人#{elder_id}"


def _publish_rule_events(db: Session, events: list[Event]) -> None:
    for event in events:
        alert = db.execute(
            select(Alert).where(Alert.event_id == event.id)
        ).scalar_one_or_none()
        if alert is None:
            continue
        publish_alert(
            alert_id=alert.id,
            event_id=event.id,
            elder_id=event.elder_id,
            elder_name=_elder_name(db, event.elder_id),
            event_type=event.type,
            severity=event.severity,
            occurred_at=event.occurred_at,
        )


def _handle_status(device_uid: str, data: dict) -> None:
    message = parse_status(data)

    with SessionLocal() as db:
        device = _find_device(db, device_uid)
        if device is None:
            return

        _touch(device)
        low_event = None
        if message.battery_percent is not None:
            low_event = maybe_low_battery(
                db,
                device,
                previous_battery=device.battery_percent,
                current_battery=message.battery_percent,
                occurred_at=message.recorded_at,
            )
            device.battery_percent = message.battery_percent
        db.commit()
        logger.info("设备状态更新 device_uid=%s", device_uid)
        if low_event is not None:
            _publish_rule_events(db, [low_event])


class MqttIngestService:
    """paho-mqtt 客户端封装：后台线程重连并消费上行主题。"""

    def __init__(self) -> None:
        self._client: mqtt.Client | None = None
        self._connected = threading.Event()

    def is_connected(self) -> bool:
        return self._connected.is_set()

    def start(self) -> None:
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id="eldercare-cloud-backend",
            clean_session=False,
            manual_ack=True,
        )
        client.username_pw_set(settings.mqtt_user, settings.mqtt_password)
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        client.on_connect = self._on_connect
        client.on_message = self._on_message
        client.connect_async(
            settings.mqtt_host, settings.mqtt_port, keepalive=30
        )
        client.loop_start()
        self._client = client
        logger.info(
            "MQTT 接入服务已启动 broker=%s:%s",
            settings.mqtt_host,
            settings.mqtt_port,
        )

    def stop(self) -> None:
        self._connected.clear()
        if self._client is None:
            return
        self._client.loop_stop()
        try:
            self._client.disconnect()
        except Exception:  # pragma: no cover - 关闭阶段的网络异常
            logger.exception("MQTT 客户端关闭异常")
        self._client = None

    def _on_connect(
        self,
        client: mqtt.Client,
        userdata: object,
        flags: mqtt.ConnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: mqtt.Properties | None,
    ) -> None:
        if reason_code.is_failure:
            logger.error("MQTT 连接失败：%s", reason_code)
            self._connected.clear()
            return
        try:
            result, _ = client.subscribe(SUBSCRIPTIONS)
        except Exception:
            logger.exception("MQTT 订阅调用失败")
            self._connected.clear()
            return
        results = result if isinstance(result, list) else [result]
        failures = [item for item in results if _subscribe_failed(item)]
        if failures:
            logger.error("MQTT 订阅失败：%s", failures)
            self._connected.clear()
            return
        self._connected.set()
        logger.info("MQTT 已连接并订阅上行主题：%s", [t for t, _ in SUBSCRIPTIONS])

    def _on_disconnect(
        self,
        client: mqtt.Client,
        userdata: object,
        disconnect_flags: mqtt.DisconnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: mqtt.Properties | None,
    ) -> None:
        self._connected.clear()
        logger.warning("MQTT 连接断开：%s，将自动重连", reason_code)

    def _on_message(
        self,
        client: mqtt.Client, userdata: object, message: mqtt.MQTTMessage
    ) -> None:
        try:
            handled = _process_with_retry(message.topic, message.payload)
        except Exception:
            logger.exception("处理 MQTT 消息时出现未预期异常 topic=%s", message.topic)
            handled = False

        if handled:
            try:
                client.ack(message.mid, message.qos)
            except Exception:
                logger.exception("发送 PUBACK 失败 mid=%s", message.mid)


def _process_with_retry(
    topic: str, payload: bytes, attempts: int = 3
) -> bool:
    """可重试失败时短暂重试；仍失败则返回 False 等待 broker 重投。"""
    for attempt in range(attempts):
        if handle_message(topic, payload):
            return True
        if attempt < attempts - 1:
            time.sleep(0.2)
    return False


mqtt_service = MqttIngestService()
