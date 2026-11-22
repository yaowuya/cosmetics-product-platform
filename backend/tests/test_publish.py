"""Verify one real publication transaction and an idempotent lost-receipt retry."""
from fastapi.testclient import TestClient
from sqlalchemy import text


def test_publish_receipt(mysql_engine, monkeypatch):
    """A duplicate confirmation returns the same receipt; failed writes roll back together."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    from app.auth import hash_password
    from app.main import app

    with mysql_engine.begin() as db:
        actor = db.execute(text("INSERT INTO account(login,password_hash,can_edit,can_publish,must_change_password) VALUES ('publish-acceptance',:p,1,1,0)"),
                           {"p": hash_password("publish-test-password")}).lastrowid
    item = None
    revision = None
    try:
        with TestClient(app, base_url="https://showcase.test", client=("192.0.2.90", 50000), raise_server_exceptions=False) as client:
            origin = {"Origin": "https://showcase.test"}
            nonce = client.get("/api/admin/login").json()["csrf_token"]
            login = client.post("/api/admin/login", headers={**origin, "X-CSRF-Token": nonce},
                                json={"login": "publish-acceptance", "password": "publish-test-password"})
            headers = {**origin, "X-CSRF-Token": login.json()["csrf_token"]}
            initial = client.get("/api/admin/config/business_contact").json()
            item = initial["id"]; revision = initial["revision"]
            endpoint = f"/api/admin/items/{item}"
            first_draft = client.put(endpoint + "/draft", headers=headers, json={"expected_revision": revision,
                                      "body": {"title": "商务联系", "email": "contact@example.invalid"}}).json()
            params = {"expected_revision": first_draft["revision"], "request_key": "test-confirmation-original"}
            first = client.post(endpoint + "/publish", headers=headers, json=params)
            assert first.status_code == 200
            replay = client.post(endpoint + "/publish", headers=headers, json=params)
            assert replay.json() == first.json()
            assert client.post(endpoint + "/publish", headers=headers, json={**params, "request_key": "different-key"}).status_code == 409
            assert client.post(endpoint + "/publish", headers=headers, json={**params, "expected_revision": "0"}).status_code == 409
            query = {"target_kind": "config", "target_id": item, "request_key": params["request_key"]}
            ledger = client.get("/api/admin/audit", params=query)
            assert ledger.status_code == 200 and ledger.json()["total"] == 1
            assert ledger.json()["items"][0]["details"]["receipt"] == first.json()
            after = client.get(endpoint).json()
            second = client.put(endpoint + "/draft", headers=headers, json={"expected_revision": after["revision"], "body": {"title": "尚未上线"}}).json()
            from app import publish
            def fail_audit(*args, **kwargs):
                """Abort in the transaction after appending a release, before commit."""
                raise RuntimeError("test transaction abort")
            with monkeypatch.context() as fault:
                fault.setattr(publish, "_add_audit", fail_audit)
                denied = client.post(endpoint + "/publish", headers=headers,
                                     json={"expected_revision": second["revision"], "request_key": "rollback-probe"})
                assert denied.status_code == 500
            untouched = client.get(endpoint).json()
            assert untouched["live_id"] == first.json()["release_id"] and untouched["draft"] == second["draft"]
            with mysql_engine.connect() as db:
                assert db.scalar(text("SELECT COUNT(*) FROM `release` WHERE item_id=:i"), {"i": item}) == 1
                assert db.scalar(text("SELECT COUNT(*) FROM audit WHERE actor_id=:a AND action='publish'"), {"a": actor}) == 1
            with mysql_engine.begin() as db:
                db.execute(text("UPDATE account SET can_publish=0 WHERE id=:a"), {"a": actor})
            assert client.post(endpoint + "/publish", headers=headers, json=params).status_code == 403
    finally:
        with mysql_engine.begin() as db:
            if item is not None:
                db.execute(text("UPDATE content_item SET live_id=NULL,revision=:rev WHERE id=:i"), {"rev": revision, "i": item})
                db.execute(text("DELETE FROM draft WHERE item_id=:i"), {"i": item})
                db.execute(text("DELETE FROM `release` WHERE item_id=:i"), {"i": item})
            db.execute(text("DELETE FROM audit WHERE actor_id=:a"), {"a": actor})
            db.execute(text("DELETE FROM `session` WHERE account_id=:a"), {"a": actor})
            db.execute(text("DELETE FROM account WHERE id=:a"), {"a": actor})
