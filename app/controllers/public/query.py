"""Whitelist query parameters at the anonymous HTTP boundary."""
from fastapi import Request

from app.core.errors import AppError


def only_query(request: Request, *allowed: str) -> None:
    """Reject preview parameters or any other unsupported attempt to switch input sources."""
    if set(request.query_params.keys()) - set(allowed):
        raise AppError(422, "invalid_query", "公开入口不接受此查询参数")
