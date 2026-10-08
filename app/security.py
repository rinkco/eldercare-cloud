"""密码哈希与 JWT 工具。"""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings

ALGORITHM = "HS256"


class TokenError(Exception):
    """JWT 无效、被篡改或已过期。"""


def hash_password(password: str) -> str:
    """生成 bcrypt 密码哈希。"""
    return bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """校验密码与哈希是否匹配。"""
    try:
        return bcrypt.checkpw(
            _password_bytes(password), password_hash.encode("utf-8")
        )
    except ValueError:
        return False


def create_access_token(
    user_id: int, role: str, expires_minutes: int | None = None
) -> str:
    """签发 HS256 JWT。"""
    now = datetime.now(timezone.utc)
    minutes = (
        expires_minutes if expires_minutes is not None else settings.jwt_expire_minutes
    )
    payload = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """解析并校验 JWT，失败抛出 TokenError。"""
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise TokenError("JWT 无效或已过期") from exc


def _password_bytes(password: str) -> bytes:
    data = password.encode("utf-8")
    if len(data) > 72:
        raise ValueError("密码超过 bcrypt 的 72 字节上限")
    return data
