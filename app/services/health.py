"""Readiness requires the installed database head to match the shipped migrations."""
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import PROJECT_ROOT
from app.core.db import engine
from app.repositories.schema import installed_revisions


def is_ready() -> bool:
    """A missing configuration or unreachable database is not a reason to run DDL."""
    try:
        required = set(ScriptDirectory.from_config(Config(str(PROJECT_ROOT / 'alembic.ini'))).get_heads())
        return bool(required) and required == installed_revisions(engine())
    except (CommandError, RuntimeError, SQLAlchemyError):
        return False
