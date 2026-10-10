"""LoRa 网关桥接映射单元测试（无需数据库与 MQTT）。"""

import base64
import json

import pytest

from scripts.lora_gateway_bridge import (
    build_platform_messages,
    decode_data_field,
    extract_uplink,
)


def _chirpstack_uplink(node_payload: dict, *, dev_eui: str = "lora-node-0001") -> dict:
    return {
        "deviceInfo": {"devEui": dev_eui},
        "rxInfo": [
            {"gatewayId": "lora-gw-0001", "rssi": -87, "snr": 8.5}
        ],
        "txInfo": {
            "frequency": 470.3,
            "modulation": {"lora": {"spreadingFactor": 7}},
        },
        "fCnt": 12,
        "fPort": 1,
        "data": base64.b64encode(
            json.dumps(node_payload).encode("utf-8")
        ).decode("ascii"),
    }


def test_decode_data_field_accepts_base64_and_plain_json() -> None:
    encoded = base64.b64encode(b'{"m":"hr","v":78}').decode("ascii")
    assert decode_data_field(encoded) == {"m": "hr", "v": 78}
    assert decode_data_field('{"m":"spo2","v":97}') == {"m": "spo2", "v": 97}


def test_extract_uplink_reads_device_and_lora_meta() -> None:
    dev_eui, node_payload, meta = extract_uplink(
        _chirpstack_uplink({"m": "hr", "v": 78})
    )

    assert dev_eui == "lora-node-0001"
    assert node_payload == {"m": "hr", "v": 78}
    assert meta["transport"] == "lora"
    assert meta["gateway_eui"] == "lora-gw-0001"
    assert meta["rssi"] == -87
    assert meta["snr"] == 8.5
    assert meta["sf"] == 7
    assert meta["freq"] == 470.3
    assert meta["fcnt"] == 12
    assert meta["fport"] == 1


def test_build_telemetry_message_with_short_alias() -> None:
    messages = build_platform_messages(
        "lora-node-0001",
        {"m": "hr", "v": 78},
        {"transport": "lora", "rssi": -87},
    )

    assert len(messages) == 1
    topic, body = messages[0]
    assert topic == "iot/v1/lora-node-0001/telemetry"
    assert body["device_uid"] == "lora-node-0001"
    assert body["metric"] == "heart_rate"
    assert body["value"] == 78
    assert body["meta"]["rssi"] == -87


def test_build_telemetry_message_with_long_form_and_prefix() -> None:
    messages = build_platform_messages(
        "0001",
        {"metric": "location", "lat": 31.23, "lon": 121.47, "ts": "2026-10-10T08:00:00Z"},
        {"transport": "lora"},
        uid_prefix="lora-node-",
    )

    topic, body = messages[0]
    assert topic == "iot/v1/lora-node-0001/telemetry"
    assert body["metric"] == "location"
    assert body["lat"] == 31.23
    assert body["lon"] == 121.47
    assert body["ts"] == "2026-10-10T08:00:00Z"


def test_build_event_message_maps_severity_and_confidence() -> None:
    messages = build_platform_messages(
        "lora-node-0001",
        {
            "e": "fall",
            "sev": "c",
            "cf": 0.92,
            "p": {"source": "lora-node", "accel_g": 3.1},
        },
        {"transport": "lora", "sf": 7},
    )

    assert len(messages) == 1
    topic, body = messages[0]
    assert topic == "iot/v1/lora-node-0001/event"
    assert body["type"] == "fall"
    assert body["severity"] == "critical"
    assert body["confidence"] == 0.92
    assert body["payload"] == {"source": "lora-node", "accel_g": 3.1}
    assert body["meta"]["sf"] == 7


def test_build_returns_empty_for_unknown_payload() -> None:
    assert build_platform_messages("node", {"m": "unknown"}, {}) == []
    assert build_platform_messages("node", {"nothing": 1}, {}) == []


def test_extract_uplink_validates_shapes() -> None:
    with pytest.raises(ValueError):
        extract_uplink("not-a-dict")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        extract_uplink({"deviceInfo": "bad", "data": "{}"})
    with pytest.raises(ValueError):
        extract_uplink(
            {"deviceInfo": {"devEui": "x"}, "rxInfo": "bad", "data": "{}"}
        )


def test_missing_ts_uses_network_server_time() -> None:
    uplink = _chirpstack_uplink({"m": "hr", "v": 78})
    uplink["time"] = "2026-10-10T08:00:00Z"

    dev_eui, node_payload, meta = extract_uplink(uplink)
    assert meta["ns_time"] == "2026-10-10T08:00:00Z"

    first = build_platform_messages(dev_eui, node_payload, meta)
    second = build_platform_messages(dev_eui, node_payload, meta)
    assert first[0][1]["ts"] == "2026-10-10T08:00:00Z"
    assert second[0][1]["ts"] == "2026-10-10T08:00:00Z"


def test_invalid_telemetry_payloads_are_skipped() -> None:
    assert build_platform_messages("node", {"m": "loc", "lat": 31.2}, {}) == []
    assert build_platform_messages("node", {"m": "hr"}, {}) == []
    assert build_platform_messages("node", {"m": "act", "vt": ""}, {}) == []
