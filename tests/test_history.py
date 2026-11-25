"""Restore a historical release to a new draft with editor-only authority."""
import json

from fastapi.testclient import TestClient
from sqlalchemy import text


def test_editor_restore_only(mysql_engine, monkeypatch):
    """Confirming restore never changes the live pointer, and stale confirmation never writes."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    from app.core.security import hash_password
    from main import app

    with mysql_engine.begin() as db:
        actor = db.execute(text("INSERT INTO account(login,password_hash,can_edit,must_change_password) VALUES ('history-acceptance',:p,1,0)"),
                           {"p": hash_password("history-test-password")}).lastrowid
        item = db.execute(text("INSERT INTO content_item(kind,revision) VALUES ('product',3)")).lastrowid
        live = None
        for seq, label in ((1, "旧版"), (2, "线上")):
            live = db.execute(text("INSERT INTO `release`(item_id,seq,source_revision,body,actor_id) VALUES (:i,:s,:s,:b,:a)"),
                              {"i": item, "s": seq, "b": json.dumps({"name": label}), "a": actor}).lastrowid
        db.execute(text("UPDATE content_item SET live_id=:v WHERE id=:i"), {"v": live, "i": item})
        db.execute(text("INSERT INTO draft(item_id,body,edited_by) VALUES (:i,JSON_OBJECT('name','同事稿'),:a)"),
                   {"i": item, "a": actor})
    try:
        with TestClient(app, base_url="https://showcase.test", client=("192.0.2.110", 50000)) as editor:
            origin = {"Origin": "https://showcase.test"}
            token = editor.get("/api/admin/login").json()["csrf_token"]
            logged = editor.post("/api/admin/login", headers={**origin, "X-CSRF-Token": token},
                                 json={"login": "history-acceptance", "password": "history-test-password"})
            headers = {**origin, "X-CSRF-Token": logged.json()["csrf_token"]}
            route = f"/api/admin/items/{item}"
            versions = editor.get(route + "/versions")
            assert versions.status_code == 200
            assert [row["seq"] for row in versions.json()["items"]] == [2, 1]
            current = editor.get(route).json()
            action = route + "/versions/1/restore"
            assert editor.post(action, headers=headers, json={"expected_revision": "2", "confirm_overwrite": True}).status_code == 409
            assert editor.post(action, headers=headers, json={"expected_revision": current["revision"], "confirm_overwrite": False}).status_code == 409
            assert editor.get(route).json()["draft"]["name"] == "同事稿"
            restored = editor.post(action, headers=headers, json={"expected_revision": current["revision"], "confirm_overwrite": True})
            assert restored.status_code == 200
            result = restored.json()
            assert result["live_id"] == str(live) and result["draft"]["name"] == "旧版" and result["revision"] != current["revision"]
            denied = editor.post(route + "/publish", headers=headers, json={"expected_revision": result["revision"], "request_key": "restore-no-publish"})
            assert denied.status_code == 403
            audit = editor.get("/api/admin/audit", params={"target_id": str(item)}).json()["items"]
            assert len(audit) == 1 and audit[0]["action"] == "restore" and audit[0]["details"]["source_seq"] == 1
    finally:
        with mysql_engine.begin() as db:
            db.execute(text("UPDATE content_item SET live_id=NULL WHERE id=:i"), {"i": item})
            db.execute(text("DELETE FROM `release` WHERE item_id=:i"), {"i": item})
            db.execute(text("DELETE FROM content_item WHERE id=:i"), {"i": item})
            db.execute(text("DELETE FROM audit WHERE actor_id=:a"), {"a": actor})
            db.execute(text("DELETE FROM `session` WHERE account_id=:a"), {"a": actor})
            db.execute(text("DELETE FROM account WHERE id=:a"), {"a": actor})
