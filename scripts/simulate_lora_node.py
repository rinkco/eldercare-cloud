"""LoRa 节点 + 网关模拟器（无需真实 LoRa 硬件）。

它扮演 LoRaWAN 网络服务器：把节点 JSON 载荷封装成 ChirpStack v4 风格的上行报文，
发布到 `application/{app}/device/{devEui}/event/up`；`lora_gateway_bridge.py`
订阅该 Topic 并转发为平台契约。

用法（容器内，先启动桥接）：
    docker compose exec backend python -m scripts.lora_gateway_bridge
    docker compose exec backend python -m scripts.simulate_lora_node --scenario heart
    docker compose exec backend python -m scripts.simulate_lora_node --scenario fall
    docker compose exec backend python -m scripts.simulate_lora_node --scenario mix --count 5

注意：设备 UID 必须先在管理台注册（kind=lora_node）并绑定老人，
默认 UID 为 `lora-node-0001`。
"""

from __future__ import annotations

import argparse
import base64
import json
import time
import uuid
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from app.config import settings


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_uplink(
    *,
    dev_eui: str,
    gateway_eui: str,
    node_payload: dict,
    rssi: float,
    snr: float,
    spreading_factor: int,
    frequency: float,
    frame_count: int,
) -> dict:
    """把节点 JSON 封装成 ChirpStack 风格的上行报文。"""
    data = base64.b64encode(
        json.dumps(node_payload, separators=(",", ":"), ensure_ascii=False).encode(
            "utf-8"
        )
    ).decode("ascii")
    return {
        "deviceInfo": {"devEui": dev_eui, "deviceName": dev_eui},
        "rxInfo": [
            {"gatewayId": gateway_eui, "rssi": rssi, "snr": snr}
        ],
        "txInfo": {
            "frequency": frequency,
            "modulation": {
                "lora": {"spreadingFactor": spreading_factor, "bandwidth": 125000}
            },
        },
        "fCnt": frame_count,
        "fPort": 1,
        "data": data,
    }


def scenario_payloads(scenario: str, round_no: int) -> list[dict]:
    """返回一轮要发送的节点载荷列表。"""
    if scenario == "heart":
        return [{"m": "hr", "v": 72 + round_no % 10}]
    if scenario == "spo2":
        return [{"m": "spo2", "v": 96 + round_no % 3}]
    if scenario == "location":
        return [{"m": "loc", "lat": 31.2304, "lon": 121.4737}]
    if scenario == "fall":
        return [
            {
                "e": "fall",
                "sev": "critical",
                "cf": 0.92,
                "p": {"source": "lora-node", "accel_g": 3.1},
            }
        ]
    if scenario == "sos":
        return [
            {
                "e": "sos",
                "sev": "critical",
                "p": {"source": "lora-button"},
            }
        ]
    if scenario == "low-battery":
        # 先 80% 再 15%，跨越平台 20% 阈值触发低电量告警
        return [{"m": "bat", "v": 80}, {"m": "bat", "v": 15}]
    # mix：常规遥测 + 每 5 轮一次跌倒
    payloads: list[dict] = [
        {"m": "hr", "v": 70 + round_no % 20},
        {"m": "spo2", "v": 96 + round_no % 3},
        {"m": "steps", "v": 50},
        {"m": "bat", "v": max(15, 90 - round_no)},
    ]
    if round_no % 5 == 0:
        payloads.append(
            {
                "e": "fall",
                "sev": "critical",
                "cf": 0.9,
                "p": {"source": "lora-node", "accel_g": 3.0},
            }
        )
    return payloads


def main() -> None:
    parser = argparse.ArgumentParser(description="LoRa 节点/网关模拟器")
    parser.add_argument("--dev-eui", default="lora-node-0001")
    parser.add_argument("--gateway-eui", default="lora-gw-0001")
    parser.add_argument("--app", default="eldercare-demo")
    parser.add_argument(
        "--scenario",
        choices=[
            "heart",
            "spo2",
            "location",
            "fall",
            "sos",
            "low-battery",
            "mix",
        ],
        default="heart",
    )
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--count", type=int, default=0, help="mix 轮数，0 表示无限")
    parser.add_argument("--rssi", type=float, default=-87.0)
    parser.add_argument("--snr", type=float, default=8.5)
    parser.add_argument("--sf", type=int, default=7)
    parser.add_argument("--freq", type=float, default=470.3)
    args = parser.parse_args()

    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"lora-sim-{uuid.uuid4().hex[:8]}",
    )
    client.username_pw_set(settings.mqtt_user, settings.mqtt_password)
    client.connect(settings.mqtt_host, settings.mqtt_port, keepalive=30)
    client.loop_start()
    topic = f"application/{args.app}/device/{args.dev_eui}/event/up"

    try:
        frame_count = 0
        round_no = 0
        while True:
            round_no += 1
            for node_payload in scenario_payloads(args.scenario, round_no):
                frame_count += 1
                uplink = build_uplink(
                    dev_eui=args.dev_eui,
                    gateway_eui=args.gateway_eui,
                    node_payload=node_payload,
                    rssi=args.rssi,
                    snr=args.snr,
                    spreading_factor=args.sf,
                    frequency=args.freq,
                    frame_count=frame_count,
                )
                info = client.publish(
                    topic,
                    json.dumps(uplink, ensure_ascii=False),
                    qos=1,
                )
                info.wait_for_publish(timeout=5)
                print(
                    f"[{_now()}] 已发送 LoRa 上行 fCnt={frame_count} "
                    f"payload={node_payload}"
                )
                time.sleep(0.2)

            single_shot = args.scenario not in ("mix",)
            if single_shot:
                break
            if args.count and round_no >= args.count:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nLoRa 模拟器已停止")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
