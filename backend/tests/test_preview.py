"""Private media access is bound to an uploader or a specific content reference."""
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text


def test_private_upload_preview(mysql_engine, monkeypatch, tmp_path):
    """Use real saved revisions to distinguish private references from unknown images."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("ASSET_ROOT", str(tmp_path))
    from app.auth import hash_password
    from app.main import app

    with mysql_engine.begin() as db:
        password_hash = hash_password("preview-test-password")
        actors = [db.execute(text("INSERT INTO account (login,password_hash,can_edit,can_manage,must_change_password) VALUES (:name,:hash,:edit,:manage,0)"),
                             {"name": name, "hash": password_hash, "edit": edit, "manage": not edit}).lastrowid
                  for name, edit in (("image-uploader", True), ("image-editor", True), ("image-manager", False))]
    asset = item = None
    image = BytesIO()
    Image.new("RGB", (4, 4), "white").save(image, format="PNG")
    png = image.getvalue()
    try:
        # Keep this test's synthetic peer separate from other API suites' login-rate windows.
        options = {"base_url": "https://showcase.test", "client": ("192.0.2.60", 50000)}
        with TestClient(app, **options) as one, TestClient(app, **options) as two, TestClient(app, **options) as manager:
            def login(client, name):
                """Use separate real server sessions for the uploader, another editor and a manager."""
                origin = {"Origin": "https://showcase.test"}
                token = client.get("/api/admin/login").json()["csrf_token"]
                result = client.post("/api/admin/login", headers={**origin, "X-CSRF-Token": token},
                                     json={"login": name, "password": "preview-test-password"})
                assert result.status_code == 200
                return {**origin, "X-CSRF-Token": result.json()["csrf_token"]}

            upload = login(one, "image-uploader")
            login(two, "image-editor")
            login(manager, "image-manager")
            endpoint = "/api/admin/media"
            assert one.post(endpoint, headers=upload, files={"file": ("normal.png", b"not an image", "image/png")}).status_code == 422
            assert one.post(endpoint, headers=upload, files={"file": ("normal.png", png, "image/jpeg")}).status_code == 422
            assert not list(tmp_path.iterdir())
            limit = str(tmp_path / "not-a-directory")
            (tmp_path / "not-a-directory").write_bytes(b"")
            with monkeypatch.context() as rejected:
                rejected.setenv("ASSET_ROOT", limit)
                assert one.post(endpoint, headers=upload, files={"file": ("normal.png", png, "image/png")}).status_code == 503
            (tmp_path / "not-a-directory").unlink()
            with mysql_engine.connect() as db:
                assert db.scalar(text("SELECT COUNT(*) FROM asset WHERE created_by=:id"), {"id": actors[0]}) == 0
            made = one.post(endpoint, headers=upload, files={"file": ("normal.png", png, "image/png")})
            assert made.status_code == 201
            asset = made.json()["id"]
            location = made.json()["url"]
            assert one.get(location).content == png
            assert two.get(location).status_code == 404
            assert manager.get(location).status_code == 403
            product = one.post("/api/admin/products", headers=upload, json={"body": {"name": "测试图稿", "detail_asset_id": asset}}).json()
            item = product["id"]
            route = f"/api/admin/items/{item}/preview"
            params = {"revision": product["revision"]}
            preview = two.get(route, params=params)
            assert preview.status_code == 200 and "no-store" in preview.headers["cache-control"]
            bound = preview.json()["media_urls"][asset]
            assert two.get(bound).content == png
            assert two.get(location, params={"item_id": item, "revision": "0"}).status_code == 404
            assert manager.get(route, params=params).status_code == 403
            assert one.put(f"/api/admin/items/{item}/draft", headers=upload,
                           json={"expected_revision": product["revision"], "body": {"name": "移除图片"}}).status_code == 200
            assert two.get(route, params=params).status_code == 409
            assert two.get(bound).status_code == 404
            with mysql_engine.begin() as db:
                historic = db.execute(text(
                    "INSERT INTO `release`(item_id,seq,source_revision,body,actor_id) "
                    "VALUES (:item,1,1,JSON_OBJECT('detail_asset_id',:asset),:actor)"
                ), {"item": item, "asset": asset, "actor": actors[0]}).lastrowid
                db.execute(text("INSERT INTO release_asset(release_id,asset_id) VALUES (:r,:a)"), {"r": historic, "a": asset})
            assert two.get(location, params={"item_id": item, "seq": 1}).content == png
            assert two.get(location, params={"item_id": item, "seq": 2}).status_code == 404
    finally:
        with mysql_engine.begin() as db:
            if item is not None:
                db.execute(text("DELETE FROM release_asset WHERE release_id IN (SELECT id FROM `release` WHERE item_id=:id)"), {"id": item})
                db.execute(text("DELETE FROM `release` WHERE item_id=:id"), {"id": item})
                db.execute(text("DELETE FROM content_item WHERE id=:id"), {"id": item})
            if asset is not None:
                db.execute(text("DELETE FROM asset WHERE id=:id"), {"id": asset})
            for actor in actors:
                db.execute(text("DELETE FROM `session` WHERE account_id=:id"), {"id": actor})
                db.execute(text("DELETE FROM account WHERE id=:id"), {"id": actor})
