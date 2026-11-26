"""Exercise independent drafts and stable item queries using real API calls."""
from fastapi.testclient import TestClient
from sqlalchemy import text


def test_draft_and_lists(mysql_engine, monkeypatch, product_draft_body):
    """Required fields, invalid shapes and stale writes are checked without changing saved state."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    from app.core.security import hash_password
    from main import app

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
            incomplete = editor.post("/api/admin/products", headers=headers,
                                     json={"body": {"name": "缺图精华", "detail_asset_ids": []}})
            assert incomplete.status_code == 422 and incomplete.json()["code"] == "invalid_body"
            assert {"detail_asset_ids", "place_ids", "cover_asset_id"} <= {row["field"] for row in incomplete.json()["issues"]}
            assert editor.get("/api/admin/products", params={"q": "缺图精华"}).json()["total"] == 0
            body = product_draft_body("跨类精华", "1", formula_no="F-42")
            response = editor.post("/api/admin/products", headers=headers,
                                   json={"body": body, "place_ids": list(map(str, nodes))})
            assert response.status_code == 201
            product = response.json(); created.append(int(product["id"]))
            assert product["live"] is None and len(product["place_ids"]) == 2
            case_body = {"brand_name": "独立品牌", "product_name": "定制案例"}
            incomplete_case = editor.post("/api/admin/cases", headers=headers, json={"body": case_body})
            assert incomplete_case.status_code == 422
            assert [row["field"] for row in incomplete_case.json()["issues"]] == ["highlight", "image_asset_id"]
            case_response = editor.post("/api/admin/cases", headers=headers,
                                        json={"body": {**case_body, "highlight": "测试亮点", "image_asset_id": "1"}})
            assert case_response.status_code == 201
            created.append(int(case_response.json()["id"]))
            listing = editor.get("/api/admin/products", params={"q": "F-42", "has_draft": "true"}).json()
            assert listing["total"] == 1 and listing["items"][0]["id"] == product["id"]
            assert editor.get("/api/admin/products", params={"node_id": str(nodes[1])}).json()["total"] == 1
            assert editor.get("/api/admin/cases", params={"q": "独立品牌"}).json()["total"] == 1
            item_path = f"/api/admin/items/{product['id']}"
            save = {"expected_revision": product["revision"], "body": {**body, "name": "补写功效", "detail_asset_id": "  "},
                    "place_ids": product["place_ids"]}
            rejected = editor.put(item_path + "/draft", headers=headers, json=save)
            assert rejected.status_code == 422 and [row["field"] for row in rejected.json()["issues"]] == ["detail_asset_id"]
            assert editor.get(item_path).json() == product
            save["body"]["detail_asset_id"] = "1"
            updated = editor.put(item_path + "/draft", headers=headers, json=save)
            assert updated.status_code == 200
            assert updated.json()["draft"]["detail_asset_id"] == "1" and updated.json()["live_id"] is None
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
