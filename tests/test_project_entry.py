"""PyCharm runs main.py directly; tests exercise the ASGI app without binding a port."""
from pathlib import Path
import os
import subprocess
import sys

from fastapi.testclient import TestClient
import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_root_entry_import_is_inert_from_another_working_directory(tmp_path):
    assert (ROOT / 'main.py').is_file(), 'PyCharm needs a versioned root main.py'
    code = """import runpy, sys
from unittest.mock import patch
from pathlib import Path
root = Path(sys.argv[1]); sys.path.insert(0, str(root))
read_text = Path.read_text
def public_files_only(path, *args, **kwargs):
    assert '.local' not in path.parts, 'private config was read on import'
    return read_text(path, *args, **kwargs)
with patch.object(Path, 'read_text', public_files_only), patch('uvicorn.run', side_effect=AssertionError('listener on import')), \\
     patch('sqlalchemy.engine.Engine.connect', side_effect=AssertionError('DB on import')):
    ns = runpy.run_path(str(root / 'main.py'), run_name='imported_entry')
    assert callable(ns['app'])
"""
    env = {k: v for k, v in os.environ.items() if k not in ('DATABASE_URL', 'ASSET_ROOT')}
    subprocess.run([sys.executable, '-I', '-B', '-c', code, str(ROOT)], cwd=tmp_path, env=env, check=True)


def test_pycharm_script_dispatches_local_site_without_connecting(tmp_path, monkeypatch):
    import runpy
    import uvicorn
    from sqlalchemy.engine import Engine

    for key, filename in [('SHOWCASE_TLS_CERT_FILE', 'dev.crt'), ('SHOWCASE_TLS_KEY_FILE', 'dev.key')]:
        file = tmp_path / filename
        file.touch()
        monkeypatch.setenv(key, str(file))
    monkeypatch.setenv('DATABASE_URL', 'mysql+pymysql://localhost/unused')
    monkeypatch.setenv('ASSET_ROOT', str(tmp_path / 'media'))
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(Engine, 'connect', lambda *a, **kw: pytest.fail('unexpected DB access on launch'))
    calls = []
    monkeypatch.setattr(uvicorn, 'run', lambda site, **opts: calls.append((site, opts)))
    runpy.run_path(str(ROOT / 'main.py'), run_name='__main__')
    assert len(calls) == 1 and callable(calls[0][0]) and calls[0][1]['port'] == 5144
    assert calls[0][1]['proxy_headers'] is False


def test_local_mounts_preserve_api_paths_methods_and_private_cache(tmp_path, monkeypatch):
    from app.application import create_app
    from app.local import local_site

    from app.services import health

    def unavailable():
        raise RuntimeError('isolated readiness test')

    monkeypatch.setattr(health, 'engine', unavailable)
    for dist, marker in [('frontend/admin/dist', 'admin SPA'), ('frontend/h5/dist/build/h5', 'visitor SPA')]:
        d = tmp_path / dist
        d.mkdir(parents=True)
        (d / 'index.html').write_text(marker, encoding='utf-8')
        (d / 'fixture.js').write_text('/* static asset */', encoding='utf-8')
    with TestClient(local_site(create_app(), tmp_path), base_url='https://localhost:5144') as client:
        assert client.get('/admin', follow_redirects=False).headers['location'] == '/admin/'
        assert client.get('/admin/products/7').text == 'admin SPA'
        assert client.get('/preview?id=7&revision=2').text == 'visitor SPA'
        assert client.get('/admin/fixture.js').text == '/* static asset */'
        assert client.get('/missing.js').status_code == 404
        for path in ('/api', '/api/unknown', '/health/unknown'):
            reply = client.get(path)
            assert reply.status_code == 404 and reply.json()['code'] == 'http_error'
        reply = client.get('/api/admin/login')
        assert reply.status_code == 200 and reply.json()['csrf_token']
        assert reply.headers['cache-control'] == 'private, no-store'
        assert client.post('/health/ready').status_code == 405
        ready = client.get('/health/ready')
        assert ready.status_code == 503 and ready.json() == {'status': 'not_ready'}


def test_missing_frontend_build_does_not_hide_api(tmp_path):
    from app.application import create_app
    from app.local import local_site

    with TestClient(local_site(create_app(), tmp_path), base_url='https://localhost:5144') as client:
        for url in ('/', '/catalog', '/admin/'):
            response = client.get(url)
            assert response.status_code == 503 and 'npm --prefix frontend run build' in response.text
        assert client.get('/api/missing').status_code == 404


def test_local_launcher_uses_private_defaults_or_environment(tmp_path, monkeypatch):
    import uvicorn
    from app.application import create_app
    from app.local import run_local

    for key in ('SHOWCASE_DATABASE_URL_FILE', 'SHOWCASE_TLS_CERT_FILE', 'SHOWCASE_TLS_KEY_FILE'):
        monkeypatch.delenv(key, raising=False)
    for key in ('DATABASE_URL', 'ASSET_ROOT'):
        monkeypatch.setenv(key, '')
    private = tmp_path / '.local' / 'showcase'
    private.mkdir(parents=True)
    (private / 'database.url').write_text('mysql+pymysql://localhost/disposable', encoding='utf-8')
    for file in ('tls.crt', 'tls.key'):
        (private / file).touch()
    started = []
    monkeypatch.setattr(uvicorn, 'run', lambda site, **opts: started.append(opts))
    run_local(create_app(), tmp_path)
    assert os.environ['DATABASE_URL'] == 'mysql+pymysql://localhost/disposable'
    assert Path(os.environ['ASSET_ROOT']) == private / 'media'
    assert started[0]['host'] == '127.0.0.1' and started[0]['port'] == 5144
    assert Path(started[0]['ssl_keyfile']) == private / 'tls.key'
    monkeypatch.setenv('DATABASE_URL', 'mysql+pymysql://localhost/override')
    monkeypatch.setenv('ASSET_ROOT', str(tmp_path / 'media-override'))
    monkeypatch.setenv('SHOWCASE_DATABASE_URL_FILE', 'not-used')
    (private / 'database.url').unlink()
    run_local(create_app(), tmp_path)
    assert os.environ['DATABASE_URL'].endswith('/override') and Path(os.environ['ASSET_ROOT']) == tmp_path / 'media-override'
    (private / 'tls.key').unlink()
    with pytest.raises(RuntimeError, match='TLS'):
        run_local(create_app(), tmp_path)
    assert len(started) == 2
