"""Verify revocable HTTPS sessions against the actual local InnoDB account store."""
import json

from fastapi import Depends
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import text


def test_session_boundaries(mysql_engine, monkeypatch):
    """Bootstrap, change-password, CSRF and revocation must agree on the same account."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    from app.cli.bootstrap import create_first_admin
    from app.application import create_app
    from main import app

    login = "bootstrap-acceptance"
    password = "activation-acceptance-only"
    replacement = "changed-acceptance-only"
    actor = create_first_admin(login, password)
    try:
        with pytest.raises(RuntimeError, match="already initialized"):
            create_first_admin("second-admin", password)
        with TestClient(app, base_url="https://showcase.test") as client:
            def sign_in(current_password):
                """Get the real anonymous CSRF handshake and sign in through the same browser context."""
                token = client.get("/api/admin/login").json()["csrf_token"]
                return client.post("/api/admin/login", json={"login": login, "password": current_password},
                                   headers={"Origin": "https://showcase.test", "X-CSRF-Token": token})

            signed_in = sign_in(password)
            assert signed_in.status_code == 200
            assert signed_in.json()["can_manage"] and not signed_in.json()["can_edit"]
            attributes = signed_in.headers.get_list("set-cookie")
            assert any("HttpOnly" in cookie and "Secure" in cookie and "SameSite=strict" in cookie for cookie in attributes)
            assert client.get("/api/admin/me").status_code == 403
            endpoint = "/api/admin/change-password"
            payload = {"old_password": password, "new_password": replacement}
            csrf = signed_in.json()["csrf_token"]
            assert client.post(endpoint, json=payload, headers={"Origin": "https://showcase.test"}).status_code == 403
            assert client.post(endpoint, json=payload, headers={"Origin": "https://different.invalid", "X-CSRF-Token": csrf}).status_code == 403
            changed = client.post(endpoint, json=payload, headers={"Origin": "https://showcase.test", "X-CSRF-Token": csrf})
            assert changed.status_code == 200
            assert client.get("/api/admin/me").json()["must_change_password"] is False
            from app.controllers.dependencies import require

            probe = create_app()
            probe.add_api_route("/publish-check", lambda: {}, dependencies=[Depends(require("publish"))])
            with TestClient(probe, base_url="https://showcase.test", cookies=client.cookies) as guarded:
                assert guarded.get("/publish-check").status_code == 403
            assert client.post("/api/admin/logout", headers={"Origin": "https://showcase.test", "X-CSRF-Token": changed.json()["csrf_token"]}).status_code == 204
            assert client.get("/api/admin/me").status_code == 401
            assert sign_in(replacement).status_code == 200
            with mysql_engine.begin() as db:
                db.execute(text("UPDATE `session` SET expires_at='2000-01-01' WHERE account_id=:id"), {"id": actor})
            assert client.get("/api/admin/me").status_code == 401
            assert sign_in(replacement).status_code == 200
            with mysql_engine.begin() as db:
                db.execute(text("UPDATE account SET enabled=0 WHERE id=:id"), {"id": actor})
            assert client.get("/api/admin/me").status_code == 401
            assert password not in json.dumps(changed.json())
            assert replacement not in json.dumps(changed.json())
    finally:
        with mysql_engine.begin() as db:
            db.execute(text("DELETE FROM `session` WHERE account_id=:id"), {"id": actor})
            db.execute(text("DELETE FROM account WHERE id=:id"), {"id": actor})
