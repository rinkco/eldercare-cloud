"""MQTT 模拟设备。

用法（正常上报）：
    docker compose exec backend python -m scripts.simulate_device

一次性事件演示：
    docker compose exec backend python -m scripts.simulate_device --scenario fall
    docker compose exec backend python -m scripts.simulate_device --scenario sos
    docker compose exec backend python -m scripts.simulate_device --scenario geofence

低电量演示（把电量上报为 15%，触发低电量告警）：
    docker compose exec backend python -m scripts.simulate_device --scenario low-battery
"""

import argparse
import json
import time
import uuid
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from app.config import settings


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _publish(
    client: mqtt.Client, topic: str, payload: dict, timeout: float = 5.0
) -> None:
    info = client.publish(topic, json.dumps(payload), qos=1)
    if info.rc != mqtt.MQTT_ERR_SUCCESS:
        raise SystemExit(f"MQTT 发布失败：{mqtt.error_string(info.rc)}")
    try:
        info.wait_for_publish(timeout=timeout)
    except (RuntimeError, ValueError) as exc:
        raise SystemExit(f"等待 broker 确认超时：{exc}") from exc


def _telemetry(client: mqtt.Client, uid: str, metric: str, **values) -> None:
    _publish(
        client,
        f"iot/v1/{uid}/telemetry",
        {"device_uid": uid, "ts": _now(), "metric": metric, **values},
    )


def _event(client: mqtt.Client, uid: str, event_type: str) -> None:
    severity = "critical" if event_type in ("fall", "sos") else "warning"
    payload = {"source": "simulate_device"}
    if event_type == "fall":
        payload = {"source": "mpu6050", "accel_g": 3.2}
    _publish(
        client,
        f"iot/v1/{uid}/event",
        {
            "device_uid": uid,
            "ts": _now(),
            "type": event_type,
            "severity": severity,
            "confidence": 0.97 if event_type == "fall" else None,
            "payload": payload,
        },
    )


def run_once(client: mqtt.Client, uid: str, scenario: str) -> None:
    """执行一次场景上报（供 CLI 使用）。"""
    if scenario == "fall":
        _event(client, uid, "fall")
        return
    if scenario == "sos":
        _event(client, uid, "sos")
        return
    if scenario == "geofence":
        _telemetry(client, uid, "location", lat=31.2304, lon=121.4737)
        time.sleep(0.5)
        _telemetry(client, uid, "location", lat=31.2397, lon=121.4998)
        return
    if scenario == "low-battery":
        # 先回到正常电量，确保每次演示都能触发“跨越 20% 阈值”
        _telemetry(client, uid, "battery", value=80)
        time.sleep(0.3)
        _telemetry(client, uid, "battery", value=15)
        return
    raise SystemExit(f"未知场景：{scenario}")


def main() -> None:
    parser = argparse.ArgumentParser(description="IoT Code 老人监护 MQTT 模拟设备")
    parser.add_argument("--device-uid", default="esp32-demo-0001")
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument(
        "--scenario",
        choices=["normal", "fall", "sos", "geofence", "low-battery"],
        default="normal",
        help="normal 持续上报；其余场景发送一次后退出",
    )
    parser.add_argument("--count", type=int, default=0, help="normal 模式上报轮数，0 表示无限")
    args = parser.parse_args()

    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"simulator-{uuid.uuid4().hex[:8]}",
    )
    client.username_pw_set(settings.mqtt_user, settings.mqtt_password)
    client.connect(settings.mqtt_host, settings.mqtt_port, keepalive=30)
    client.loop_start()
    deadline = time.monotonic() + 5
    while not client.is_connected() and time.monotonic() < deadline:
        time.sleep(0.05)
    if not client.is_connected():
        raise SystemExit("MQTT 连接超时：请检查 broker 地址与账号口令")

    try:
        if args.scenario != "normal":
            run_once(client, args.device_uid, args.scenario)
            time.sleep(0.5)
            print(f"已发送场景：{args.scenario}")
            return

        round_no = 0
        battery = 86
        while args.count == 0 or round_no < args.count:
            round_no += 1
            battery = max(19, battery - 1)
            _telemetry(
                client,
                args.device_uid,
                "heart_rate",
                value=70 + round_no % 20,
            )
            _telemetry(client, args.device_uid, "spo2", value=96 + round_no % 3)
            _telemetry(client, args.device_uid, "steps", value=60)
            _telemetry(
                client,
                args.device_uid,
                "activity",
                value_text="walking" if round_no % 3 else "resting",
            )
            _telemetry(
                client,
                args.device_uid,
                "location",
                lat=31.2304 + (round_no % 5) * 0.0001,
                lon=121.4737 + (round_no % 5) * 0.0001,
            )
            _telemetry(client, args.device_uid, "battery", value=battery)
            _publish(
                client,
                f"iot/v1/{args.device_uid}/status",
                {
                    "device_uid": args.device_uid,
                    "ts": _now(),
                    "battery": battery,
                },
            )
            print(f"[{round_no}] 已上报一轮遥测/状态（电量 {battery}%）")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n模拟设备已停止")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
