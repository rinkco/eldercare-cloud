"""测试辅助函数。"""

import json
import threading
import uuid

import paho.mqtt.client as mqtt

from app.config import settings

_lock = threading.Lock()
_client: mqtt.Client | None = None


def _get_client() -> mqtt.Client:
    """复用同一个发布客户端，避免每次连接/断开的线程等待开销。"""
    global _client
    if _client is None:
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"test-publisher-{uuid.uuid4().hex[:8]}",
        )
        client.username_pw_set(settings.mqtt_user, settings.mqtt_password)
        client.connect(settings.mqtt_host, settings.mqtt_port, keepalive=30)
        client.loop_start()
        _client = client
    return _client


def publish_mqtt(topic: str, payload: dict) -> None:
    """用带认证的 MQTT 客户端发布一条 QoS 1 消息。"""
    global _client
    with _lock:
        try:
            client = _get_client()
            info = client.publish(topic, json.dumps(payload), qos=1)
            info.wait_for_publish(timeout=5)
        except Exception:
            _client = None
            raise
