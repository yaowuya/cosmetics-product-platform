"""Inspect the explicitly installed schema without migrating it."""
from sqlalchemy import text
from sqlalchemy.engine import Engine


def installed_revisions(engine: Engine) -> set[str]:
    with engine.connect() as connection:
        return set(connection.scalars(text("SELECT version_num FROM alembic_version")))
