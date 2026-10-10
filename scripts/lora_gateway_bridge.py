"""LoRa 网关上行桥接：网络服务器 MQTT → 老人监护云平台 MQTT。

链路：
    LoRa 节点 → LoRa 网关 → LoRaWAN 网络服务器（ChirpStack / RAK 内置 NS）
    → 本桥接订阅上行 Topic → 归一化为平台契约 → 平台 MQTT
    → iot/v1/{device_uid}/{telemetry|event} → 现有告警与实时链路。

平台侧不实现 LoRaWAN 协议栈；桥接进程负责 De/EUI、base64 与字段映射，
这样真实网关、模拟器、现有 ESP32 设备可以共用同一条入云通道。

用法（容器内）：
    docker compose exec backend python -m scripts.lora_gateway_bridge

常用环境变量：
    LORA_TOPIC                 源上行 Topic，默认 application/+/device/+/event/up
                               （ChirpStack v4；v3 为 application/+/device/+/rx）
    LORA_SOURCE_MQTT_HOST      源 Broker，默认与平台相同
    LORA_SOURCE_MQTT_PORT      源 Broker 端口，默认与平台相同
    LORA_SOURCE_MQTT_USER/PASSWORD
    PLATFORM_MQTT_HOST/PORT/USER/PASSWORD
    LORA_UID_PREFIX            注册设备 UID 前缀，默认空（device_uid = devEui）
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from app.config import settings

logger = logging.getLogger("eldercare.lora.bridge")

TELEMETRY_METRIC_ALIASES = {
    "hr": "heart_rate",
    "heart": "heart_rate",
    "heart_rate": "heart_rate",
    "spo2": "spo2",
    "steps": "steps",
    "step": "steps",
    "act": "activity",
    "activity": "activity",
    "gait": "gait",
    "loc": "location",
    "location": "location",
    "bat": "battery",
    "battery": "battery",
}

EVENT_TYPE_ALIASES = {
    "fall": "fall",
    "sos": "sos",
    "gf": "geofence_exit",
    "geofence": "geofence_exit",
    "geofence_exit": "geofence_exit",
    "low_battery": "low_battery",
    "bat_low": "low_battery",
}

SEVERITY_ALIASES = {
    "i": "info",
    "w": "warning",
    "c": "critical",
    "info": "info",
    "warning": "warning",
    "critical": "critical",
}


def decode_data_field(raw: str) -> dict:
    """解析 LoRaWAN 上行的 data 字段：优先 base64，其次直接 JSON 字符串。"""
    text: str | None = None
    try:
        text = base64.b64decode(raw, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        text = raw
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("LoRa 载荷不是合法 JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("LoRa 载荷顶层必须是对象")
    return payload


def extract_uplink(payload: dict) -> tuple[str, dict, dict]:
    """从网络服务器上行报文中提取 (devEui, 节点载荷, LoRa 元数据)。"""
    if not isinstance(payload, dict):
        raise ValueError("上行报文顶层必须是对象")
    device_info = payload.get("deviceInfo") or {}
    if not isinstance(device_info, dict):
        raise ValueError("deviceInfo 必须是对象")
    dev_eui = (
        device_info.get("devEui")
        or payload.get("devEui")
        or payload.get("dev_eui")
        or payload.get("device_uid")
    )
    if not dev_eui:
        raise ValueError("无法从上行报文中解析 devEui")

    rx_info = payload.get("rxInfo") or []
    if not isinstance(rx_info, list):
        raise ValueError("rxInfo 必须是数组")
    if rx_info and not isinstance(rx_info[0], dict):
        raise ValueError("rxInfo[0] 必须是对象")
    first_rx = rx_info[0] if rx_info else {}
    tx_info = payload.get("txInfo") or {}
    if not isinstance(tx_info, dict):
        raise ValueError("txInfo 必须是对象")
    modulation = tx_info.get("modulation") or {}
    if not isinstance(modulation, dict):
        raise ValueError("txInfo.modulation 必须是对象")
    lora_tx = modulation.get("lora") or {}
    if not isinstance(lora_tx, dict):
        raise ValueError("txInfo.modulation.lora 必须是对象")

    meta: dict = {"transport": "lora"}
    mapping = {
        "gateway_eui": first_rx.get("gatewayId")
        or payload.get("gateway_eui")
        or payload.get("gatewayId"),
        "rssi": first_rx.get("rssi", payload.get("rssi")),
        "snr": first_rx.get("snr", payload.get("snr")),
        "sf": lora_tx.get("spreadingFactor", payload.get("sf")),
        "freq": tx_info.get("frequency", payload.get("freq")),
        "fcnt": payload.get("fCnt", payload.get("fcnt")),
        "fport": payload.get("fPort", payload.get("fport")),
    }
    meta.update({key: value for key, value in mapping.items() if value is not None})
    # 网络服务器时间：节点不带 ts 时用它做确定性时间戳，避免 QoS1 重投重复入库
    ns_time = payload.get("time")
    if isinstance(ns_time, str) and ns_time:
        meta["ns_time"] = ns_time

    node_payload = payload.get("object")
    if not isinstance(node_payload, dict):
        raw = payload.get("data")
        if raw is None:
            raw = payload.get("payload")
        if isinstance(raw, dict):
            node_payload = raw
        elif isinstance(raw, str):
            node_payload = decode_data_field(raw)
        else:
            raise ValueError("上行报文缺少 data/object 载荷")
    return str(dev_eui), node_payload, meta


def build_platform_messages(
    dev_eui: str,
    node_payload: dict,
    lora_meta: dict,
    *,
    uid_prefix: str = "",
    received_at: datetime | None = None,
) -> list[tuple[str, dict]]:
    """把节点载荷映射为平台 MQTT (topic, message) 列表；无法识别时返回空列表。"""
    uid = f"{uid_prefix}{dev_eui}"
    ts = (
        node_payload.get("ts")
        or lora_meta.get("ns_time")
        or (received_at or datetime.now(timezone.utc)).isoformat()
    )

    event_type = node_payload.get("e") or node_payload.get("type")
    if event_type is not None:
        mapped_type = EVENT_TYPE_ALIASES.get(str(event_type).lower())
        if mapped_type is None:
            logger.warning("未知 LoRa 事件类型：%s", event_type)
            return []
        severity = SEVERITY_ALIASES.get(
            str(
                node_payload.get("sev")
                or node_payload.get("severity")
                or "warning"
            ).lower(),
            "warning",
        )
        event_payload = node_payload.get("p") or node_payload.get("payload") or {}
        if not isinstance(event_payload, dict):
            event_payload = {}
        message: dict = {
            "device_uid": uid,
            "ts": ts,
            "type": mapped_type,
            "severity": severity,
            "payload": event_payload,
            "meta": lora_meta,
        }
        confidence = node_payload.get("cf", node_payload.get("confidence"))
        if confidence is not None:
            message["confidence"] = confidence
        return [(f"iot/v1/{uid}/event", message)]

    metric_raw = node_payload.get("m") or node_payload.get("metric")
    if metric_raw is None:
        logger.warning(
            "LoRa 载荷既不是事件也没有 metric 字段：keys=%s",
            sorted(node_payload),
        )
        return []
    metric = TELEMETRY_METRIC_ALIASES.get(str(metric_raw).lower())
    if metric is None:
        logger.warning("未知 LoRa 遥测指标：%s", metric_raw)
        return []

    message = {
        "device_uid": uid,
        "ts": ts,
        "metric": metric,
        "meta": lora_meta,
    }
    if metric == "location":
        lat = node_payload.get("lat")
        lon = node_payload.get("lon")
        if (
            isinstance(lat, bool)
            or not isinstance(lat, (int, float))
            or isinstance(lon, bool)
            or not isinstance(lon, (int, float))
        ):
            logger.warning(
                "LoRa 位置遥测缺少合法 lat/lon，已丢弃：keys=%s",
                sorted(node_payload),
            )
            return []
        message["lat"] = float(lat)
        message["lon"] = float(lon)
    elif metric in ("activity", "gait"):
        text = node_payload.get("vt") or node_payload.get("value_text")
        if isinstance(text, str) and text:
            message["value_text"] = text
        else:
            value = node_payload.get("v", node_payload.get("value"))
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                logger.warning(
                    "LoRa %s 缺少合法 value/value_text，已丢弃：keys=%s",
                    metric,
                    sorted(node_payload),
                )
                return []
            message["value"] = value
    else:
        value = node_payload.get("v", node_payload.get("value"))
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            logger.warning(
                "LoRa 遥测 %s 缺少合法数值，已丢弃：keys=%s",
                metric,
                sorted(node_payload),
            )
            return []
        message["value"] = value
    return [(f"iot/v1/{uid}/telemetry", message)]


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def _new_client(
    client_id: str,
    user: str,
    password: str,
    *,
    manual_ack: bool = False,
    clean_session: bool = True,
):
    """配置 paho 客户端（不连接）：稳定会话 + 自动重连。"""
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=client_id,
        clean_session=clean_session,
        manual_ack=manual_ack,
    )
    client.username_pw_set(user, password)
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    return client


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    source_host = _env("LORA_SOURCE_MQTT_HOST", settings.mqtt_host)
    source_port = int(_env("LORA_SOURCE_MQTT_PORT", str(settings.mqtt_port)))
    source_user = _env("LORA_SOURCE_MQTT_USER", settings.mqtt_user)
    source_password = _env(
        "LORA_SOURCE_MQTT_PASSWORD", settings.mqtt_password
    )
    platform_host = _env("PLATFORM_MQTT_HOST", settings.mqtt_host)
    platform_port = int(_env("PLATFORM_MQTT_PORT", str(settings.mqtt_port)))
    platform_user = _env("PLATFORM_MQTT_USER", settings.mqtt_user)
    platform_password = _env(
        "PLATFORM_MQTT_PASSWORD", settings.mqtt_password
    )
    topic = _env("LORA_TOPIC", "application/+/device/+/event/up")
    uid_prefix = _env("LORA_UID_PREFIX", "")

    source = _new_client(
        "eldercare-lora-source",
        source_user,
        source_password,
        manual_ack=True,
        clean_session=False,
    )
    platform = _new_client(
        "eldercare-lora-platform",
        platform_user,
        platform_password,
        clean_session=False,
    )

    def on_source_connect(client, _userdata, _flags, reason_code, _properties):
        if reason_code.is_failure:
            logger.error("源 Broker 连接失败：%s", reason_code)
            return
        result, _ = client.subscribe(topic, qos=1)
        results = result if isinstance(result, list) else [result]
        if any(
            getattr(item, "is_failure", False)
            or getattr(item, "value", item) != 0
            for item in results
        ):
            logger.error("源上行 Topic 订阅失败：%s", results)
        else:
            logger.info("已订阅源上行 Topic=%s", topic)

    def on_platform_connect(_client, _userdata, _flags, reason_code, _properties):
        if reason_code.is_failure:
            logger.error("平台 Broker 连接失败：%s", reason_code)
        else:
            logger.info("平台 Broker 已连接 %s:%s", platform_host, platform_port)

    def _ack_source(client, message) -> None:
        if message.qos <= 0:
            return
        try:
            client.ack(message.mid, message.qos)
        except Exception:
            logger.exception("源消息 ACK 失败 mid=%s", message.mid)

    def on_message(client, _userdata, message) -> None:
        try:
            uplink = json.loads(message.payload.decode("utf-8"))
            dev_eui, node_payload, lora_meta = extract_uplink(uplink)
        except ValueError as exc:
            logger.warning("丢弃非法 LoRa 上行 topic=%s：%s", message.topic, exc)
            _ack_source(client, message)
            return

        try:
            messages = build_platform_messages(
                dev_eui,
                node_payload,
                lora_meta,
                uid_prefix=uid_prefix,
                received_at=datetime.now(timezone.utc),
            )
            if not messages:
                logger.warning(
                    "LoRa 上行未产生平台消息，已丢弃 topic=%s", message.topic
                )
                _ack_source(client, message)
                return

            for platform_topic, body in messages:
                info = platform.publish(
                    platform_topic,
                    json.dumps(body, ensure_ascii=False),
                    qos=1,
                )
                if info.rc != mqtt.MQTT_ERR_SUCCESS:
                    raise RuntimeError(
                        f"平台发布失败 rc={info.rc} topic={platform_topic}"
                    )
                info.wait_for_publish(timeout=5)
                if not info.is_published():
                    raise RuntimeError(f"平台 PUBACK 超时 topic={platform_topic}")

            _ack_source(client, message)
            logger.info(
                "LoRa 上行已转发 node=%s topics=%s",
                dev_eui,
                [item[0] for item in messages],
            )
        except Exception:
            logger.exception(
                "LoRa 转发失败，未 ACK 源消息 mid=%s topic=%s",
                message.mid,
                message.topic,
            )

    source.on_connect = on_source_connect
    source.on_message = on_message
    platform.on_connect = on_platform_connect
    source.connect(source_host, source_port, keepalive=30)
    source.loop_start()
    platform.connect(platform_host, platform_port, keepalive=30)
    platform.loop_start()
    logger.info(
        "LoRa 桥接已启动：source=%s:%s topic=%s → platform=%s:%s prefix=%r",
        source_host,
        source_port,
        topic,
        platform_host,
        platform_port,
        uid_prefix,
    )

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("LoRa 桥接停止")
    finally:
        source.loop_stop()
        platform.loop_stop()
        source.disconnect()
        platform.disconnect()


if __name__ == "__main__":
    main()
