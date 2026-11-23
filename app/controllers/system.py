"""Readiness is public, but deployment and database details are not."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.services.health import is_ready

router = APIRouter()


@router.get('/health/ready')
def readiness() -> JSONResponse:
    """Report schema compatibility without modifying the database or showing connection details."""
    ready = is_ready()
    return JSONResponse({'status': 'ready' if ready else 'not_ready'}, status_code=200 if ready else 503,
                        headers={'Cache-Control': 'no-store'})
