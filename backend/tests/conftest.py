import dataclasses

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.db import Base, get_session, make_engine
from app.core.protection import APP_HEADER, APP_HEADER_VALUE
from app.main import create_app
from app.registry import Base as _RegisteredBase  # noqa: F401  (registra os modelos)
from app.seed import seed


@pytest.fixture(autouse=True)
def isolated_database_file(tmp_path, monkeypatch):
    """Nenhum teste enxerga o banco real do usuário.

    As funções que copiam ou inspecionam o arquivo do banco (backup, restauração, status do
    sistema) leem o endereço das configurações; aqui ele aponta para uma pasta temporária.
    """
    url = f"sqlite:///{(tmp_path / 'data' / 'investment.db').as_posix()}"
    settings = dataclasses.replace(get_settings(), database_url=url)
    monkeypatch.setattr("app.features.backup.service.get_settings", lambda: settings)
    monkeypatch.setattr("app.features.system.router.get_settings", lambda: settings)
    return tmp_path / "data" / "investment.db"


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Nenhum teste fala com o Banco Central nem com a B3: quem precisar injeta um fetcher."""

    def refuse(*args, **kwargs):
        raise OSError("rede bloqueada nos testes")

    monkeypatch.setattr("urllib.request.urlopen", refuse)


@pytest.fixture
def client():
    engine = make_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine, expire_on_commit=False)
    with testing_session() as session:
        seed(session)

    def override_get_session():
        with testing_session() as session:
            yield session

    app = create_app(static_dir=None)
    app.dependency_overrides[get_session] = override_get_session
    # Sem `with`: o lifespan (migração + seed no banco real) não roda nos testes.
    # Como a tela de verdade: no endereço do próprio computador e com o cabeçalho do app.
    yield TestClient(app, base_url="http://localhost", headers={APP_HEADER: APP_HEADER_VALUE})
    engine.dispose()


@pytest.fixture
def institution(client):
    return client.post("/api/v1/institutions", json={"name": "Banco Teste"}).json()


@pytest.fixture
def make_asset(client, institution):
    def _make(name="Ativo", class_key="renda_fixa", invested=100_000, current=110_000, **extra):
        payload = {
            "name": name,
            "class_key": class_key,
            "institution_id": institution["id"],
            "invested_cents": invested,
            "current_cents": current,
            **extra,
        }
        response = client.post("/api/v1/assets", json=payload)
        assert response.status_code == 201, response.text
        return response.json()

    return _make
