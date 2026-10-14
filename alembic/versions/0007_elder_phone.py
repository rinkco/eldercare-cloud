"""老人档案手机号（SPEC 06）

elders 新增 phone（可空 + 唯一索引）：手机号作为老人的身份标识，
新建老人必填、全局唯一，家属可用手机号「添加老人」绑定自己。
列可空是为了兼容存量档案（历史数据保持 NULL，不影响既有功能）；
PostgreSQL 唯一索引允许多个 NULL 并存，因此无需部分索引。

Revision ID: 0007_elder_phone
Revises: 0006_drop_elder_access_role
Create Date: 2026-10-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_elder_phone"
down_revision: Union[str, None] = "0006_drop_elder_access_role"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "elders", sa.Column("phone", sa.String(length=32), nullable=True)
    )
    op.create_index("uq_elders_phone", "elders", ["phone"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_elders_phone", table_name="elders")
    op.drop_column("elders", "phone")
