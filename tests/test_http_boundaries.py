"""Exercise framework, dependency and service boundaries without a running database or TCP server."""
from fastapi.testclient import TestClient


class NoQueries:
    def __getattr__(self, operation):
        raise AssertionError(f'unexpected database operation: {operation}')


def test_anonymous_and_invalid_requests_are_rejected_before_any_query():
    from app.application import create_app
    from app.core.db import session

    api = create_app()
    api.dependency_overrides[session] = lambda: NoQueries()
    with TestClient(api, base_url='https://showcase.test') as client:
        for path in ('/api/admin/me', '/api/admin/products', '/api/admin/accounts', '/api/admin/items/7/preview?revision=1'):
            reply = client.get(path)
            assert reply.status_code == 401 and reply.json()['code'] == 'session_required'
            assert reply.headers['cache-control'] == 'private, no-store'
        challenge = client.get('/api/admin/login')
        assert challenge.status_code == 200 and challenge.json()['csrf_token']
        cookie = challenge.headers['set-cookie'].lower()
        assert 'secure' in cookie and 'httponly' in cookie and 'samesite=strict' in cookie
        forbidden = client.post('/api/admin/login', json={'login': 'test', 'password': 'private-unit-value'})
        assert forbidden.status_code == 403 and 'private-unit-value' not in forbidden.text
        for ident in ('not-an-id', '0', '9223372036854775808'):
            invalid = client.get('/api/public/products/' + ident)
            assert invalid.status_code == 422 and invalid.json()['code'] == 'invalid_input'
        forward = client.get('/api/public/products?revision=9')
        assert forward.status_code == 422 and forward.json()['code'] == 'invalid_query'


def test_plain_http_does_not_issue_a_login_challenge():
    from app.application import create_app

    with TestClient(create_app(), base_url='http://showcase.test') as client:
        response = client.get('/api/admin/login')
        assert response.status_code == 403 and 'set-cookie' not in response.headers
