"""Check results are actionable and read-only, even when a batch has mixed outcomes."""
from fastapi.testclient import TestClient
from sqlalchemy import text


def test_no_side_effects(mysql_engine, monkeypatch):
    """Identify missing materials and isolate unauthorized checks without creating releases."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    from app.core.security import hash_password
    from main import app

    actors, created = [], []
    with mysql_engine.begin() as db:
        digest = hash_password("check-test-password")
        for name, publish in (("check-publisher", 1), ("check-editor", 0)):
            actors.append(db.execute(text("INSERT INTO account(login,password_hash,can_edit,can_publish,must_change_password) VALUES (:n,:p,1,:v,0)"),
                                     {"n": name, "p": digest, "v": publish}).lastrowid)
    try:
        opts = {"base_url": "https://showcase.test", "client": ("192.0.2.80", 50000)}
        with TestClient(app, **opts) as publisher, TestClient(app, **opts) as editor:
            def login(client, name):
                """Use the actual authorization handshake for the two distinct capabilities."""
                origin = {"Origin": "https://showcase.test"}
                csrf = client.get("/api/admin/login").json()["csrf_token"]
                signed = client.post("/api/admin/login", headers={**origin, "X-CSRF-Token": csrf},
                                     json={"login": name, "password": "check-test-password"})
                assert signed.status_code == 200
                return {**origin, "X-CSRF-Token": signed.json()["csrf_token"]}

            headers, edit_headers = login(publisher, "check-publisher"), login(editor, "check-editor")
            rows = []
            for kind in ("products", "cases"):
                response = publisher.post(f"/api/admin/{kind}", headers=headers, json={"body": {}})
                assert response.status_code == 201
                row = response.json(); rows.append(row); created.append(row["id"])
            one, case = rows
            req = {"expected_revision": one["revision"]}
            endpoint = f"/api/admin/items/{one['id']}/check"
            check = publisher.post(endpoint, headers=headers, json=req)
            assert check.status_code == 200
            result = check.json()
            assert not result["eligible"] and "detail_asset_id" in {issue["field"] for issue in result["issues"]}
            assert publisher.post(endpoint, headers=headers, json={"expected_revision": "0"}).status_code == 409
            payload = {"items": [{"id": row["id"], "expected_revision": row["revision"]} for row in (one, case)]}
            assert editor.post("/api/admin/products/batch-check", headers=edit_headers, json=payload).status_code == 403
            batch = publisher.post("/api/admin/products/batch-check", headers=headers, json=payload)
            assert batch.status_code == 200
            assert len(batch.json()["items"]) == 2 and all(not row["eligible"] for row in batch.json()["items"])
            with mysql_engine.connect() as db:
                assert db.scalar(text("SELECT COUNT(*) FROM `release` WHERE item_id=:i"), {"i": one["id"]}) == 0
                assert db.scalar(text("SELECT COUNT(*) FROM audit WHERE target_kind='product' AND target_id=:i"), {"i": one["id"]}) == 0
    finally:
        with mysql_engine.begin() as db:
            for item in created:
                db.execute(text("DELETE FROM content_item WHERE id=:i"), {"i": item})
            for actor in actors:
                db.execute(text("DELETE FROM `session` WHERE account_id=:i"), {"i": actor})
                db.execute(text("DELETE FROM account WHERE id=:i"), {"i": actor})
