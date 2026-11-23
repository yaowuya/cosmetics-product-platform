"""Check real migrations and domain constraints rather than a SQLite simulation."""
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError, OperationalError

BACKEND = Path(__file__).resolve().parents[1]
TABLES = {
    "content_item", "draft", "release", "directory_node", "draft_place", "release_place",
    "asset", "release_asset", "account", "session", "audit",
}


def test_application_entrypoint_is_importable_without_database_config(monkeypatch):
    """Importing the ASGI application does not connect or apply DDL."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    from app.main import app

    assert callable(app)


def test_upgrade_constraints(mysql_engine, monkeypatch):
    """Upgrade the disposable schema twice and exercise its invariants in a rolled-back transaction."""
    ini = BACKEND / "alembic.ini"
    assert ini.is_file(), "The initial Alembic configuration must exist"
    cfg = Config(str(ini))
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    command.upgrade(cfg, "head")
    command.upgrade(cfg, "head")
    assert TABLES <= set(inspect(mysql_engine).get_table_names())

    with mysql_engine.connect() as db, db.begin() as transaction:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == ScriptDirectory.from_config(cfg).get_current_head()
        storage = dict(db.execute(text(
            "SELECT table_name, engine FROM information_schema.tables WHERE table_schema = DATABASE()"
        )).all())
        assert all(storage[table] == "InnoDB" for table in TABLES)
        assert db.scalar(text("SELECT COUNT(*) FROM content_item WHERE live_id IS NOT NULL")) == 0
        assert db.scalar(text("SELECT COUNT(*) FROM `release`")) == 0

        first = db.execute(text("INSERT INTO content_item (kind) VALUES ('product')")).lastrowid
        second = db.execute(text("INSERT INTO content_item (kind) VALUES ('product')")).lastrowid
        assert first != second
        if not db.scalar(text("SELECT id FROM content_item WHERE config_slot = 'home_posters'")):
            db.execute(text("INSERT INTO content_item (kind,config_slot) VALUES ('config','home_posters')"))
        with pytest.raises(IntegrityError) as duplicate:
            db.execute(text("INSERT INTO content_item (kind,config_slot) VALUES ('config','home_posters')"))
        assert duplicate.value.orig.args[0] == 1062
        for invalid in (
            "INSERT INTO content_item (kind,config_slot) VALUES ('product','directory')",
            "INSERT INTO content_item (kind) VALUES ('config')",
        ):
            # PyMySQL reports CHECK violations separately from duplicate keys and foreign keys.
            with pytest.raises(OperationalError) as check:
                db.execute(text(invalid))
            assert check.value.orig.args[0] == 3819

        actor = db.execute(text("INSERT INTO account (login,password_hash) VALUES ('schema-editor','test-only')")).lastrowid
        db.execute(text("INSERT INTO draft (item_id,body,edited_by) VALUES (:item,JSON_OBJECT(),:actor)"), {"item": first, "actor": actor})
        node = db.execute(text("INSERT INTO directory_node () VALUES ()")).lastrowid
        link = text("INSERT INTO draft_place (item_id,node_id) VALUES (:item,:node)")
        db.execute(link, {"item": first, "node": node})
        with pytest.raises(IntegrityError):
            db.execute(link, {"item": first, "node": node})

        publish = text("INSERT INTO `release` (item_id,seq,source_revision,body,actor_id) VALUES (:item,:seq,:revision,JSON_OBJECT(),:actor)")
        params = {"item": first, "seq": 1, "revision": 3, "actor": actor}
        release_id = db.execute(publish, params).lastrowid
        with pytest.raises(IntegrityError):
            db.execute(publish, {**params, "revision": 4})
        with pytest.raises(IntegrityError):
            db.execute(publish, {**params, "seq": 2})
        pointer = text("UPDATE content_item SET live_id = :version WHERE id = :item")
        with pytest.raises(IntegrityError):
            db.execute(pointer, {"version": release_id, "item": second})
        db.execute(pointer, {"version": release_id, "item": first})
        transaction.rollback()
