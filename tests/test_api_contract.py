"""The H5 and admin clients depend on these method/path pairs independently of Python module names."""
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


PUBLIC = {
    'pages/{page}': 'GET', 'catalog': 'GET', 'products': 'GET', 'products/{id}': 'GET',
    'cases': 'GET', 'cases/{id}': 'GET', 'media/{id}': 'GET', 'media/{id}/thumbnail': 'GET',
    'media/{id}/catalog-thumbnail': 'GET', 'media/{id}/display-thumbnail': 'GET',
}
ADMIN = {
    'login': 'GET POST', 'logout': 'POST', 'me': 'GET', 'change-password': 'POST',
    'accounts': 'GET POST', 'accounts/{account_id}': 'PATCH', 'audit': 'GET',
    'cases': 'GET POST', 'products': 'GET POST', 'config/{slot}': 'GET', 'directory/nodes': 'POST',
    'media': 'POST', 'media/{id}': 'GET', 'products/batch-append': 'POST', 'products/batch-check': 'POST',
    'items/{id}': 'GET', 'items/{id}/draft': 'PUT DELETE', 'items/{id}/check': 'POST',
    'items/{id}/publish': 'POST', 'items/{id}/preview': 'GET', 'items/{id}/versions': 'GET',
    'items/{id}/versions/{seq}/restore': 'POST', 'items/{id}/impact': 'GET',
    'items/{id}/unlist': 'POST', 'items/{id}/archive': 'POST',
}


def test_routes_keep_their_methods_paths_and_publication_contract():
    from main import app

    spec = app.openapi()
    expected = {('GET', '/health/ready')}
    for prefix, paths in [('/api/public/', PUBLIC), ('/api/admin/', ADMIN)]:
        expected.update((method, prefix + path) for path, methods in paths.items() for method in methods.split())
    assert {(m.upper(), p) for p, ops in spec['paths'].items() for m in ops} == expected
    publish = spec['paths']['/api/admin/items/{id}/publish']['post']
    schema = publish['requestBody']['content']['application/json']['schema']['$ref'].split('/')[-1]
    dto = spec['components']['schemas'][schema]
    assert set(dto['required']) == {'expected_revision', 'request_key'}
    assert dto['properties']['expected_revision']['type'] == 'string'
    assert dto['additionalProperties'] is False


def test_models_register_the_whole_existing_schema_and_revision_chain():
    from app.models import Base

    config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    assert [r.revision for r in ScriptDirectory.from_config(config).walk_revisions()] == ['0002_config_items', '0001_initial']
    assert set(Base.metadata.tables) == {
        'account', 'session', 'audit', 'content_item', 'draft', 'release', 'directory_node',
        'draft_place', 'release_place', 'asset', 'release_asset',
    }
    assert all(t.dialect_options['mysql']['engine'] == 'InnoDB' for t in Base.metadata.tables.values())
    assert any(fk.name == 'fk_content_own_live' for fk in Base.metadata.tables['content_item'].foreign_key_constraints)
