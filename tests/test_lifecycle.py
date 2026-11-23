"""Lifecycle behavior checked with real content, version and audit rows."""
import json

from fastapi.testclient import TestClient
from sqlalchemy import text


def test_cleanup_guard(mysql_engine, monkeypatch):
    """A retired product is not a deletable draft, and cases never follow its visibility."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    from app.core.security import hash_password
    from main import app

    ids = []
    with mysql_engine.begin() as db:
        actor = db.execute(text("INSERT INTO account(login,password_hash,can_edit,can_publish,must_change_password) VALUES ('retire-acceptance',:p,1,1,0)"),
                           {"p": hash_password("retire-test-password")}).lastrowid
        for kind in ("product", "case"):
            ids.append(db.execute(text("INSERT INTO content_item(kind) VALUES (:k)"), {"k": kind}).lastrowid)
        for ident, body in zip(ids, ({"name": "原产品"}, {"related_product_id": str(ids[0]), "brand_name": "案例企业"})):
            version = db.execute(text("INSERT INTO `release`(item_id,seq,source_revision,body,actor_id) VALUES (:i,1,0,:b,:a)"),
                                 {"i": ident, "b": json.dumps(body), "a": actor}).lastrowid
            db.execute(text("UPDATE content_item SET live_id=:r,revision=1 WHERE id=:i"), {"r": version, "i": ident})
    try:
        with TestClient(app, base_url="https://showcase.test", client=("192.0.2.100", 50000)) as editor:
            headers = {"Origin": "https://showcase.test"}
            csrf = editor.get("/api/admin/login").json()["csrf_token"]
            signed = editor.post("/api/admin/login", headers={**headers, "X-CSRF-Token": csrf},
                                 json={"login": "retire-acceptance", "password": "retire-test-password"})
            headers["X-CSRF-Token"] = signed.json()["csrf_token"]
            product = f"/api/admin/items/{ids[0]}"
            case = f"/api/admin/items/{ids[1]}"
            impact = editor.get(product + "/impact")
            assert impact.status_code == 200 and impact.json()["case_ids"] == [str(ids[1])]
            payload = {"expected_revision": "1", "confirmed": True, "case_ids": []}
            assert editor.post(product + "/unlist", headers=headers, json=payload).status_code == 409
            payload["case_ids"] = [str(ids[1])]
            assert editor.post(product + "/archive", headers=headers, json=payload).status_code == 409
            gone = editor.post(product + "/unlist", headers=headers, json=payload)
            assert gone.status_code == 200 and gone.json()["live_id"] is None
            assert editor.get(case).json()["live_id"] is not None
            # With neither a draft nor a live pointer, staff must still find the item to archive it.
            offline = editor.get("/api/admin/products", params={"q": "原产品", "state": "offline"}).json()
            assert offline["total"] == 1
            row = offline["items"][0]
            assert row["id"] == str(ids[0]) and row["summary"]["name"] == "原产品"
            assert row["draft"] is None and row["live"] is None
            assert editor.get(f"/api/public/products/{ids[0]}").status_code == 404
            payload["expected_revision"] = gone.json()["revision"]
            assert editor.request("DELETE", product + "/draft", headers=headers,
                                  json={"confirmed": True, "expected_revision": gone.json()["revision"]}).status_code == 409
            result = editor.post(product + "/archive", headers=headers, json=payload)
            assert result.status_code == 200 and result.json()["archived_at"] and result.json()["has_history"]
            assert editor.get("/api/admin/products").json()["total"] == 0
            assert editor.get("/api/admin/products", params={"state": "archived"}).json()["total"] == 1
            draft = editor.post("/api/admin/cases", headers=headers, json={"body": {"brand_name": "试填"}}).json()
            ids.append(int(draft["id"]))
            assert editor.request("DELETE", f"/api/admin/items/{draft['id']}/draft", headers=headers,
                                  json={"confirmed": True, "expected_revision": draft["revision"]}).status_code == 204
            assert editor.get(f"/api/admin/items/{draft['id']}").status_code == 404
    finally:
        with mysql_engine.begin() as db:
            for ident in ids:
                db.execute(text("UPDATE content_item SET live_id=NULL WHERE id=:i"), {"i": ident})
                db.execute(text("DELETE FROM `release` WHERE item_id=:i"), {"i": ident})
                db.execute(text("DELETE FROM content_item WHERE id=:i"), {"i": ident})
            db.execute(text("DELETE FROM audit WHERE actor_id=:a"), {"a": actor})
            db.execute(text("DELETE FROM `session` WHERE account_id=:a"), {"a": actor})
            db.execute(text("DELETE FROM account WHERE id=:a"), {"a": actor})
