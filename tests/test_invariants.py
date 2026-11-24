"""Verify the publication lifecycle under concurrent requests on real InnoDB."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from threading import Barrier

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text


def test_two_connections(mysql_engine, monkeypatch, tmp_path):
    """Different keys compete for one revision; original-key retry, restore and public views stay coherent."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("ASSET_ROOT", str(tmp_path))
    from app.core.security import hash_password
    from main import app

    actors = []
    with mysql_engine.begin() as db:
        directory = db.execute(text("SELECT id,revision FROM content_item WHERE config_slot='directory'")).one()
        for name, publish in (("txn-publisher-one", 1), ("txn-publisher-two", 1), ("txn-editor", 0)):
            actors.append(db.execute(text("INSERT INTO account(login,password_hash,can_edit,can_publish,must_change_password) VALUES (:n,:p,1,:v,0)"),
                                     {"n": name, "p": hash_password("transaction-test-password"), "v": publish}).lastrowid)
    nodes, product, asset = [], None, None
    try:
        options = {"base_url": "https://showcase.test", "client": ("192.0.2.140", 50000)}
        with TestClient(app, **options) as one, TestClient(app, **options) as two, TestClient(app, **options) as editor, TestClient(app, **options) as visitor:
            def login(client, name):
                """Open real, independent sessions for each distinct actor."""
                origin = {"Origin": "https://showcase.test"}
                nonce = client.get("/api/admin/login").json()["csrf_token"]
                response = client.post("/api/admin/login", headers={**origin, "X-CSRF-Token": nonce},
                                       json={"login": name, "password": "transaction-test-password"})
                assert response.status_code == 200
                return {**origin, "X-CSRF-Token": response.json()["csrf_token"]}

            first, second, edit = login(one, "txn-publisher-one"), login(two, "txn-publisher-two"), login(editor, "txn-editor")
            for _ in range(3):
                allocated = editor.post("/api/admin/directory/nodes", headers=edit, json={})
                assert allocated.status_code == 201
                nodes.append(allocated.json()["id"])
            tree = [{"id": node, "parent_id": nodes[0] if i else None, "name": f"目录{i}",
                     "level": "category" if i else "board", "enabled": True, "sort_order": i} for i, node in enumerate(nodes)]
            base = f"/api/admin/items/{directory.id}"
            saved = editor.put(base + "/draft", headers=edit, json={"expected_revision": str(directory.revision), "body": {"nodes": tree}})
            assert saved.status_code == 200
            assert one.post(base + "/publish", headers=first,
                            json={"request_key": "txn-directory", "expected_revision": saved.json()["revision"]}).status_code == 200
            data = BytesIO(); Image.new("RGB", (4, 4), "white").save(data, format="PNG")
            image = editor.post("/api/admin/media", headers=edit, files={"file": ("same.png", data.getvalue(), "image/png")})
            assert image.status_code == 201
            asset = image.json()["id"]
            body = {"name": "首次线上", "short_benefit": "护肤", "benefit": "保湿", "ingredients": "配方资料",
                    "highlights": "轻盈", "formula_no": "TXN-10", "production_status": "待确认",
                    "cover_asset_id": asset, "detail_asset_id": asset}
            created = editor.post("/api/admin/products", headers=edit, json={"body": body, "place_ids": nodes[1:]})
            assert created.status_code == 201
            product = created.json()["id"]
            path = f"/api/admin/items/{product}"

            def assert_eligible(revision):
                """Single and batch checks accept the same cover-only publication data."""
                selection = {"expected_revision": revision}
                checked = one.post(path + "/check", headers=first, json=selection)
                assert checked.status_code == 200 and checked.json()["issues"] == []
                batch = one.post("/api/admin/products/batch-check", headers=first,
                                 json={"items": [{"id": product, **selection}]})
                assert batch.status_code == 200 and batch.json()["items"] == [checked.json()]

            assert_eligible(created.json()["revision"])
            initial = one.post(path + "/publish", headers=first,
                               json={"request_key": "txn-first", "expected_revision": created.json()["revision"]})
            assert initial.status_code == 200
            first_version = initial.json()
            missing = {k: v for k, v in body.items() if k != "detail_asset_id"} | {"name": "核对新版"}
            partial = editor.put(path + "/draft", headers=edit, json={"expected_revision": first_version["revision"],
                                 "body": missing, "place_ids": nodes[1:]}).json()
            assert one.post(path + "/check", headers=first, json={"expected_revision": partial["revision"]}).json()["eligible"] is False
            def public_labels():
                """Read the same product through two genuinely different public directory positions."""
                return [visitor.get("/api/public/products", params={"node_id": node}).json()["items"][0]["body"]["name"] for node in nodes[1:]]
            assert public_labels() == ["首次线上", "首次线上"]
            # A legacy admin client may still send a well-formed ID that never referenced an upload.
            obsolete_thumbnail = "9223372036854775807"
            ready = editor.put(path + "/draft", headers=edit, json={"expected_revision": partial["revision"],
                               "body": {**missing, "detail_asset_id": asset, "thumbnail_asset_id": obsolete_thumbnail},
                               "place_ids": nodes[1:]}).json()
            assert_eligible(ready["revision"])
            assert editor.get(path).json()["draft"]["thumbnail_asset_id"] == obsolete_thumbnail
            barrier = Barrier(2)
            def concurrent(args):
                """Start two HTTP confirmations together using two independently authenticated connections."""
                client, headers, key = args
                barrier.wait(timeout=5)
                return client.post(path + "/publish", headers=headers,
                                   json={"request_key": key, "expected_revision": ready["revision"]})
            choices = ((one, first, "txn-one"), (two, second, "txn-two"))
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(concurrent, choices))
            assert sorted(row.status_code for row in results) == [200, 409]
            winner = next(i for i, row in enumerate(results) if row.status_code == 200)
            delivered = results[winner].json()
            retry = choices[winner][0].post(path + "/publish", headers=choices[winner][1],
                                             json={"request_key": choices[winner][2], "expected_revision": ready["revision"]})
            assert retry.json() == delivered
            assert public_labels() == ["核对新版", "核对新版"]
            live_body = editor.get(path).json()["live"]
            assert "thumbnail_asset_id" not in live_body and live_body["cover_asset_id"] == asset
            restored = editor.post(path + "/versions/1/restore", headers=edit,
                                   json={"expected_revision": delivered["revision"], "confirm_overwrite": False})
            assert restored.status_code == 200 and restored.json()["draft"]["name"] == "首次线上"
            assert public_labels() == ["核对新版", "核对新版"]
            ready = restored.json()
            barrier = Barrier(2)
            with TestClient(app, **options) as peer:
                same_actor = login(peer, "txn-publisher-one")
                with ThreadPoolExecutor(max_workers=2) as pool:
                    same = list(pool.map(concurrent, ((one, first, "txn-one-original"), (peer, same_actor, "txn-one-original"))))
                assert [row.status_code for row in same] == [200, 200]
                assert same[0].json() == same[1].json()
            with mysql_engine.connect() as db:
                for table, predicate, expected in (("`release`", "item_id", 3), ("audit", "target_id", 4)):
                    extra = " AND target_kind='product'" if table == "audit" else ""
                    assert db.scalar(text(f"SELECT COUNT(*) FROM {table} WHERE {predicate}=:i{extra}"), {"i": product}) == expected
            # A directory release that wins before a later product confirmation invalidates those positions.
            revised_tree = editor.get(base).json()["revision"]
            retired = editor.put(base + "/draft", headers=edit, json={"expected_revision": revised_tree,
                                 "body": {"nodes": [{**node, "enabled": index == 0} for index, node in enumerate(tree)]}}).json()
            assert one.post(base + "/publish", headers=first, json={"request_key": "txn-disable-places", "expected_revision": retired["revision"]}).status_code == 200
            before = editor.get(path).json()
            saved = editor.put(path + "/draft", headers=edit, json={"expected_revision": before["revision"],
                               "body": {**body, "name": "仍是草稿"}, "place_ids": nodes[1:]}).json()
            invalidated = one.post(path + "/publish", headers=first, json={"request_key": "txn-invalidated", "expected_revision": saved["revision"]})
            assert invalidated.status_code == 422
            assert editor.get(path).json()["live_id"] == before["live_id"]
            assert visitor.get(f"/api/public/products/{product}").status_code == 404
            with mysql_engine.begin() as db:
                db.execute(text("UPDATE account SET can_publish=0 WHERE id=:a"), {"a": actors[0]})
            denied = one.post(path + "/publish", headers=first, json={"request_key": "txn-revoked", "expected_revision": saved["revision"]})
            assert denied.status_code == 403 and editor.get(path).json()["revision"] == saved["revision"]
    finally:
        with mysql_engine.begin() as db:
            for ident in [directory.id] + ([product] if product is not None else []):
                db.execute(text("UPDATE content_item SET live_id=NULL WHERE id=:i"), {"i": ident})
                for table in ("release_place", "release_asset"):
                    db.execute(text(f"DELETE FROM {table} WHERE release_id IN (SELECT id FROM `release` WHERE item_id=:i)"), {"i": ident})
                db.execute(text("DELETE FROM `release` WHERE item_id=:i"), {"i": ident})
                db.execute(text("DELETE FROM draft WHERE item_id=:i"), {"i": ident})
            db.execute(text("UPDATE content_item SET revision=:rev WHERE id=:i"), {"rev": directory.revision, "i": directory.id})
            if product is not None:
                db.execute(text("DELETE FROM content_item WHERE id=:i"), {"i": product})
            if asset is not None:
                db.execute(text("DELETE FROM asset WHERE id=:i"), {"i": asset})
            for node in nodes:
                db.execute(text("DELETE FROM directory_node WHERE id=:i"), {"i": node})
            for actor in actors:
                db.execute(text("DELETE FROM audit WHERE actor_id=:a"), {"a": actor})
                db.execute(text("DELETE FROM `session` WHERE account_id=:a"), {"a": actor})
                db.execute(text("DELETE FROM account WHERE id=:a"), {"a": actor})
