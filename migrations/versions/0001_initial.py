"""Create the initial InnoDB schema; this migration never inserts business data."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

TABLE = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"}


def upgrade() -> None:
    """Create stable identities and version constraints, then close the live-pointer cycle."""
    op.create_table(
        "account",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("login", sa.String(190), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("can_edit", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("can_publish", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("can_manage", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.UniqueConstraint("login", name="uq_account_login"),
        sa.CheckConstraint("can_publish = 0 OR can_edit = 1", name="ck_publish_requires_edit"), **TABLE,
    )
    op.create_table(
        "content_item",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("config_slot", sa.String(32)),
        sa.Column("live_id", sa.BigInteger()),
        sa.Column("revision", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("archived_at", DATETIME(fsp=6)),
        sa.UniqueConstraint("config_slot", name="uq_config_slot"),
        sa.CheckConstraint(
            "(kind IN ('product','case') AND config_slot IS NULL) OR "
            "(kind = 'config' AND config_slot IS NOT NULL AND config_slot IN "
            "('home_posters','catalog_cover','directory','case_header','services','business_contact'))",
            name="ck_content_slot",
        ),
        sa.CheckConstraint("archived_at IS NULL OR live_id IS NULL", name="ck_archived_not_live"), **TABLE,
    )
    op.create_index("ix_content_kind_archive", "content_item", ["kind", "archived_at", "id"])
    op.create_table("directory_node", sa.Column("id", sa.BigInteger(), primary_key=True), **TABLE)
    op.create_table(
        "draft",
        sa.Column("item_id", sa.BigInteger(), sa.ForeignKey("content_item.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("body", sa.JSON(), nullable=False),
        sa.Column("edited_by", sa.BigInteger(), sa.ForeignKey("account.id"), nullable=False),
        sa.Column("edited_at", DATETIME(fsp=6), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP(6)")), **TABLE,
    )
    op.create_table(
        "release",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("item_id", sa.BigInteger(), sa.ForeignKey("content_item.id"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("source_revision", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.JSON(), nullable=False),
        sa.Column("actor_id", sa.BigInteger(), sa.ForeignKey("account.id"), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP(6)")),
        sa.UniqueConstraint("item_id", "id", name="uq_release_owner_id"),
        sa.UniqueConstraint("item_id", "seq", name="uq_release_owner_seq"),
        sa.UniqueConstraint("item_id", "source_revision", name="uq_release_owner_revision"), **TABLE,
    )
    # 引用同时带条目及版本，错误条目的合法版本也不会成为线上版。
    op.create_foreign_key("fk_content_own_live", "content_item", "release", ["id", "live_id"], ["item_id", "id"])
    op.create_table(
        "draft_place",
        sa.Column("item_id", sa.BigInteger(), sa.ForeignKey("draft.item_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("node_id", sa.BigInteger(), sa.ForeignKey("directory_node.id"), primary_key=True), **TABLE,
    )
    op.create_table(
        "release_place",
        sa.Column("release_id", sa.BigInteger(), sa.ForeignKey("release.id"), primary_key=True),
        sa.Column("node_id", sa.BigInteger(), sa.ForeignKey("directory_node.id"), primary_key=True), **TABLE,
    )
    op.create_index("ix_release_place_node", "release_place", ["node_id", "release_id"])
    op.create_table(
        "asset",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("storage_key", sa.String(255), nullable=False),
        sa.Column("mime", sa.String(100), nullable=False),
        sa.Column("bytes", sa.BigInteger(), nullable=False),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("account.id"), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP(6)")),
        sa.UniqueConstraint("storage_key", name="uq_asset_key"), **TABLE,
    )
    op.create_table(
        "release_asset",
        sa.Column("release_id", sa.BigInteger(), sa.ForeignKey("release.id"), primary_key=True),
        sa.Column("asset_id", sa.BigInteger(), sa.ForeignKey("asset.id"), primary_key=True), **TABLE,
    )
    op.create_index("ix_release_asset_reverse", "release_asset", ["asset_id", "release_id"])
    op.create_table(
        "session",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("account_id", sa.BigInteger(), sa.ForeignKey("account.id"), nullable=False),
        sa.Column("expires_at", DATETIME(fsp=6), nullable=False), **TABLE,
    )
    op.create_table(
        "audit",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("actor_id", sa.BigInteger(), sa.ForeignKey("account.id"), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("target_kind", sa.String(32), nullable=False),
        sa.Column("target_id", sa.BigInteger(), nullable=False),
        sa.Column("occurred_at", DATETIME(fsp=6), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP(6)")),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("request_key", sa.String(128)),
        sa.UniqueConstraint("request_key", name="uq_audit_request_key"), **TABLE,
    )
    op.create_index("ix_audit_actor", "audit", ["actor_id", "occurred_at"])
    op.create_index("ix_audit_target", "audit", ["target_kind", "target_id", "occurred_at"])


def downgrade() -> None:
    """Do not drop published content via a destructive initial-migration downgrade."""
    raise RuntimeError("Initial schema downgrade requires restoring an approved consistent backup")
