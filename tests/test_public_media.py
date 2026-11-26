"""Only a current observable publication makes an image publicly readable."""
import json
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text


def test_public_original_revalidates_without_losing_range_or_file_checks(monkeypatch, tmp_path):
    """Reuse the original bytes when the validator matches an available public file."""
    from app.controllers.public import media as public_media
    from app.core.db import session
    from app.models import Asset
    from main import app

    monkeypatch.setenv("ASSET_ROOT", str(tmp_path))
    source = tmp_path / "cover"
    Image.new("RGB", (3, 3), "blue").save(source, format="PNG")
    original_bytes = source.read_bytes()
    asset = Asset(id=42, storage_key=source.name, mime="image/png")
    monkeypatch.setitem(app.dependency_overrides, session, lambda: None)
    monkeypatch.setattr(public_media, "public_asset", lambda _db, _id: asset)

    with TestClient(app) as visitor:
        route = "/api/public/media/42"
        first = visitor.get(route)
        assert first.status_code == 200 and first.content == original_bytes
        etag = first.headers["etag"]
        matching = visitor.get(route, headers=[("If-None-Match", '"other"'), ("If-None-Match", f"W/{etag}")])
        assert matching.status_code == 304 and matching.content == b""
        assert matching.headers["etag"] == etag
        assert matching.headers["cache-control"] == first.headers["cache-control"] == "private, no-cache"
        assert "content-length" not in matching.headers
        assert visitor.get(route, headers={"If-None-Match": "*"}).status_code == 304

        partial = visitor.get(route, headers={"If-None-Match": '"different"', "Range": "bytes=0-7"})
        assert partial.status_code == 206 and partial.content == original_bytes[:8]
        assert partial.headers["content-range"] == f"bytes 0-7/{len(original_bytes)}"

        source.unlink()
        missing = visitor.get(route, headers={"If-None-Match": etag})
        assert missing.status_code == 404 and missing.json()["code"] == "media_not_found"
        assert missing.headers["cache-control"] == "no-store"


def test_public_cover_thumbnail_serves_original_when_missing_and_checks_access(monkeypatch, tmp_path):
    """Derive a small image from the original without bypassing current publication checks."""
    from app.controllers.public import media as public_media
    from app.core.db import session
    from app.models import Asset
    from app.services.media import media_not_found
    from main import app

    monkeypatch.setenv("ASSET_ROOT", str(tmp_path))
    source = tmp_path / "original-cover"
    original_image = Image.new("RGB", (960, 540), "green")
    original_image.paste("red", (0, 0, 180, 540))
    original_image.save(source, format="PNG")
    old = tmp_path / ".thumbnails" / f"{source.name}.v1.webp"
    old.parent.mkdir()
    Image.new("RGB", (320, 320), "green").save(old, format="WEBP")
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
        derivative = visitor.get(route, headers={"If-None-Match": original.headers["etag"]})
        assert derivative.status_code == 200
        assert derivative.headers["content-type"] == "image/webp"
        assert derivative.headers["cache-control"] == "private, no-cache"
        validator = {"If-None-Match": derivative.headers["etag"]}
        cached = visitor.get(route, headers=validator)
        assert cached.status_code == 304 and cached.content == b""
        with Image.open(BytesIO(derivative.content)) as image:
            assert image.format == "WEBP" and image.size == (320, 320)
            assert min(image.getpixel((10, 20))) > 240
            assert image.getpixel((10, 160))[0] > 240
        assert visitor.get("/api/public/media/42").content == original.content

        visible = False
        withdrawn = visitor.get(route, headers=validator)
        assert withdrawn.status_code == 404 and withdrawn.headers["cache-control"] == "no-store"


def test_public_display_images_use_an_aspect_preserving_thumbnail(monkeypatch, tmp_path):
    from app.controllers.public import media as public_media
    from app.core.db import session
    from app.models import Asset
    from app.services import public_catalog
    from app.services.media import media_not_found
    from main import app

    monkeypatch.setenv("ASSET_ROOT", str(tmp_path))
    source = tmp_path / "case.png"
    Image.new("RGB", (1280, 640), "green").save(source)
    asset = Asset(id=42, storage_key=source.name, mime="image/png")
    body = {"brand_name": "独立案例", "image_asset_id": "42"}
    visible = True

    def check_access(_db, ident):
        assert ident == asset.id
        if not visible:
            raise media_not_found()
        return asset

    monkeypatch.setitem(app.dependency_overrides, session, lambda: None)
    monkeypatch.setattr(public_media, "public_asset", check_access)
    monkeypatch.setattr(public_catalog.releases, "case_snapshots", lambda _db, _id=None: [(1, body)] if visible else [])
    monkeypatch.setattr(public_catalog.releases, "slot_body", lambda _db, slot: {"cover_asset_id": "42"}
                        if slot == "catalog_cover" else {"poster_asset_ids": ["42"]})

    original = "/api/public/media/42"
    variant = f"{original}/display-thumbnail"
    listing = public_catalog.list_cases(None, None, None, 1, 20)["items"][0]["body"]
    assert listing["image_asset_url"] == original and listing["image_thumbnail_url"] == variant
    detail = public_catalog.case_detail(None, 1)["body"]
    assert detail["image_asset_url"] == original and "image_thumbnail_url" not in detail
    catalog = public_catalog.page_content(None, "catalog")["body"]
    assert catalog["cover_asset_url"] == original and catalog["cover_thumbnail_url"] == variant
    assert public_catalog.page_content(None, "home")["body"] == {"poster_asset_urls": [original]}

    with TestClient(app) as visitor:
        assert visitor.get(variant).content == source.read_bytes()

        from app.services.thumbnails import ensure_cover_thumbnail, ensure_display_thumbnail

        assert ensure_cover_thumbnail(asset)
        assert ensure_display_thumbnail(asset)
        assert not ensure_display_thumbnail(asset)
        thumbnail = visitor.get(variant)
        assert thumbnail.headers["content-type"] == "image/webp"
        with Image.open(BytesIO(thumbnail.content)) as image:
            assert image.size == (960, 480)
        with Image.open(BytesIO(visitor.get(f"{original}/thumbnail").content)) as image:
            assert image.size == (320, 320)
        assert visitor.get(original).content == source.read_bytes()

        validator = {"If-None-Match": thumbnail.headers["etag"]}
        assert visitor.get(variant, headers=validator).status_code == 304
        visible = False
        withdrawn = visitor.get(variant, headers=validator)
        assert withdrawn.status_code == 404 and withdrawn.headers["cache-control"] == "no-store"


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
        actor = db.execute(text("INSERT INTO account(login,password_hash,can_edit,can_publish,must_change_password) VALUES ('media-public-test',:p,1,1,0)"),
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
            revalidate = {"If-None-Match": first.headers["etag"]}
            assert first.headers["cache-control"] == "private, no-cache"
            thumbnail = visitor.get(variant)
            assert thumbnail.headers["content-type"] == "image/webp"
            thumbnail_validator = {"If-None-Match": thumbnail.headers["etag"]}
            nonce = editor.get("/api/admin/login").json()["csrf_token"]
            headers = {"Origin": "https://showcase.test", "X-CSRF-Token": nonce}
            signed_in = editor.post("/api/admin/login", headers=headers,
                                    json={"login": "media-public-test", "password": "media-public-password"})
            assert signed_in.status_code == 200
            headers["X-CSRF-Token"] = signed_in.json()["csrf_token"]
            for index, owner in enumerate(owners):
                withdrawn = editor.post(f"/api/admin/items/{owner}/unlist", headers=headers,
                                        json={"confirmed": True, "expected_revision": "0"})
                assert withdrawn.status_code == 200 and withdrawn.json()["live_id"] is None
                rechecked = visitor.get(route, headers=revalidate)
                assert rechecked.status_code == (304 if index == 0 else 404)
                if index == 1:
                    assert rechecked.headers["cache-control"] == "no-store"
                assert visitor.get(variant, headers=thumbnail_validator).status_code == (304 if index == 0 else 404)
            history = editor.get(f"/api/admin/media/{asset}", params={"item_id": str(owners[0]), "seq": 1}, headers=revalidate)
            assert history.status_code == 200 and history.content == path.read_bytes()
            assert history.headers["cache-control"] == "private, no-store"
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
            db.execute(text("DELETE FROM audit WHERE actor_id=:a"), {"a": actor})
            db.execute(text("DELETE FROM account WHERE id=:a"), {"a": actor})
