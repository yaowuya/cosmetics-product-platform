"""Real API tests for account management, current capabilities and audit visibility."""
from fastapi.testclient import TestClient
from sqlalchemy import text


def test_grants_and_scope(mysql_engine, monkeypatch):
    """Invalid combinations, revocation and content/governance audit remain isolated."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    from app.cli.bootstrap import create_first_admin
    from main import app

    temporary = "governance-acceptance-only"
    admin_id = create_first_admin("governance-acceptance", temporary)
    editor_id = None
    try:
        with TestClient(app, base_url="https://showcase.test") as admin, TestClient(app, base_url="https://showcase.test") as editor:
            def sign_in(client, login):
                """Sign in and perform the required first password change via real API responses."""
                origin = {"Origin": "https://showcase.test"}
                nonce = client.get("/api/admin/login").json()["csrf_token"]
                start = client.post("/api/admin/login", json={"login": login, "password": temporary},
                                    headers={**origin, "X-CSRF-Token": nonce})
                assert start.status_code == 200
                changed = client.post("/api/admin/change-password",
                                      json={"old_password": temporary, "new_password": temporary + "-new"},
                                      headers={**origin, "X-CSRF-Token": start.json()["csrf_token"]})
                assert changed.status_code == 200
                return {**origin, "X-CSRF-Token": changed.json()["csrf_token"]}

            admin_write = sign_in(admin, "governance-acceptance")
            opened = admin.post("/api/admin/accounts", headers=admin_write,
                                json={"login": "governance-editor", "password": temporary, "can_edit": True})
            assert opened.status_code == 201
            editor_id = int(opened.json()["id"])
            assert "password" not in opened.json() and "password_hash" not in opened.json()
            sign_in(editor, "governance-editor")
            assert editor.get("/api/admin/accounts").status_code == 403
            before = admin.get("/api/admin/audit").json()["total"]
            rejected = admin.patch(f"/api/admin/accounts/{admin_id}", headers=admin_write, json={"can_publish": True})
            assert rejected.status_code == 422
            assert admin.get("/api/admin/audit").json()["total"] == before
            assert admin.get("/api/admin/me").json()["can_publish"] is False
            route = f"/api/admin/accounts/{editor_id}"
            assert admin.patch(route, headers=admin_write, json={"can_publish": True}).status_code == 200
            assert editor.get("/api/admin/me").json()["can_publish"] is True
            assert admin.patch(route, headers=admin_write, json={"can_publish": False}).status_code == 200
            assert editor.get("/api/admin/me").json()["can_publish"] is False
            with mysql_engine.begin() as db:
                db.execute(text("INSERT INTO audit (actor_id, action, target_kind, target_id, details) VALUES (:actor,'publish','product',11,JSON_OBJECT())"), {"actor": editor_id})
            manager_rows = admin.get("/api/admin/audit", params={"actor_id": str(admin_id), "target_id": str(editor_id)}).json()["items"]
            assert len(manager_rows) == 3 and {row["target_kind"] for row in manager_rows} == {"account"}
            assert admin.get("/api/admin/audit", params={"target_kind": "product"}).json()["total"] == 0
            assert editor.get("/api/admin/audit", params={"target_kind": "account"}).json()["total"] == 0
            assert editor.get("/api/admin/audit", params={"target_kind": "product"}).json()["total"] == 1
            assert admin.patch(route, headers=admin_write, json={"enabled": False}).status_code == 200
            assert editor.get("/api/admin/me").status_code == 401
            assert admin.patch(route, headers=admin_write, json={"enabled": True}).status_code == 200
            assert editor.get("/api/admin/me").status_code == 401
    finally:
        with mysql_engine.begin() as db:
            for ident in (editor_id, admin_id):
                if ident is not None:
                    db.execute(text("DELETE FROM audit WHERE actor_id=:id"), {"id": ident})
                    db.execute(text("DELETE FROM `session` WHERE account_id=:id"), {"id": ident})
                    db.execute(text("DELETE FROM account WHERE id=:id"), {"id": ident})
