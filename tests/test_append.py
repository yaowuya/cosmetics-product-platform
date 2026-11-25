"""Product position append tests against the real MySQL draft and release state."""
import json

from fastapi.testclient import TestClient
from sqlalchemy import text


def test_union_per_item(mysql_engine, monkeypatch):
    """Append idempotently to only the selected current revisions; preserve live snapshots."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    from app.core.security import hash_password
    from main import app

    with mysql_engine.begin() as db:
        actor = db.execute(text("INSERT INTO account(login,password_hash,can_edit,must_change_password) VALUES ('append-editor',:p,1,0)"),
                           {"p": hash_password("append-test-password")}).lastrowid
        nodes = [db.execute(text("INSERT INTO directory_node () VALUES ()")).lastrowid for _ in range(2)]
        directory = db.scalar(text("SELECT id FROM content_item WHERE config_slot='directory'"))
        body = {"nodes": [{"id": str(n), "level": "board", "name": f"板块{i}", "enabled": True, "sort_order": i}
                          for i, n in enumerate(nodes)]}
        version = db.execute(text("INSERT INTO `release`(item_id,seq,source_revision,body,actor_id) VALUES (:i,1,0,:b,:a)"),
                             {"i": directory, "b": json.dumps(body), "a": actor}).lastrowid
        db.execute(text("UPDATE content_item SET live_id=:v WHERE id=:i"), {"v": version, "i": directory})
    created, releases = [], [(directory, version)]
    try:
        with TestClient(app, base_url="https://showcase.test", client=("192.0.2.70", 50000)) as editor:
            origin = {"Origin": "https://showcase.test"}
            nonce = editor.get("/api/admin/login").json()["csrf_token"]
            login = editor.post("/api/admin/login", headers={**origin, "X-CSRF-Token": nonce},
                                json={"login": "append-editor", "password": "append-test-password"})
            headers = {**origin, "X-CSRF-Token": login.json()["csrf_token"]}
            def draft(name):
                """Seed a partial legacy draft that the internal position workflow can still edit."""
                with mysql_engine.begin() as db:
                    ident = db.execute(text("INSERT INTO content_item(kind,revision) VALUES ('product',1)")).lastrowid
                    db.execute(text("INSERT INTO draft(item_id,body,edited_by) VALUES (:i,JSON_OBJECT('name',:n),:a)"),
                               {"i": ident, "n": name, "a": actor})
                    db.execute(text("INSERT INTO draft_place(item_id,node_id) VALUES (:i,:n)"), {"i": ident, "n": nodes[0]})
                created.append(ident)
                return editor.get(f"/api/admin/items/{ident}").json()
            one, two = draft("未发布稿"), draft("现有线上版")
            with mysql_engine.begin() as db:
                live = db.execute(text("INSERT INTO `release`(item_id,seq,source_revision,body,actor_id) VALUES (:i,1,1,:b,:a)"),
                                  {"i": two["id"], "b": json.dumps(two["draft"]), "a": actor}).lastrowid
                releases.append((two["id"], live))
                db.execute(text("INSERT INTO release_place(release_id,node_id) VALUES (:v,:n)"), {"v": live, "n": nodes[0]})
                db.execute(text("UPDATE content_item SET live_id=:v WHERE id=:i"), {"v": live, "i": two["id"]})
                db.execute(text("DELETE FROM draft WHERE item_id=:i"), {"i": two["id"]})
            choices = [{"id": item["id"], "expected_revision": item["revision"]} for item in (one, two)]
            url = "/api/admin/products/batch-append"
            payload = {"items": choices, "node_ids": [str(nodes[1]), str(nodes[1])]}
            response = editor.post(url, headers=headers, json=payload)
            assert response.status_code == 200
            assert [r["status"] for r in response.json()["items"]] == ["changed", "changed"]
            after = [editor.get(f"/api/admin/items/{item['id']}").json() for item in (one, two)]
            assert all(row["place_ids"] == list(map(str, nodes)) for row in after)
            assert after[1]["live_id"] == str(live) and after[1]["draft"]["name"] == "现有线上版"
            payload["items"] = [{"id": row["id"], "expected_revision": row["revision"]} for row in after]
            repeated = editor.post(url, headers=headers, json=payload).json()["items"]
            assert [r["status"] for r in repeated] == ["unchanged", "unchanged"]
            assert [r["revision"] for r in repeated] == [row["revision"] for row in after]
            payload["node_ids"] = ["9223372036854775807"]
            assert [r["status"] for r in editor.post(url, headers=headers, json=payload).json()["items"]] == ["invalid", "invalid"]
    finally:
        with mysql_engine.begin() as db:
            for owner, version_id in reversed(releases):
                db.execute(text("UPDATE content_item SET live_id=NULL WHERE id=:i"), {"i": owner})
                db.execute(text("DELETE FROM release_place WHERE release_id=:v"), {"v": version_id})
                db.execute(text("DELETE FROM `release` WHERE id=:v"), {"v": version_id})
            for item in created:
                db.execute(text("DELETE FROM content_item WHERE id=:i"), {"i": item})
            for node in nodes:
                db.execute(text("DELETE FROM directory_node WHERE id=:n"), {"n": node})
            db.execute(text("DELETE FROM `session` WHERE account_id=:a"), {"a": actor})
            db.execute(text("DELETE FROM account WHERE id=:a"), {"a": actor})
