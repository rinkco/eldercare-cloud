"""支持 LoRa 节点与网关元数据

- devices.kind 增加 lora_node：LoRa 节点注册后仍按 devices.elder_id 绑定老人。
- telemetry / events 增加 meta_json：存放网关与链路元数据，例如
  {"transport":"lora","gateway_eui":"...","rssi":-87,"snr":8.5,"sf":7,"freq":470.3}。

Revision ID: 0005_lora_support
Revises: 0004_elder_access_role
Create Date: 2026-10-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_lora_support"
down_revision: Union[str, None] = "0004_elder_access_role"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_devices_kind", "devices", type_="check")
    op.create_check_constraint(
        "ck_devices_kind",
        "devices",
        "kind IN ('esp32', 'phone', 'wearable', 'lora_node')",
    )
    for table in ("telemetry", "events"):
        op.add_column(
            table,
            sa.Column(
                "meta_json",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
        )


def downgrade() -> None:
    for table in ("telemetry", "events"):
        op.drop_column(table, "meta_json")
    op.drop_constraint("ck_devices_kind", "devices", type_="check")
    op.create_check_constraint(
        "ck_devices_kind",
        "devices",
        "kind IN ('esp32', 'phone', 'wearable')",
    )
