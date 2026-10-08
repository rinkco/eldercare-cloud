"""应用配置：全部从环境变量读取（Docker Compose 已按服务注入）。"""

from functools import lru_cache
from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict

PLACEHOLDER_JWT_SECRET = "please-generate-a-random-secret-32-bytes-min"


class Settings(BaseSettings):
    """SPEC 01 所需的运行配置。"""

    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    # PostgreSQL
    postgres_user: str = "eldercare"
    postgres_password: str = "change-me-postgres"
    postgres_db: str = "eldercare"
    postgres_host: str = "postgres"
    postgres_port: int = 5432

    # MQTT
    mqtt_user: str = "eldercare"
    mqtt_password: str = "change-me-mqtt"
    mqtt_host: str = "mosquitto"
    mqtt_port: int = 1883

    # JWT
    jwt_secret: str = PLACEHOLDER_JWT_SECRET
    jwt_expire_minutes: int = 720

    @property
    def database_url(self) -> str:
        """生成 SQLAlchemy 连接串，密码做 URL 编码。"""
        user = quote_plus(self.postgres_user)
        password = quote_plus(self.postgres_password)
        return (
            f"postgresql+psycopg://{user}:{password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


def validate_security_settings(jwt_secret: str) -> None:
    """启动期安全校验：拒绝占位值或过短的 JWT 密钥（fail fast）。"""
    if (
        jwt_secret == PLACEHOLDER_JWT_SECRET
        or "change-me" in jwt_secret.lower()
        or len(jwt_secret.encode("utf-8")) < 32
    ):
        raise RuntimeError(
            "JWT_SECRET 必须是至少 32 字节的随机值。请在 .env 中生成，例如："
            'python -c "import secrets; print(secrets.token_urlsafe(48))"'
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
