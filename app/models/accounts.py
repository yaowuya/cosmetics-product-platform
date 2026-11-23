"""Instance accounts, revocable sessions and durable audit events."""
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, Index, JSON, String, UniqueConstraint, text
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, INNODB


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
