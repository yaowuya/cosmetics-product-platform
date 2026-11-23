"""Business failures keep the stable API error contract without importing an HTTP framework."""


class AppError(Exception):
    """A user-facing rejection; only the declared detail may be sent to a client."""

    def __init__(self, status_code: int, code: str, message: str, issues: list[dict] | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = {"code": code, "message": message, "issues": issues if issues is not None else []}
