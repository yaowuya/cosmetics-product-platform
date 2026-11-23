"""Versioned paths are relative to the project, never to PyCharm's working directory."""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
