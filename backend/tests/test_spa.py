import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.db import Base, get_session, make_engine
from app.main import create_app
from app.registry import Base as _RegisteredBase  # noqa: F401  (registra os modelos)
from app.seed import seed


@pytest.fixture
def static_dir(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html><body>TELA</body></html>", encoding="utf-8")
    (tmp_path / "assets" / "app.js").write_text("console.log('ok')", encoding="utf-8")
    return tmp_path


def build_client(static_dir):
    engine = make_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine, expire_on_commit=False)
    with testing_session() as session:
        seed(session)

    def override_get_session():
        with testing_session() as session:
            yield session

    app = create_app(static_dir=static_dir)
    app.dependency_overrides[get_session] = override_get_session
    return TestClient(app, base_url="http://localhost")


def test_serves_the_built_frontend_at_the_root(static_dir):
    client = build_client(static_dir)
    home = client.get("/")
    assert home.status_code == 200
    assert "TELA" in home.text

    script = client.get("/assets/app.js")
    assert script.status_code == 200
    assert "console.log" in script.text


def test_client_side_routes_fall_back_to_the_app(static_dir):
    """Recarregar /portfolio no navegador não existe como arquivo: deve devolver a tela."""
    client = build_client(static_dir)
    for path in ("/portfolio", "/history", "/allocation"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert "TELA" in response.text


def test_api_and_health_take_precedence_over_the_frontend(static_dir):
    client = build_client(static_dir)
    assert client.get("/health").json() == {"status": "ok"}
    classes = client.get("/api/v1/asset-classes")
    assert classes.status_code == 200
    assert classes.headers["content-type"].startswith("application/json")
    assert client.get("/openapi.json").json()["info"]["title"] == "Investment Lab"
    assert "swagger" in client.get("/docs").text.lower()


def test_unknown_api_paths_are_404_not_the_app(static_dir):
    client = build_client(static_dir)
    for path in ("/api/v1/nao-existe", "/api/v2/qualquer"):
        response = client.get(path)
        assert response.status_code == 404, path
        assert "TELA" not in response.text


def test_missing_files_are_404_instead_of_being_masked_by_the_app(static_dir):
    """Pedir /assets/x.js que não existe deve dar 404, não devolver a tela com 200."""
    client = build_client(static_dir)
    assert client.get("/assets/nao-existe.js").status_code == 404
    assert client.get("/favicon.ico").status_code == 404


def test_no_frontend_when_disabled_or_not_built(tmp_path, static_dir):
    assert build_client(None).get("/").status_code == 404
    empty = tmp_path / "vazia"
    empty.mkdir()
    assert build_client(empty).get("/").status_code == 404  # sem index.html: não monta
