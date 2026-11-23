"""Stable item identities, editable drafts, immutable releases and their positions."""
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, Integer, JSON, String, UniqueConstraint, text
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, INNODB

SLOTS = ("home_posters", "catalog_cover", "directory", "case_header", "services", "business_contact")
SLOT_CHECK = (
    "(kind IN ('product','case') AND config_slot IS NULL) OR "
    "(kind = 'config' AND config_slot IS NOT NULL AND config_slot IN ("
    + ",".join(repr(slot) for slot in SLOTS) + "))"
)


class ContentItem(Base):
    """Stable item identity; only a release owned by the same item can be live."""

    __tablename__ = "content_item"
    __table_args__ = (
        UniqueConstraint("config_slot", name="uq_config_slot"),
        CheckConstraint(SLOT_CHECK, name="ck_content_slot"),
        CheckConstraint("archived_at IS NULL OR live_id IS NULL", name="ck_archived_not_live"),
        Index("ix_content_kind_archive", "kind", "archived_at", "id"),
        # Creating the live pointer after both tables avoids resolving the FK cycle at creation.
        ForeignKeyConstraint(["id", "live_id"], ["release.item_id", "release.id"],
                             name="fk_content_own_live", use_alter=True),
        INNODB,
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(16))
    config_slot: Mapped[str | None] = mapped_column(String(32))
    live_id: Mapped[int | None] = mapped_column(BigInteger)
    revision: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    archived_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6))


class Draft(Base):
    """At most one editable copy per item; business fields may be incomplete."""

    __tablename__ = "draft"
    __table_args__ = INNODB
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("content_item.id", ondelete="CASCADE"), primary_key=True)
    body: Mapped[dict[str, Any]] = mapped_column(JSON)
    edited_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("account.id"))
    edited_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), server_default=text("CURRENT_TIMESTAMP(6)"))


class Release(Base):
    """Complete publication snapshot; one version per consumed draft revision."""

    __tablename__ = "release"
    __table_args__ = (
        UniqueConstraint("item_id", "id", name="uq_release_owner_id"),
        UniqueConstraint("item_id", "seq", name="uq_release_owner_seq"),
        UniqueConstraint("item_id", "source_revision", name="uq_release_owner_revision"),
        INNODB,
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("content_item.id"))
    seq: Mapped[int] = mapped_column(Integer)
    source_revision: Mapped[int] = mapped_column(BigInteger)
    body: Mapped[dict[str, Any]] = mapped_column(JSON)
    actor_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), server_default=text("CURRENT_TIMESTAMP(6)"))


class DirectoryNode(Base):
    """Node identity remains stable when the released directory changes labels or order."""

    __tablename__ = "directory_node"
    __table_args__ = INNODB
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)


class DraftPlace(Base):
    """A draft references a directory node at most once."""

    __tablename__ = "draft_place"
    __table_args__ = INNODB
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("draft.item_id", ondelete="CASCADE"), primary_key=True)
    node_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("directory_node.id"), primary_key=True)


class ReleasePlace(Base):
    """Published placement association, indexed for directory-to-version lookup."""

    __tablename__ = "release_place"
    __table_args__ = (Index("ix_release_place_node", "node_id", "release_id"), INNODB)
    release_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("release.id"), primary_key=True)
    node_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("directory_node.id"), primary_key=True)
