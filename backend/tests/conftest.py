"""Test fixtures for an explicitly isolated real MySQL database."""
import os
import re

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


@pytest.fixture(scope="session")
def mysql_engine():
    """Reject shared, remote or non-MySQL databases before any schema writes."""
    value = os.environ.get("FP_TEST_DATABASE_URL")
    if not value:
        pytest.fail("FP_TEST_DATABASE_URL must identify a disposable loopback MySQL 8.0+ test database")
    url = make_url(value)
    if (
        url.drivername != "mysql+pymysql"
        or url.host not in {"127.0.0.1", "::1", "localhost"}
        or url.port in {None, 3306}
        or not re.fullmatch(r"fp_[a-z0-9_]+_test", url.database or "")
        or url.username != "fp_test"
    ):
        pytest.fail("Refusing to run schema tests against a non-isolated database")
    engine = create_engine(url, pool_pre_ping=True, hide_parameters=True)
    try:
        with engine.connect() as connection:
            version = connection.scalar(text("SELECT VERSION()"))
        match = re.match(r"(\d+)\.(\d+)\.", version or "")
        if "mariadb" in (version or "").lower() or not match or tuple(map(int, match.groups())) < (8, 0):
            pytest.fail("MySQL Server 8.0+ with InnoDB is required")
        yield engine
    finally:
        engine.dispose()
