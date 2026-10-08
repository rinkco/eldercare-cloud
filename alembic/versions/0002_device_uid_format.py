"""限制 device_uid 字符集，避免破坏 MQTT 主题层级

Revision ID: 0002_device_uid_format
Revises: e58a0da2589b
Create Date: 2026-10-08
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0002_device_uid_format"
down_revision: Union[str, None] = "e58a0da2589b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_devices_uid_format",
        "devices",
        "device_uid ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'",
    )


def downgrade() -> None:
    op.drop_constraint("ck_devices_uid_format", "devices", type_="check")
