"""Keep transport and storage dependencies one-way across the backend layers."""
import ast
from pathlib import Path


APP = Path(__file__).resolve().parents[1] / 'app'


def test_business_and_data_layers_do_not_import_http():
    for layer in ('services', 'repositories', 'models', 'core'):
        files = [p for p in (APP / layer).rglob('*.py') if p.name != '__init__.py']
        assert files, f'Empty backend layer: {layer}'
        forbidden = ['fastapi', 'starlette', 'app.controllers']
        if layer in ('repositories', 'models'):
            forbidden.append('app.services')
        for file in files:
            for node in ast.walk(ast.parse(file.read_bytes())):
                names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ''] if isinstance(node, ast.ImportFrom) else []
                for name in names:
                    assert not any(name == f or name.startswith(f + '.') for f in forbidden), (file, name)
                if layer == 'repositories' and isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                    assert node.func.attr not in {'commit', 'rollback'}, f'{file}: the caller owns the transaction'


def test_http_handlers_do_not_execute_queries_or_manage_transactions():
    for file in (APP / 'controllers').rglob('*.py'):
        for node in ast.walk(ast.parse(file.read_bytes())):
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or '').startswith('app.repositories'), f'{file}: use a service, not a repository'
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                assert node.func.attr not in {'commit', 'rollback', 'execute', 'scalars', 'scalar', 'with_for_update'}, file
