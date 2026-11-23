"""Check what can enter a build or start a QA site, without a Docker daemon or MySQL."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
FRONTENDS = ('frontend/admin/dist', 'frontend/h5/dist/build/h5')


def test_docker_context_only_allows_runtime_inputs():
    rules = [line.strip() for line in (ROOT / '.dockerignore').read_text().splitlines()
             if line.strip() and not line.lstrip().startswith('#')]
    assert rules[0] == '**'
    inputs = {'Dockerfile', 'pyproject.toml', 'alembic.ini', 'main.py'}
    exceptions = [line[1:] for line in rules if line.startswith('!')]
    for pattern in exceptions:
        assert pattern in inputs or (pattern.startswith(('app/', 'migrations/')) and pattern.endswith('.py')), pattern
    source = {p for folder in ('app', 'migrations') for p in (ROOT / folder).rglob('*.py')}
    assert {p for pattern in exceptions for p in ROOT.glob(pattern)} == source | {ROOT / name for name in inputs}


@pytest.mark.parametrize('missing', FRONTENDS)
def test_prd_serve_rejects_an_incomplete_build_before_starting_mysql(tmp_path, missing):
    script = tmp_path / 'frontend/tests/prd-lab.py'
    script.parent.mkdir(parents=True)
    shutil.copyfile(ROOT / 'frontend/tests/prd-lab.py', script)
    for folder in FRONTENDS:
        dist = tmp_path / folder
        dist.mkdir(parents=True)
        if folder != missing:
            (dist / 'index.html').touch()
    box = tmp_path / '.local/showcase/prd-selftest.preflight'
    box.mkdir(parents=True)
    for name in ('tls.crt', 'tls.key', 'unused-mysqld'):
        (box.parent / name).touch()
    result = subprocess.run([sys.executable, '-I', '-B', str(script), 'serve', str(box)], cwd=tmp_path,
                            env={**os.environ, 'PRD_MYSQLD': str(box.parent / 'unused-mysqld')},
                            capture_output=True, text=True, timeout=15)
    assert result.returncode != 0
    assert f'{missing}/index.html' in result.stderr and 'npm --prefix frontend run build' in result.stderr
    assert not (box / 'serving').exists()
