"""收敛角色模型并新增 elder_access 索引

注意：upgrade 会把存量 elder 账号改写为 family，原始角色映射不可推导，
因此数据转换不可逆；downgrade 只恢复约束与索引结构，不回滚账号角色。

Revision ID: 0003_role_model_and_index
Revises: 0002_device_uid_format
Create Date: 2026-10-08
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0003_role_model_and_index"
down_revision: Union[str, None] = "0002_device_uid_format"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # elder 与 family 共用一个账号：存量 elder 账号并入 family
    op.execute("UPDATE users SET role = 'family' WHERE role = 'elder'")
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint(
        "ck_users_role", "users", "role IN ('admin', 'family')"
    )
    op.create_index("ix_elder_access_user_id", "elder_access", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_elder_access_user_id", table_name="elder_access")
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint(
        "ck_users_role", "users", "role IN ('admin', 'family', 'elder')"
    )
