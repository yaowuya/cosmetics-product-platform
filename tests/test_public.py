"""Public projections are release-only, scoped to active directory paths and whitelisted fields."""
import json
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text
from sqlalchemy.orm import Session


def test_live_projection(mysql_engine, monkeypatch, tmp_path):
    """Keep public product images consistent across both snapshots and legacy clients."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("ASSET_ROOT", str(tmp_path))
    from app.cli.backfill_thumbnails import visible_covers
    from app.core.security import hash_password
    from app.services.thumbnails import ensure_cover_thumbnail
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
        def put(owner, body, seq=1):
            """Seed both historical and cover-only snapshots without running the current writer."""
            return db.execute(text("INSERT INTO `release`(item_id,seq,source_revision,body,actor_id) VALUES (:i,:seq,:rev,:b,:a)"),
                              {"i": owner, "seq": seq, "rev": seq - 1, "b": json.dumps(body), "a": actor}).lastrowid

        images = {}
        for color in ("blue", "green", "red", "purple", "yellow"):
            image = tmp_path / f"{color}.png"
            Image.new("RGB", (640, 360), color).save(image)
            ident = db.execute(text("INSERT INTO asset(storage_key,mime,bytes,created_by) VALUES (:key,'image/png',:b,:a)"),
                               {"key": image.name, "b": image.stat().st_size, "a": actor}).lastrowid
            images[color] = str(ident), image.read_bytes()
        thumbnail, cover, long_image, first_long, second_long = [
            images[color][0] for color in ("blue", "green", "red", "purple", "yellow")
        ]
        directory_version = put(directory, {"nodes": nodes})
        product_body = {"name": "正式精华", "short_benefit": "保湿", "formula_no": "FORM-72", "internal_note": "private",
                        "cover_asset_id": cover, "detail_asset_id": long_image}
        live = put(product, {**product_body, "thumbnail_asset_id": thumbnail})
        replacement = put(product, {**product_body, "detail_asset_ids": [first_long, second_long]}, seq=2)
        case_version = put(case, {"brand_name": "独立案例", "product_name": "案例名称", "related_product_id": str(product)})
        for owner, version in ((directory, directory_version), (product, live), (case, case_version)):
            db.execute(text("UPDATE content_item SET live_id=:v WHERE id=:i"), {"v": version, "i": owner})
        for version in (live, replacement):
            for node in (first, second):
                db.execute(text("INSERT INTO release_place(release_id,node_id) VALUES (:r,:n)"), {"r": version, "n": node})
            # Even an old index entry for the overridden singular field must not keep it public.
            active_assets = (thumbnail, cover, long_image) if version == live else (cover, long_image, first_long, second_long)
            for ident in active_assets:
                db.execute(text("INSERT INTO release_asset(release_id,asset_id) VALUES (:r,:a)"), {"r": version, "a": ident})
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
            thumbnail_url, cover_url, detail_url = [f"/api/public/media/{ident}" for ident in (thumbnail, cover, long_image)]
            card = listing["items"][0]["body"]
            assert card["cover_asset_url"] == card["thumbnail_asset_url"] == card["catalog_image_url"] == thumbnail_url
            assert detail["cover_asset_url"] == cover_url
            assert detail["detail_asset_url"] == detail_url and detail["detail_asset_urls"] == [detail_url]
            variant_url = card["cover_thumbnail_url"]
            assert variant_url == f"{thumbnail_url}/thumbnail" and "cover_thumbnail_url" not in detail
            assert visitor.get(variant_url).content == images["blue"][1]
            with Session(mysql_engine) as db:
                covers = visible_covers(db)
                assert [str(asset.id) for asset in covers] == [thumbnail]
                assert ensure_cover_thumbnail(covers[0]) is True
                assert ensure_cover_thumbnail(covers[0]) is False
            variant = visitor.get(variant_url)
            assert variant.status_code == 200 and variant.headers["content-type"] == "image/webp"
            with Image.open(BytesIO(variant.content)) as image:
                assert image.size == (320, 320)
                assert min(image.getpixel((1, 1))) > 240
                assert image.getpixel((1, 160))[2] > 230
            assert visitor.get(thumbnail_url).content == images["blue"][1]
            assert visitor.get(cover_url).content == images["green"][1]
            assert visitor.get(detail_url).content == images["red"][1]

            with mysql_engine.begin() as db:
                db.execute(text("UPDATE content_item SET live_id=:v WHERE id=:i"), {"v": replacement, "i": product})
            after = visitor.get("/api/public/products", params={"board_id": str(board)}).json()["items"][0]["body"]
            assert set(after) == {"name", "short_benefit"}
            for withdrawn in (thumbnail_url, variant_url, detail_url):
                assert visitor.get(withdrawn).status_code == 404
            assert visitor.get(cover_url).content == images["green"][1]
            detail = visitor.get(f"/api/public/products/{product}").json()["body"]
            gallery = [f"/api/public/media/{ident}" for ident in (first_long, second_long)]
            assert detail["detail_asset_urls"] == gallery and detail["detail_asset_url"] == gallery[0]
            assert [visitor.get(url).content for url in gallery] == [images[color][1] for color in ("purple", "yellow")]
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
            for version in (live, replacement):
                db.execute(text("DELETE FROM release_place WHERE release_id=:r"), {"r": version})
                db.execute(text("DELETE FROM release_asset WHERE release_id=:r"), {"r": version})
            for version in (directory_version, live, replacement, case_version):
                db.execute(text("DELETE FROM `release` WHERE id=:r"), {"r": version})
            for ident, _ in images.values():
                db.execute(text("DELETE FROM asset WHERE id=:a"), {"a": ident})
            for ident in (product, missing, case):
                db.execute(text("DELETE FROM content_item WHERE id=:i"), {"i": ident})
            for node in (board, first, second, other):
                db.execute(text("DELETE FROM directory_node WHERE id=:i"), {"i": node})
            db.execute(text("DELETE FROM account WHERE id=:i"), {"i": actor})
