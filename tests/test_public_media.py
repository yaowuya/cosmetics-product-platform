"""Only a current observable publication makes an image publicly readable."""
import json
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text


def test_public_cover_thumbnail_serves_original_when_missing_and_checks_access(monkeypatch, tmp_path):
    """Derive a small image from the original without bypassing current publication checks."""
    from app.controllers.public import media as public_media
    from app.core.db import session
    from app.models import Asset
    from app.services.media import media_not_found
    from main import app

    monkeypatch.setenv("ASSET_ROOT", str(tmp_path))
    source = tmp_path / "original-cover"
    Image.new("RGB", (960, 540), "green").save(source, format="PNG")
    asset = Asset(id=42, storage_key=source.name, mime="image/png")
    visible = True

    def check_access(_db, ident):
        assert ident == asset.id
        if not visible:
            raise media_not_found()
        return asset

    monkeypatch.setitem(app.dependency_overrides, session, lambda: None)
    monkeypatch.setattr(public_media, "public_asset", check_access)
    with TestClient(app) as visitor:
        route = "/api/public/media/42/thumbnail"
        original = visitor.get(route)
        assert original.status_code == 200 and original.content == source.read_bytes()

        from app.services.thumbnails import ensure_cover_thumbnail

        assert ensure_cover_thumbnail(asset) is True
        assert ensure_cover_thumbnail(asset) is False
        derivative = visitor.get(route)
        assert derivative.headers["content-type"] == "image/webp"
        assert derivative.headers["cache-control"] == "no-store"
        with Image.open(BytesIO(derivative.content)) as image:
            assert image.format == "WEBP" and image.size == (320, 320)
        assert visitor.get("/api/public/media/42").content == original.content

        visible = False
        assert visitor.get(route).status_code == 404


def test_last_reference(mysql_engine, monkeypatch, tmp_path):
    """Shared exposure survives one withdrawal; historical references never keep it public."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("ASSET_ROOT", str(tmp_path))
    from app.core.security import hash_password
    from app.models import Asset
    from app.services.thumbnails import ensure_cover_thumbnail
    from main import app

    path = tmp_path / "stored-image"
    Image.new("RGB", (3, 3), "blue").save(path, format="PNG")
    owners, releases = [], []
    with mysql_engine.begin() as db:
        actor = db.execute(text("INSERT INTO account(login,password_hash,can_edit,must_change_password) VALUES ('media-public-test',:p,1,0)"),
                           {"p": hash_password("media-public-password")}).lastrowid
        asset = db.execute(text("INSERT INTO asset(storage_key,mime,bytes,created_by) VALUES ('stored-image','image/png',:b,:a)"),
                           {"b": path.stat().st_size, "a": actor}).lastrowid
        for i in range(2):
            owner = db.execute(text("INSERT INTO content_item(kind) VALUES ('case')")).lastrowid
            owners.append(owner)
            body = json.dumps({"brand_name": f"分开案例{i}", "image_asset_id": str(asset)})
            version = db.execute(text("INSERT INTO `release`(item_id,seq,source_revision,body,actor_id) VALUES (:i,1,0,:b,:a)"),
                                 {"i": owner, "b": body, "a": actor}).lastrowid
            releases.append(version)
            db.execute(text("INSERT INTO release_asset(release_id,asset_id) VALUES (:r,:a)"), {"r": version, "a": asset})
            db.execute(text("UPDATE content_item SET live_id=:v WHERE id=:i"), {"v": version, "i": owner})
    try:
        assert ensure_cover_thumbnail(Asset(id=asset, storage_key=path.name, mime="image/png"))
        with TestClient(app, base_url="https://showcase.test", client=("192.0.2.130", 50000)) as visitor, TestClient(app, base_url="https://showcase.test", client=("192.0.2.130", 50000)) as editor:
            route = f"/api/public/media/{asset}"
            variant = f"{route}/thumbnail"
            first = visitor.get(route)
            assert first.status_code == 200 and first.content == path.read_bytes()
            assert "no-store" in first.headers["cache-control"]
            assert visitor.get(variant).headers["content-type"] == "image/webp"
            for index, owner in enumerate(owners):
                with mysql_engine.begin() as db:
                    db.execute(text("UPDATE content_item SET live_id=NULL WHERE id=:i"), {"i": owner})
                assert visitor.get(route).status_code == (200 if index == 0 else 404)
                assert visitor.get(variant).status_code == (200 if index == 0 else 404)
            nonce = editor.get("/api/admin/login").json()["csrf_token"]
            signed_in = editor.post("/api/admin/login", headers={"Origin": "https://showcase.test", "X-CSRF-Token": nonce},
                                    json={"login": "media-public-test", "password": "media-public-password"})
            assert signed_in.status_code == 200
            assert editor.get(f"/api/admin/media/{asset}", params={"item_id": str(owners[0]), "seq": 1}).content == path.read_bytes()
    finally:
        with mysql_engine.begin() as db:
            for owner in owners:
                db.execute(text("UPDATE content_item SET live_id=NULL WHERE id=:i"), {"i": owner})
            for version in releases:
                db.execute(text("DELETE FROM release_asset WHERE release_id=:i"), {"i": version})
                db.execute(text("DELETE FROM `release` WHERE id=:i"), {"i": version})
            for owner in owners:
                db.execute(text("DELETE FROM content_item WHERE id=:i"), {"i": owner})
            db.execute(text("DELETE FROM asset WHERE id=:i"), {"i": asset})
            db.execute(text("DELETE FROM `session` WHERE account_id=:a"), {"a": actor})
            db.execute(text("DELETE FROM account WHERE id=:a"), {"a": actor})
