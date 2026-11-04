"""Apoio dos testes do caixa: datas relativas a hoje e atalhos para a API."""

from datetime import date, timedelta

API = "/api/v1"


def day(offset: int = 0) -> str:
    """Data relativa a hoje, no formato da API (lida a cada chamada: sem virar o dia no meio)."""
    return (date.today() + timedelta(days=offset)).isoformat()


def new_account(client, name, institution_id):
    response = client.post(f"{API}/accounts", json={"name": name, "institution_id": institution_id})
    assert response.status_code == 201, response.text
    return response.json()


def activate(client, account_id, cents, on=-30):
    response = client.post(
        f"{API}/accounts/{account_id}/opening-balance",
        json={"date": day(on), "amount_cents": cents},
    )
    assert response.status_code == 201, response.text
    return response.json()


def post(client, account_id, path, **body):
    return client.post(f"{API}/accounts/{account_id}/{path}", json=body)


def balance(client, account_id, **params):
    return client.get(f"{API}/accounts/{account_id}/balance", params=params).json()["balance_cents"]


def capital(client, **params):
    return client.get(f"{API}/cash/contributed-capital", params=params).json()


def entries(client, account_id):
    return client.get(f"{API}/accounts/{account_id}/entries").json()["entries"]
