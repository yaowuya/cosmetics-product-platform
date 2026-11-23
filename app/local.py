"""Loopback HTTPS host for PyCharm; deployment continues to use Uvicorn and Caddy separately."""
import os
from pathlib import Path

import uvicorn
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError
from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import PlainTextResponse, RedirectResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send


class _SpaFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code != 404 or Path(path).suffix:
                raise
            return await super().get_response('index.html', scope)


def _frontend(directory: Path) -> ASGIApp:
    if (directory / 'index.html').is_file():
        return _SpaFiles(directory=directory, html=True)
    return PlainTextResponse('前端尚未构建，请在项目根目录运行 npm --prefix frontend run build，然后重新启动本地入口。',
                             status_code=503)


def local_site(api: ASGIApp, project_root: Path) -> ASGIApp:
    """Only frontend navigation gets SPA fallback. Keep API 404/405, headers and lifespan intact."""
    async def admin_root(request: Request) -> RedirectResponse:
        query = request.url.query
        return RedirectResponse('/admin/' + (f'?{query}' if query else ''), status_code=308)

    web = Starlette(routes=[
        Route('/admin', admin_root),
        Mount('/admin', app=_frontend(project_root / 'frontend/admin/dist')),
        Mount('/', app=_frontend(project_root / 'frontend/h5/dist/build/h5')),
    ])

    async def site(scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get('path', '')
        is_api = path in ('/api', '/health') or path.startswith(('/api/', '/health/'))
        target = api if scope['type'] != 'http' or is_api else web
        await target(scope, receive, send)

    return site


def _setting_path(name: str, default: Path, root: Path) -> Path:
    value = os.environ.get(name)
    return (root / value).resolve() if value else default


def run_local(api: ASGIApp, project_root: Path) -> None:
    """Load machine-local settings only on explicit Run, and never serve admin cookies over plain HTTP."""
    local = project_root / '.local/showcase'
    cert = _setting_path('SHOWCASE_TLS_CERT_FILE', local / 'tls.crt', project_root)
    key = _setting_path('SHOWCASE_TLS_KEY_FILE', local / 'tls.key', project_root)
    if not cert.is_file() or not key.is_file():
        raise RuntimeError('缺少本地 TLS 证书或私钥。配置 SHOWCASE_TLS_CERT_FILE、SHOWCASE_TLS_KEY_FILE（见 README）。')
    url = os.environ.get('DATABASE_URL', '').strip()
    if not url:
        secret = _setting_path('SHOWCASE_DATABASE_URL_FILE', local / 'database.url', project_root)
        try:
            url = secret.read_text(encoding='utf-8-sig').strip()
        except (OSError, UnicodeError):
            raise RuntimeError('未配置 DATABASE_URL，且无法读取本机数据库连接文件（见 README）。') from None
    try:
        if make_url(url).drivername != 'mysql+pymysql':
            raise ValueError
    except (ArgumentError, ValueError, TypeError):
        raise RuntimeError('本机数据库连接配置无效；需要 mysql+pymysql 连接串。') from None
    os.environ['DATABASE_URL'] = url
    os.environ['ASSET_ROOT'] = str(_setting_path('ASSET_ROOT', local / 'media', project_root))
    uvicorn.run(local_site(api, project_root), host='127.0.0.1', port=5144,
                ssl_certfile=str(cert), ssl_keyfile=str(key), proxy_headers=False, access_log=False)
