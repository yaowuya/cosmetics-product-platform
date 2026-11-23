"""Shared SQLAlchemy registry and MySQL table options."""
from sqlalchemy.orm import DeclarativeBase

INNODB = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"}


class Base(DeclarativeBase):
    """Single mapping base with no inherited business fields."""
