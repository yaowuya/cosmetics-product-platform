"""Assemble the API independently of listeners, credentials, migrations and frontend builds."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.controllers import system
from app.controllers.admin import accounts, append, auth, checks, config, history, items, lifecycle, media, preview, publish
from app.controllers.public import catalog, media as public_media
from app.core.errors import AppError


def create_app() -> FastAPI:
    """Build a fresh API for ASGI hosting, PyCharm or in-process tests. Never open the database here."""
    api = FastAPI(title="产品展示", docs_url=None, redoc_url=None, openapi_url=None)
    for module in (auth, accounts, items, config, media, preview, append, checks, publish, lifecycle, history,
                   catalog, public_media, system):
        api.include_router(module.router)

    @api.exception_handler(AppError)
    async def business_error(_request: Request, error: AppError) -> JSONResponse:
        return JSONResponse(error.detail, status_code=error.status_code)

    @api.exception_handler(HTTPException)
    async def http_error(_request: Request, error: HTTPException) -> JSONResponse:
        body = error.detail if isinstance(error.detail, dict) else {
            "code": "http_error", "message": error.detail, "issues": [],
        }
        return JSONResponse(body, status_code=error.status_code, headers=error.headers)

    @api.exception_handler(RequestValidationError)
    async def bad_input(_request: Request, error: RequestValidationError) -> JSONResponse:
        # The framework's raw validation details can include submitted passwords.
        issues = [{"field": ".".join(map(str, issue["loc"][1:])), "reason": "输入格式无效"}
                  for issue in error.errors()]
        return JSONResponse({"code": "invalid_input", "message": "请求参数无效", "issues": issues}, status_code=422)

    @api.middleware('http')
    async def no_private_cache(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith('/api/admin/'):
            response.headers['Cache-Control'] = 'private, no-store'
        return response

    return api
