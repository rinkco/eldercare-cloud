"""SPEC 01 步骤 3：密码哈希与 JWT 单元测试。"""

import secrets
from datetime import datetime, timezone

import jwt
import pytest

from app.config import (
    PLACEHOLDER_JWT_SECRET,
    settings,
    validate_security_settings,
)
from app.security import (
    TokenError,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_password_hash_roundtrip() -> None:
    password_hash = hash_password("correct-horse-battery-staple")

    assert password_hash != "correct-horse-battery-staple"
    assert verify_password("correct-horse-battery-staple", password_hash) is True
    assert verify_password("wrong-password", password_hash) is False


def test_password_longer_than_72_bytes_is_rejected() -> None:
    with pytest.raises(ValueError):
        hash_password("a" * 73)


def test_password_of_exactly_72_bytes_is_accepted() -> None:
    password = "a" * 72

    password_hash = hash_password(password)

    assert verify_password(password, password_hash) is True


def test_verify_password_returns_false_for_over_long_password() -> None:
    password_hash = hash_password("normal-password")

    assert verify_password("a" * 73, password_hash) is False


def test_access_token_roundtrip() -> None:
    token = create_access_token(user_id=42, role="family")

    payload = decode_access_token(token)

    assert payload["sub"] == "42"
    assert payload["role"] == "family"


def test_expired_token_is_rejected() -> None:
    token = create_access_token(user_id=42, role="admin", expires_minutes=-1)

    with pytest.raises(TokenError):
        decode_access_token(token)


def test_tampered_token_is_rejected() -> None:
    token = create_access_token(user_id=42, role="admin")

    with pytest.raises(TokenError):
        decode_access_token(token + "tampered")


def test_token_without_exp_claim_is_rejected() -> None:
    token = jwt.encode(
        {"sub": "42", "iat": datetime.now(timezone.utc), "role": "admin"},
        settings.jwt_secret,
        algorithm="HS256",
    )

    with pytest.raises(TokenError):
        decode_access_token(token)


def test_token_signed_with_another_key_is_rejected() -> None:
    token = jwt.encode(
        {
            "sub": "42",
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc),
            "role": "admin",
        },
        secrets.token_urlsafe(48),
        algorithm="HS256",
    )

    with pytest.raises(TokenError):
        decode_access_token(token)


def test_unsigned_token_is_rejected() -> None:
    token = jwt.encode(
        {"sub": "42", "iat": datetime.now(timezone.utc), "exp": datetime.now(timezone.utc)},
        key="",
        algorithm="none",
    )

    with pytest.raises(TokenError):
        decode_access_token(token)


def test_validate_security_settings_rejects_placeholders() -> None:
    with pytest.raises(RuntimeError):
        validate_security_settings(PLACEHOLDER_JWT_SECRET)
    with pytest.raises(RuntimeError):
        validate_security_settings("change-me-jwt")
    with pytest.raises(RuntimeError):
        validate_security_settings("too-short")


def test_validate_security_settings_accepts_random_secret() -> None:
    validate_security_settings(secrets.token_urlsafe(48))
