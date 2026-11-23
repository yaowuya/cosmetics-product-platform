"""Run schema changes only from an explicit Alembic command."""
from alembic import context

from app.core.db import database_url, engine
from app.models import Base


def migrate() -> None:
    """Run with the configured database, or render MySQL SQL in offline mode."""
    if context.is_offline_mode():
        context.configure(url=database_url(), target_metadata=Base.metadata, literal_binds=True)
        with context.begin_transaction():
            context.run_migrations()
        return

    with engine().connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()


migrate()
