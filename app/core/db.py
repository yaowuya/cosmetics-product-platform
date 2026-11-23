"""Create tenant-local MySQL sessions without mutating the schema at startup."""
from collections.abc import Iterator
from functools import lru_cache
import os

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session


def database_url() -> str:
    """Return the configured MySQL DSN or fail without exposing credentials."""
    value = os.environ.get("DATABASE_URL")
    if not value or make_url(value).drivername != "mysql+pymysql":
        raise RuntimeError("DATABASE_URL must point to this instance's mysql+pymysql database")
    return value


@lru_cache(maxsize=1)
def engine() -> Engine:
    """Create the connection pool lazily and set every connection's clock to UTC."""
    db = create_engine(database_url(), pool_pre_ping=True, hide_parameters=True)

    @event.listens_for(db, "connect")
    def set_utc(connection, _record):
        with connection.cursor() as cursor:
            cursor.execute("SET SESSION time_zone = '+00:00'")

    return db


def session() -> Iterator[Session]:
    """Yield one request-scoped session; callers explicitly commit their own transactions."""
    with Session(engine()) as db:
        yield db
