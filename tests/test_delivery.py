"""Verify deploy preflight keeps the database private and does not hide absent Docker."""
from pathlib import Path
import shutil
import subprocess

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def test_bundle(mysql_engine, monkeypatch):
    """Explicit migration readiness and deploy configuration must have independent evidence."""
    monkeypatch.setenv("DATABASE_URL", mysql_engine.url.render_as_string(hide_password=False))
    from main import app

    with TestClient(app) as client:
        response = client.get("/health/ready")
        assert response.status_code == 200 and response.json() == {"status": "ready"}
    for name in ("Caddyfile", "backup.sh", "restore.sh", "runbook.md"):
        assert (ROOT / "deploy" / name).is_file()
    assert (ROOT / "compose.yaml").is_file()
    for name in ("backup.sh", "restore.sh"):
        subprocess.run(["bash", "-n", str(ROOT / "deploy" / name)], check=True)
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    backup = (ROOT / "deploy" / "backup.sh").read_text(encoding="utf-8")
    assert "--databases cosmetics-product-platform" in backup
    assert "container_name: cosmetics-product-platform" in compose
    assert "3306" not in compose
    api = compose.split("  api:\n", 1)[1].split("  proxy:\n", 1)[0]
    assert "ports:" not in api and "pull_policy: never" in api


def test_docker_runtime_prerequisite():
    """Do not report the real deployment as green without an approved Docker environment."""
    assert shutil.which("docker"), "BLOCKED: an approved Ubuntu Docker Compose target is required"
