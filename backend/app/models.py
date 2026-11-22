"""MySQL identities, draft/release storage and durable authorization records."""
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, Integer, JSON, String, UniqueConstraint, text
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

INNODB = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"}
SLOTS = ("home_posters", "catalog_cover", "directory", "case_header", "services", "business_contact")
SLOT_CHECK = (
    "(kind IN ('product','case') AND config_slot IS NULL) OR "
    "(kind = 'config' AND config_slot IS NOT NULL AND config_slot IN ("
    + ",".join(repr(slot) for slot in SLOTS) + "))"
)


class Base(DeclarativeBase):
    """Single mapping base with no inherited business fields."""


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


class Account(Base):
    """Separate content, release and account-management capabilities."""

    __tablename__ = "account"
    __table_args__ = (
        UniqueConstraint("login", name="uq_account_login"),
        CheckConstraint("can_publish = 0 OR can_edit = 1", name="ck_publish_requires_edit"),
        INNODB,
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    login: Mapped[str] = mapped_column(String(190))
    password_hash: Mapped[str] = mapped_column(String(255))
    enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("1"))
    can_edit: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    can_publish: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    can_manage: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    must_change_password: Mapped[bool] = mapped_column(Boolean, server_default=text("1"))


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


class Asset(Base):
    """Persist one immutable storage key and the original uploader for each registered image."""

    __tablename__ = "asset"
    __table_args__ = (UniqueConstraint("storage_key", name="uq_asset_key"), INNODB)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    storage_key: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(100))
    bytes: Mapped[int] = mapped_column(BigInteger)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), server_default=text("CURRENT_TIMESTAMP(6)"))


class ReleaseAsset(Base):
    """Keep reverse lookup of images referenced by snapshots for visibility checks."""

    __tablename__ = "release_asset"
    __table_args__ = (Index("ix_release_asset_reverse", "asset_id", "release_id"), INNODB)
    release_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("release.id"), primary_key=True)
    asset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset.id"), primary_key=True)


class UserSession(Base):
    """Only the token digest is stored; current capabilities live on the account."""

    __tablename__ = "session"
    __table_args__ = INNODB
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("account.id"))
    expires_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6))


class Audit(Base):
    """Durable event detail, deliberately independent of a target row's lifetime."""

    __tablename__ = "audit"
    __table_args__ = (
        UniqueConstraint("request_key", name="uq_audit_request_key"),
        Index("ix_audit_target", "target_kind", "target_id", "occurred_at"),
        Index("ix_audit_actor", "actor_id", "occurred_at"),
        INNODB,
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    actor_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("account.id"))
    action: Mapped[str] = mapped_column(String(32))
    target_kind: Mapped[str] = mapped_column(String(32))
    target_id: Mapped[int] = mapped_column(BigInteger)
    occurred_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), server_default=text("CURRENT_TIMESTAMP(6)"))
    details: Mapped[dict[str, Any]] = mapped_column(JSON)
    request_key: Mapped[str | None] = mapped_column(String(128))
