import pytest
from fastapi.testclient import TestClient

from app.core.protection import APP_HEADER, APP_HEADER_VALUE
from app.main import create_app

APP = {APP_HEADER: APP_HEADER_VALUE}


@pytest.fixture
def raw_client(client):
    """Mesma API e mesmo banco do `client`, mas sem o cabeçalho do app."""
    return TestClient(client.app, base_url="http://localhost")


def test_write_without_the_app_header_is_refused(raw_client):
    response = raw_client.post("/api/v1/institutions", json={"name": "Banco X"})
    assert response.status_code == 403
    assert "Investment Lab" in response.json()["detail"]
    # Além de responder 403, nada pode ter sido gravado.
    names = [i["name"] for i in raw_client.get("/api/v1/institutions").json()]
    assert "Banco X" not in names


def test_write_with_the_app_header_goes_through(raw_client):
    response = raw_client.post("/api/v1/institutions", json={"name": "Banco X"}, headers=APP)
    assert response.status_code == 201


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_every_kind_of_write_needs_the_header(raw_client, method):
    response = getattr(raw_client, method)("/api/v1/institutions/1")
    assert response.status_code == 403


def test_reads_do_not_need_the_header(raw_client):
    assert raw_client.get("/api/v1/asset-classes").status_code == 200
    assert raw_client.get("/health").status_code == 200


def test_a_foreign_host_is_refused_even_for_reads(client):
    # DNS rebinding: o site de fora aponta o próprio nome para 127.0.0.1.
    evil = TestClient(client.app, base_url="http://evil.example.com", headers=APP)
    assert evil.get("/api/v1/asset-classes").status_code == 400
    assert evil.get("/health").status_code == 400


@pytest.mark.parametrize(
    "host", ["localhost.evil.com", "127.0.0.1.nip.io", "[::1]", "[::1]:8000", "evil.com:80"]
)
def test_lookalike_and_ipv6_hosts_are_refused(client, host):
    evil = TestClient(client.app, base_url=f"http://{host}", headers=APP)
    response = evil.get("/api/v1/asset-classes")
    assert response.status_code == 400
    assert "localhost" in response.json()["detail"]  # a mensagem orienta o que fazer


def test_a_missing_host_header_is_refused(client):
    response = client.get("/health", headers={"host": ""})
    assert response.status_code == 400


@pytest.mark.parametrize("host", ["localhost", "localhost:8000", "127.0.0.1", "127.0.0.1:5173"])
def test_the_computer_itself_is_accepted(client, host):
    local = TestClient(client.app, base_url=f"http://{host}")
    assert local.get("/api/v1/asset-classes").status_code == 200


def test_cross_origin_preflight_is_not_blocked_by_the_header_rule(raw_client):
    response = raw_client.options(
        "/api/v1/institutions",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-investment-lab",
        },
    )
    assert response.status_code == 200


def test_allowed_hosts_come_from_the_environment(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setenv("INVESTMENT_ALLOWED_HOSTS", "localhost, meu-pc")
    get_settings.cache_clear()
    try:
        assert get_settings().allowed_hosts == ("localhost", "meu-pc")
        assert create_app(static_dir=None) is not None
    finally:
        get_settings.cache_clear()
