"""Single FastAPI entrypoint; schema changes are explicit Alembic operations."""
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from fastapi import FastAPI, Request
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.admin_accounts import router as accounts_router
from app.append import router as append_router
from app.auth import router as auth_router
from app.checks import router as checks_router
from app.config import router as config_router
from app.db import engine
from app.history import router as history_router
from app.items import router as items_router
from app.lifecycle import router as lifecycle_router
from app.media import router as media_router
from app.preview import router as preview_router
from app.public import router as public_router
from app.public_media import router as public_media_router
from app.publish import router as publish_router

app = FastAPI(title="产品展示", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(items_router)
app.include_router(config_router)
app.include_router(media_router)
app.include_router(preview_router)
app.include_router(append_router)
app.include_router(checks_router)
app.include_router(publish_router)
app.include_router(lifecycle_router)
app.include_router(history_router)
app.include_router(public_router)
app.include_router(public_media_router)


@app.get("/health/ready")
def readiness() -> JSONResponse:
    """Report schema compatibility without modifying the database or showing connection details."""
    try:
        ini = Path(__file__).resolve().parents[1] / "alembic.ini"
        required = set(ScriptDirectory.from_config(Config(str(ini))).get_heads())
        with engine().connect() as db:
            installed = set(db.scalars(text("SELECT version_num FROM alembic_version")))
        ready = bool(required) and installed == required
    except (CommandError, RuntimeError, SQLAlchemyError):
        ready = False
    return JSONResponse({"status": "ready" if ready else "not_ready"}, status_code=200 if ready else 503,
                        headers={"Cache-Control": "no-store"})


@app.exception_handler(HTTPException)
async def http_error(_request: Request, error: HTTPException) -> JSONResponse:
    """Preserve the agreed error shape and status without reflecting inputs."""
    body = error.detail if isinstance(error.detail, dict) else {
        "code": "http_error", "message": error.detail, "issues": [],
    }
    return JSONResponse(body, status_code=error.status_code, headers=error.headers)


@app.exception_handler(RequestValidationError)
async def bad_input(_request: Request, error: RequestValidationError) -> JSONResponse:
    """Return field paths, never FastAPI's echoed raw request values or passwords."""
    issues = [{"field": ".".join(map(str, issue["loc"][1:])), "reason": "输入格式无效"}
              for issue in error.errors()]
    return JSONResponse({"code": "invalid_input", "message": "请求参数无效", "issues": issues}, status_code=422)


@app.middleware("http")
async def no_private_cache(request: Request, call_next):
    """Prevent auth responses, including current capabilities and CSRF, from being cached."""
    response = await call_next(request)
    if request.url.path.startswith("/api/admin/"):
        response.headers["Cache-Control"] = "private, no-store"
    return response
