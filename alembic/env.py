"""Alembic 环境：连接串从应用配置读取，元数据来自 app.models。"""

from logging.config import fileConfig
import os

from alembic import context
from sqlalchemy import create_engine, pool

from app.config import settings
from app.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# 允许测试/运维通过环境变量覆盖目标数据库（默认使用应用配置）
DATABASE_URL = os.environ.get("ALEMBIC_DATABASE_URL") or settings.database_url


def run_migrations_offline() -> None:
    """离线模式：只生成 SQL，不连接数据库。"""
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        compare_server_default=True,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """在线模式：在真实数据库上执行迁移。"""
    connectable = create_engine(DATABASE_URL, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_server_default=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
