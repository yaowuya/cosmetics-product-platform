"""Fixed positions and company directory drafts retain their stable identity."""
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text


def test_fixed_tree(mysql_engine, monkeypatch):
    """Allocate nodes then save, reject invalid trees and keep the fixed slot identity."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    command.upgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "head")
    from app.auth import hash_password
    from app.main import app

    with mysql_engine.begin() as db:
        actor = db.execute(text("INSERT INTO account (login,password_hash,can_edit,must_change_password) VALUES ('directory-acceptance',:p,1,0)"),
                           {"p": hash_password("directory-test-password")}).lastrowid
    ids = []
    slot_id, base_revision = None, None
    try:
        with TestClient(app, base_url="https://showcase.test") as editor:
            origin = {"Origin": "https://showcase.test"}
            nonce = editor.get("/api/admin/login").json()["csrf_token"]
            login = editor.post("/api/admin/login", headers={**origin, "X-CSRF-Token": nonce},
                                json={"login": "directory-acceptance", "password": "directory-test-password"})
            headers = {**origin, "X-CSRF-Token": login.json()["csrf_token"]}
            slot = editor.get("/api/admin/config/directory")
            assert slot.status_code == 200
            fixed = slot.json(); slot_id = fixed["id"]; base_revision = fixed["revision"]
            assert fixed["config_slot"] == "directory" and fixed["live"] is None
            assert editor.get("/api/admin/config/unknown").status_code == 404
            for _ in range(2):
                made = editor.post("/api/admin/directory/nodes", headers=headers, json={})
                assert made.status_code == 201
                ids.append(made.json()["id"])
            root = {"id": ids[0], "level": "board", "name": "原名", "sort_order": 0, "enabled": True}
            leaf = {"id": ids[1], "parent_id": ids[0], "level": "category", "name": "精华", "sort_order": 0, "enabled": True}
            endpoint = f"/api/admin/items/{slot_id}/draft"
            def save(nodes, revision):
                """Send the complete, revision-bound directory draft through the real editor route."""
                return editor.put(endpoint, headers=headers, json={"body": {"nodes": nodes}, "expected_revision": revision})
            assert save([{**root, "parent_id": ids[1]}, leaf], base_revision).status_code == 422
            assert save([root, {**leaf, "parent_id": "9223372036854775807"}], base_revision).status_code == 422
            accepted = save([root, leaf], base_revision)
            assert accepted.status_code == 200
            renamed = save([{**root, "name": "新名"}, leaf], accepted.json()["revision"])
            assert renamed.status_code == 200
            again = editor.get("/api/admin/config/directory").json()
            assert again["id"] == slot_id and again["live_id"] is None
            assert [node["id"] for node in again["draft"]["nodes"]] == ids
            assert again["draft"]["nodes"][0]["name"] == "新名"
    finally:
        with mysql_engine.begin() as db:
            if slot_id is not None:
                db.execute(text("DELETE FROM draft WHERE item_id=:id"), {"id": slot_id})
                db.execute(text("UPDATE content_item SET revision=:rev WHERE id=:id"), {"id": slot_id, "rev": base_revision})
            for ident in ids:
                db.execute(text("DELETE FROM directory_node WHERE id=:id"), {"id": ident})
            db.execute(text("DELETE FROM `session` WHERE account_id=:id"), {"id": actor})
            db.execute(text("DELETE FROM account WHERE id=:id"), {"id": actor})
