"""Immutable uploads and their released references."""
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, INNODB


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
