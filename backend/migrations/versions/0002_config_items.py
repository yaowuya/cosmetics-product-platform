"""Reserve fixed configuration identities without inserting draft or released content."""
from alembic import op
import sqlalchemy as sa

revision = "0002_config_items"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Each site location receives an empty, stable item in the new tenant schema."""
    table = sa.table("content_item", sa.column("kind", sa.String()), sa.column("config_slot", sa.String()))
    op.bulk_insert(table, [{"kind": "config", "config_slot": slot} for slot in (
        "home_posters", "catalog_cover", "directory", "case_header", "services", "business_contact",
    )])


def downgrade() -> None:
    """Do not remove stable identities that may already own versions."""
    raise RuntimeError("Fixed configuration identities require a coordinated backup restore to roll back")
