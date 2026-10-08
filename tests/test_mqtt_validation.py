"""SPEC 01 步骤 6：MQTT 载荷校验单元测试。"""

import pytest

from app.mqtt.validation import (
    PayloadError,
    decode_json,
    parse_event,
    parse_status,
    parse_telemetry,
    parse_topic,
)

TS = "2026-10-08T02:00:00Z"


def test_parse_topic_ok() -> None:
    assert parse_topic("iot/v1/esp32-0001/telemetry") == (
        "esp32-0001",
        "telemetry",
    )


@pytest.mark.parametrize(
    "topic",
    [
        "iot/v1/esp32-0001/unknown",
        "iot/v2/esp32-0001/telemetry",
        "iot/v1//telemetry",
        "iot/v1/esp32-0001",
    ],
)
def test_parse_topic_rejects_invalid(topic: str) -> None:
    with pytest.raises(PayloadError):
        parse_topic(topic)


def test_decode_json_requires_object() -> None:
    with pytest.raises(PayloadError):
        decode_json(b"[1, 2, 3]")
    with pytest.raises(PayloadError):
        decode_json(b"not-json")


def test_decode_json_rejects_nan_and_infinity() -> None:
    with pytest.raises(PayloadError):
        decode_json(b'{"value": NaN}')
    with pytest.raises(PayloadError):
        decode_json(b'{"value": Infinity}')


def test_parse_telemetry_heart_rate() -> None:
    message = parse_telemetry(
        {"metric": "heart_rate", "value": 78, "ts": TS}
    )

    assert message.metric == "heart_rate"
    assert message.value_num == 78
    assert message.recorded_at.tzinfo is not None


def test_parse_telemetry_location() -> None:
    message = parse_telemetry(
        {"metric": "location", "lat": 31.2304, "lon": 121.4737, "ts": TS}
    )

    assert message.lat == pytest.approx(31.2304)
    assert message.lon == pytest.approx(121.4737)


def test_parse_telemetry_rejects_bad_values() -> None:
    with pytest.raises(PayloadError):
        parse_telemetry({"metric": "unknown", "value": 1, "ts": TS})
    with pytest.raises(PayloadError):
        parse_telemetry({"metric": "heart_rate", "ts": TS})
    with pytest.raises(PayloadError):
        parse_telemetry({"metric": "battery", "value": 120, "ts": TS})
    with pytest.raises(PayloadError):
        parse_telemetry(
            {"metric": "location", "lat": 91, "lon": 0, "ts": TS}
        )
    with pytest.raises(PayloadError):
        parse_telemetry(
            {"metric": "heart_rate", "value": 78, "ts": "2026-10-08T02:00:00"}
        )
    with pytest.raises(PayloadError):
        parse_telemetry(
            {"metric": "spo2", "value": 101, "ts": TS}
        )
    with pytest.raises(PayloadError):
        parse_telemetry(
            {"metric": "steps", "value": -1, "ts": TS}
        )
    with pytest.raises(PayloadError):
        parse_telemetry(
            {"metric": "heart_rate", "value": float("nan"), "ts": TS}
        )
    with pytest.raises(PayloadError):
        parse_telemetry(
            {"metric": "battery", "value": 10**400, "ts": TS}
        )


def test_parse_event_ok() -> None:
    message = parse_event(
        {
            "type": "fall",
            "severity": "critical",
            "confidence": 0.97,
            "payload": {"source": "mpu6050"},
            "ts": TS,
        }
    )

    assert message.type == "fall"
    assert message.severity == "critical"
    assert message.confidence == pytest.approx(0.97)


def test_parse_event_rejects_bad_payload() -> None:
    with pytest.raises(PayloadError):
        parse_event({"type": "fire", "severity": "critical", "ts": TS})
    with pytest.raises(PayloadError):
        parse_event({"type": "fall", "severity": "huge", "ts": TS})
    with pytest.raises(PayloadError):
        parse_event(
            {
                "type": "fall",
                "severity": "critical",
                "confidence": 1.5,
                "ts": TS,
            }
        )


def test_parse_status_ok() -> None:
    message = parse_status({"battery": 55, "ts": TS})

    assert message.battery_percent == 55


def test_parse_status_rejects_bad_battery() -> None:
    with pytest.raises(PayloadError):
        parse_status({"battery": 101, "ts": TS})
    with pytest.raises(PayloadError):
        parse_status({"battery": "full", "ts": TS})
