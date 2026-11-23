"""后台 HTTP 依赖：从浏览器会话取得当前操作者，并校验写请求的来源和 CSRF。"""
import hmac
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.db import session
from app.core.errors import AppError
from app.core.security import token_digest
from app.models import Account, UserSession
from app.services import auth

Db = Annotated[Session, Depends(session)]
SESSION_COOKIE = "showcase_session"


def csrf_for(token: str) -> str:
    """生成可返回给浏览器的防伪值，不暴露 bearer 或其库内摘要。"""
    return token_digest(f"csrf:{token}")


def check_csrf(request: Request, expected: str | None) -> None:
    """先验同源 HTTPS，再恒时比较请求头与服务端预期的防伪值。"""
    if request.url.scheme != "https" or request.headers.get("origin") != f"https://{request.url.netloc}":
        raise AppError(403, "invalid_origin", "请求来源无效")
    sent = request.headers.get("x-csrf-token", "")
    if not expected or not hmac.compare_digest(sent.encode(), expected.encode()):
        raise AppError(403, "invalid_csrf", "请求防伪校验失败")


def current_write_session(request: Request, db: Db) -> tuple[Account, UserSession]:
    """改密和注销先认证会话再校验 CSRF；它们不要求首次改密已完成。"""
    actor, stored, token = auth.current_session(db, request.cookies.get(SESSION_COOKIE))
    check_csrf(request, csrf_for(token))
    return actor, stored


def require(action: auth.Capability):
    """为管理路由绑定实时能力检查，非只读请求另需同源 CSRF。"""
    def guard(request: Request, db: Db) -> Account:
        """以当前有效会话解析身份，不从请求参数或曾授予的角色推断权限。"""
        actor, _, token = auth.current_session(db, request.cookies.get(SESSION_COOKIE))
        auth.authorize(actor, action)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            check_csrf(request, csrf_for(token))
        return actor
    return guard


Editor = Annotated[Account, Depends(require("edit"))]
Publisher = Annotated[Account, Depends(require("publish"))]
Manager = Annotated[Account, Depends(require("manage"))]
