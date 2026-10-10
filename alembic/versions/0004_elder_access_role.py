"""elder_access 增加 owner/member 成员角色

迁移前 elder_access 只有“访问关系”一种语义，且每行都是当时唯一的照护人；
upgrade 把存量行回填为 owner（主照护者），新关联默认 member（普通成员）。

Revision ID: 0004_elder_access_role
Revises: 0003_role_model_and_index
Create Date: 2026-10-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_elder_access_role"
down_revision: Union[str, None] = "0003_role_model_and_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "elder_access",
        sa.Column(
            "role",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'member'"),
        ),
    )
    # 存量关联行统一视为主照护者，避免升级后没有账号能管理成员
    op.execute("UPDATE elder_access SET role = 'owner'")
    op.create_check_constraint(
        "ck_elder_access_role", "elder_access", "role IN ('owner', 'member')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_elder_access_role", "elder_access", type_="check")
    op.drop_column("elder_access", "role")
