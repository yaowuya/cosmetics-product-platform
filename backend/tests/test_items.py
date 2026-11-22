"""Exercise independent drafts and stable item queries using real API calls."""
from fastapi.testclient import TestClient
from sqlalchemy import text


def test_draft_and_lists(mysql_engine, monkeypatch):
    """Partial drafts are legal, bad shapes and stale writes do not change saved state."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    from app.auth import hash_password
    from app.main import app

    with mysql_engine.begin() as db:
        actor = db.execute(text("INSERT INTO account (login,password_hash,can_edit,must_change_password) VALUES ('draft-acceptance',:p,1,0)"),
                           {"p": hash_password("draft-test-password")}).lastrowid
        nodes = [db.execute(text("INSERT INTO directory_node () VALUES ()")).lastrowid for _ in range(2)]
    created = []
    try:
        with TestClient(app, base_url="https://showcase.test") as editor, TestClient(app, base_url="https://showcase.test") as another:
            def sign_in(client):
                """Authenticate two independent test clients with the same permitted role."""
                origin = {"Origin": "https://showcase.test"}
                nonce = client.get("/api/admin/login").json()["csrf_token"]
                result = client.post("/api/admin/login", headers={**origin, "X-CSRF-Token": nonce},
                                     json={"login": "draft-acceptance", "password": "draft-test-password"})
                assert result.status_code == 200
                return {**origin, "X-CSRF-Token": result.json()["csrf_token"]}

            headers, other = sign_in(editor), sign_in(another)
            response = editor.post("/api/admin/products", headers=headers,
                                   json={"body": {"name": "跨类精华", "formula_no": "F-42"}, "place_ids": list(map(str, nodes))})
            assert response.status_code == 201
            product = response.json(); created.append(int(product["id"]))
            assert product["live"] is None and len(product["place_ids"]) == 2
            case_response = editor.post("/api/admin/cases", headers=headers,
                                        json={"body": {"brand_name": "独立品牌", "product_name": "定制案例"}, "place_ids": []})
            assert case_response.status_code == 201
            created.append(int(case_response.json()["id"]))
            listing = editor.get("/api/admin/products", params={"q": "F-42", "has_draft": "true"}).json()
            assert listing["total"] == 1 and listing["items"][0]["id"] == product["id"]
            assert editor.get("/api/admin/products", params={"node_id": str(nodes[1])}).json()["total"] == 1
            assert editor.get("/api/admin/cases", params={"q": "独立品牌"}).json()["total"] == 1
            item_path = f"/api/admin/items/{product['id']}"
            save = {"expected_revision": product["revision"], "body": {"name": "补写功效", "detail_asset_id": "  "},
                    "place_ids": product["place_ids"]}
            updated = editor.put(item_path + "/draft", headers=headers, json=save)
            assert updated.status_code == 200
            assert "detail_asset_id" not in updated.json()["draft"] and updated.json()["live_id"] is None
            stale = another.put(item_path + "/draft", headers=other, json=save)
            assert stale.status_code == 409
            malformed = {**save, "expected_revision": updated.json()["revision"], "body": {"detail_asset_id": ["1"]}}
            assert editor.put(item_path + "/draft", headers=headers, json=malformed).status_code == 422
            after = editor.get(item_path).json()
            assert after["draft"]["name"] == "补写功效" and after["revision"] == updated.json()["revision"]
    finally:
        with mysql_engine.begin() as db:
            for ident in created:
                db.execute(text("DELETE FROM content_item WHERE id=:id"), {"id": ident})
            for ident in nodes:
                db.execute(text("DELETE FROM directory_node WHERE id=:id"), {"id": ident})
            db.execute(text("DELETE FROM `session` WHERE account_id=:id"), {"id": actor})
            db.execute(text("DELETE FROM account WHERE id=:id"), {"id": actor})
