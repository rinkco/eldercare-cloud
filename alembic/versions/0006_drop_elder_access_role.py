"""移除 elder_access.role：家属成员不再区分 owner / member

SPEC 04：family 成员统一权限，成员角色（主照护者 / 普通成员）概念取消。
upgrade 删除角色列与检查约束；downgrade 恢复列并沿用 0004 的回填策略
（存量行写为 owner），保证回滚后仍有账号可以管理成员。

Revision ID: 0006_drop_elder_access_role
Revises: 0005_lora_support
Create Date: 2026-10-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_drop_elder_access_role"
down_revision: Union[str, None] = "0005_lora_support"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_elder_access_role", "elder_access", type_="check")
    op.drop_column("elder_access", "role")


def downgrade() -> None:
    op.add_column(
        "elder_access",
        sa.Column(
            "role",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'member'"),
        ),
    )
    # 与 0004 一致：回滚后至少保留一位可管理成员的账号
    op.execute("UPDATE elder_access SET role = 'owner'")
    op.create_check_constraint(
        "ck_elder_access_role", "elder_access", "role IN ('owner', 'member')"
    )
