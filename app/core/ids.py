"""Decimal wire IDs must not be rounded by JavaScript clients or overflow MySQL BIGINT."""
import re

from app.core.errors import AppError


def invalid(field: str) -> AppError:
    return AppError(422, "invalid_body", "草稿字段无效", [{"field": field, "reason": "类型、格式或字段不符合此内容契约"}])


def parse_id(value: object, field: str, *, zero: bool = False) -> int:
    """Accept canonical decimal IDs; only revisions may include zero."""
    if not isinstance(value, str) or re.fullmatch(r"0|[1-9][0-9]{0,18}", value) is None:
        raise invalid(field)
    parsed = int(value)
    if parsed > 2**63 - 1 or (not zero and parsed == 0):
        raise invalid(field)
    return parsed
