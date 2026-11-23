"""Public projections are release-only, scoped to active directory paths and whitelisted fields."""
import json

from fastapi.testclient import TestClient
from sqlalchemy import text


def test_live_projection(mysql_engine, monkeypatch):
    """Count one published item across placements and never borrow unpublished data."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    from app.core.security import hash_password
    from main import app

    with mysql_engine.begin() as db:
        actor = db.execute(text("INSERT INTO account(login,password_hash) VALUES ('public-acceptance',:p)"),
                           {"p": hash_password("public-test-password")}).lastrowid
        board, first, second, other = [db.execute(text("INSERT INTO directory_node () VALUES ()")).lastrowid for _ in range(4)]
        directory = db.scalar(text("SELECT id FROM content_item WHERE config_slot='directory'"))
        product, missing, case = [db.execute(text("INSERT INTO content_item(kind) VALUES (:k)"), {"k": kind}).lastrowid
                                  for kind in ("product", "product", "case")]
        nodes = []
        for ident, parent, label, tier in [(board, None, "专属板块", "board"), (first, board, "左列", "category"),
                                               (second, board, "右列", "category"), (other, None, "另一板块", "board")]:
            nodes.append({"id": str(ident), "parent_id": str(parent) if parent else None, "name": label,
                          "level": tier, "enabled": True, "sort_order": 0})
        def put(owner, body):
            """Install a local release fixture without invoking a future frontend flow."""
            version = db.execute(text("INSERT INTO `release`(item_id,seq,source_revision,body,actor_id) VALUES (:i,1,0,:b,:a)"),
                                 {"i": owner, "b": json.dumps(body), "a": actor}).lastrowid
            db.execute(text("UPDATE content_item SET live_id=:v WHERE id=:i"), {"v": version, "i": owner})
            return version
        directory_version = put(directory, {"nodes": nodes})
        live = put(product, {"name": "正式精华", "short_benefit": "保湿", "formula_no": "FORM-72", "internal_note": "private"})
        case_version = put(case, {"brand_name": "独立案例", "product_name": "案例名称", "related_product_id": str(product)})
        for node in (first, second):
            db.execute(text("INSERT INTO release_place(release_id,node_id) VALUES (:r,:n)"), {"r": live, "n": node})
        db.execute(text("INSERT INTO draft(item_id,body,edited_by) VALUES (:p, JSON_OBJECT('name','非公开稿'), :a)"), {"p": product, "a": actor})
    try:
        with TestClient(app, base_url="https://showcase.test") as visitor:
            tags = visitor.get("/api/public/catalog", params={"board_id": str(board)}).json()
            assert tags["counts"][str(board)] == tags["counts"][str(first)] == tags["counts"][str(second)] == 1
            listing = visitor.get("/api/public/products", params={"board_id": str(board), "q": "FORM-72"}).json()
            assert listing["total"] == 1 and listing["items"][0]["id"] == str(product)
            assert "formula_no" not in listing["items"][0]["body"]
            assert visitor.get("/api/public/products", params={"board_id": str(other), "q": "FORM-72"}).json()["total"] == 0
            detail = visitor.get(f"/api/public/products/{product}").json()["body"]
            assert detail["name"] == "正式精华" and "internal_note" not in detail
            assert visitor.get(f"/api/public/products/{missing}").status_code == 404
            assert visitor.get(f"/api/public/products/{product}", params={"revision": "1"}).status_code == 422
            assert "related_product_id" not in visitor.get(f"/api/public/cases/{case}").json()["body"]
            for page in ("home", "catalog", "cases", "contact"):
                assert visitor.get(f"/api/public/pages/{page}").status_code == 200
    finally:
        with mysql_engine.begin() as db:
            for ident in (product, missing, case, directory):
                db.execute(text("UPDATE content_item SET live_id=NULL WHERE id=:i"), {"i": ident})
                db.execute(text("DELETE FROM draft WHERE item_id=:i"), {"i": ident})
            db.execute(text("DELETE FROM release_place WHERE release_id=:r"), {"r": live})
            for version in (directory_version, live, case_version):
                db.execute(text("DELETE FROM `release` WHERE id=:r"), {"r": version})
            for ident in (product, missing, case):
                db.execute(text("DELETE FROM content_item WHERE id=:i"), {"i": ident})
            for node in (board, first, second, other):
                db.execute(text("DELETE FROM directory_node WHERE id=:i"), {"i": node})
            db.execute(text("DELETE FROM account WHERE id=:i"), {"i": actor})
