"""PyCharm: run this file. Production ASGI servers import main:app without opening a listener."""
from app.application import create_app

app = create_app()


if __name__ == '__main__':
    from app.core.config import PROJECT_ROOT
    from app.local import run_local

    try:
        run_local(app, PROJECT_ROOT)
    except RuntimeError as error:
        raise SystemExit(str(error)) from None
