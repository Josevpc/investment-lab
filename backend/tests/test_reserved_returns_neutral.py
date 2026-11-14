"""O dinheiro separado para comprar não mexe na rentabilidade nem na comparação com o CDI.

Cada cenário roda duas vezes, com e sem separado, e as duas rodadas precisam bater com o MESMO
valor escrito aqui à mão: assim a igualdade entre A (com separado) e B (sem separado) é provada
sem que o teste repita a conta do código.

O CDI é montado para a conta caber de cabeça: todo dia útil rende 0%, menos um dia de 1%
(`BONUS_DAY`). O ativo (renda fixa) vale R$ 1.000,00, rende 1% nesse dia (R$ 1.010,00) e só recebe
depois a compra de R$ 100,00, sem render mais. Logo, em todos os cenários: carteira 1,00% (100
bps), CDI 1,00% (100 bps) e o ativo rende 100% do CDI (10.000 bps).
"""

from datetime import date, timedelta

import pytest
from cash_helpers import API, activate, day

from app.features.benchmarks import client as bcb

START = 100_000  # o ativo no primeiro saldo
AFTER_BONUS = 101_000  # depois do dia de 1% do CDI
PURCHASE = 10_000
SEPARATION = 4_000  # em cada um de três meses
RELEASE = 1_500
BONUS_RATE_E9 = 10_000_000  # 1% ao dia, em bilionésimos
CDI_START = date.today() - timedelta(days=99)


@pytest.fixture
def account(client, institution):
    return client.get(f"{API}/accounts").json()[0]["id"]


@pytest.fixture
def classes(client):
    return {c["key"]: c["id"] for c in client.get(f"{API}/asset-classes").json()}


def bonus_day() -> date:
    """O dia útil de 1% do CDI: o primeiro a partir de 50 dias atrás (antes do saldo de -45)."""
    candidate = date.today() - timedelta(days=50)
    while candidate.weekday() >= 5:
        candidate += timedelta(days=1)
    return candidate


def load_cdi(client, monkeypatch):
    bonus = bonus_day()
    rows = [
        (
            CDI_START + timedelta(days=i),
            BONUS_RATE_E9 if CDI_START + timedelta(days=i) == bonus else 0,
        )
        for i in range(100)
        if (CDI_START + timedelta(days=i)).weekday() < 5
    ]
    monkeypatch.setattr(bcb, "fetch_series", lambda series, start, end: [])
    monkeypatch.setattr(bcb, "fetch_daily_cdi", lambda start, end: rows)
    monkeypatch.setattr(bcb, "fetch_ibovespa", lambda start, end: [])
    assert client.post(f"{API}/benchmarks/refresh").status_code == 200


def typed(client, asset_id, offset, cents):
    response = client.post(
        f"{API}/assets/{asset_id}/balance", json={"date": day(offset), "balance_cents": cents}
    )
    assert response.status_code == 200, response.text


def build(client, make_asset, monkeypatch, account, classes, *, cash, separate, purchase, release):
    """Monta a história e devolve o ativo. Com tudo falso, é só a carteira sem caixa."""
    load_cdi(client, monkeypatch)
    asset = make_asset(
        "CDB", class_key="renda_fixa", invested=START, current=START, valuation_date=day(-100)
    )
    if cash:
        activate(client, account, 1_000_000, on=-120)
    reservations = []
    if separate:
        for offset in (-90, -60, -30):
            response = client.post(
                f"{API}/accounts/{account}/reservations",
                json={
                    "class_id": classes["renda_fixa"],
                    "amount_cents": SEPARATION,
                    "date": day(offset),
                },
            )
            assert response.status_code == 201, response.text
            reservations.append(response.json())
    typed(client, asset["id"], -45, AFTER_BONUS)
    if release:
        response = client.post(
            f"{API}/cash/reservations/{reservations[0]['id']}/release",
            json={"amount_cents": RELEASE, "date": day(-20)},
        )
        assert response.status_code == 200, response.text
    if purchase:
        response = client.post(
            f"{API}/purchases",
            json={"asset_id": asset["id"], "amount_cents": PURCHASE, "date": day(-10)},
        )
        assert response.status_code == 201, response.text
    typed(client, asset["id"], -5, AFTER_BONUS + (PURCHASE if purchase else 0))
    return asset


def portfolio_return(client):
    body = client.get(f"{API}/analytics/performance").json()
    return body["summary"]


def asset_vs_cdi(client, asset_id):
    response = client.get(f"{API}/analytics/assets/{asset_id}/vs-cdi")
    assert response.status_code == 200, response.text
    return response.json()


def summary(client):
    return client.get(f"{API}/portfolio/summary").json()


def earnings_gain(client):
    """Quanto o dinheiro rendeu no total e, mês a mês, o que ficou como valorização."""
    body = client.get(f"{API}/earnings").json()
    return body["total"]["earned_cents"], sum(m["appreciation_cents"] for m in body["months"])


SEPARATED = pytest.mark.parametrize("separate", [False, True], ids=["sem_separado", "com_separado"])


# ---- 1. separar em três meses e comprar com o separado = comprar direto -----------------------


@SEPARATED
def test_buying_with_the_reserved_gives_the_same_returns_as_buying_straight(
    client, make_asset, monkeypatch, account, classes, separate
):
    asset = build(
        client,
        make_asset,
        monkeypatch,
        account,
        classes,
        cash=True,
        separate=separate,
        purchase=True,
        release=False,
    )

    # Carteira: 1,00% no dia de CDI de 1%; a compra de R$ 100,00 não rende nada depois.
    performance = portfolio_return(client)
    assert performance["portfolio_bps"] == 100
    assert performance["cdi_bps"] == 100
    assert performance["vs_cdi_bps"] == 0  # 100 - 100
    assert performance["flows_cents"] == PURCHASE  # a compra é dinheiro entrando no ativo

    # Rentabilidade do resumo: R$ 1.010,00 + R$ 100,00 = R$ 1.110,00 sobre R$ 1.100,00 investidos
    # rende R$ 10,00, ou 0,909%, que arredonda para 91 bps.
    body = summary(client)
    assert (body["total_invested_cents"], body["total_current_cents"]) == (110_000, 111_000)
    assert body["return_bps"] == 91

    # Ativo: R$ 1.000,00 rende 1% (R$ 10,00), a compra entra depois do dia de CDI: 100% do CDI.
    vs_cdi = asset_vs_cdi(client, asset["id"])
    assert vs_cdi["yield_cents"] == 1_000
    assert vs_cdi["flows_cents"] == PURCHASE
    assert vs_cdi["return_bps"] == 100
    assert vs_cdi["cdi_bps"] == 100
    assert vs_cdi["pct_of_cdi_bps"] == 10_000

    # Salário do seu dinheiro: só os R$ 10,00 de valorização contam, nunca a compra nem o separado.
    assert earnings_gain(client) == (1_000, 1_000)


# ---- 2. só separado em aberto, sem compra -----------------------------------------------------


@SEPARATED
def test_open_reserved_alone_does_not_change_returns_or_the_cdi_comparison(
    client, make_asset, monkeypatch, account, classes, separate
):
    asset = build(
        client,
        make_asset,
        monkeypatch,
        account,
        classes,
        cash=True,
        separate=separate,
        purchase=False,
        release=False,
    )

    performance = portfolio_return(client)
    assert (performance["portfolio_bps"], performance["cdi_bps"]) == (100, 100)
    assert performance["vs_cdi_bps"] == 0
    assert performance["flows_cents"] == 0  # separar não é aporte no ativo

    # R$ 1.010,00 sobre R$ 1.000,00 investidos: R$ 10,00, ou 1,00%.
    body = summary(client)
    assert (body["total_invested_cents"], body["total_current_cents"]) == (100_000, 101_000)
    assert body["return_bps"] == 100

    vs_cdi = asset_vs_cdi(client, asset["id"])
    assert (vs_cdi["return_bps"], vs_cdi["cdi_bps"], vs_cdi["pct_of_cdi_bps"]) == (100, 100, 10_000)
    assert earnings_gain(client) == (1_000, 1_000)


# ---- 3. liberação parcial ---------------------------------------------------------------------


@SEPARATED
def test_partial_release_does_not_change_returns_or_the_cdi_comparison(
    client, make_asset, monkeypatch, account, classes, separate
):
    asset = build(
        client,
        make_asset,
        monkeypatch,
        account,
        classes,
        cash=True,
        separate=separate,
        purchase=False,
        release=separate,  # sem separado não há o que liberar
    )

    # Liberar R$ 15,00 de volta ao caixa livre não é perda nem ganho da carteira.
    performance = portfolio_return(client)
    assert (performance["portfolio_bps"], performance["cdi_bps"]) == (100, 100)
    assert performance["vs_cdi_bps"] == 0
    assert summary(client)["return_bps"] == 100

    vs_cdi = asset_vs_cdi(client, asset["id"])
    assert (vs_cdi["return_bps"], vs_cdi["cdi_bps"], vs_cdi["pct_of_cdi_bps"]) == (100, 100, 10_000)
    assert earnings_gain(client) == (1_000, 1_000)


# ---- 4. caixa livre continua fora ------------------------------------------------------------


@pytest.mark.parametrize("cash", [False, True], ids=["sem_caixa", "com_caixa_livre"])
def test_free_cash_stays_out_of_the_return_and_the_cdi_comparison(
    client, make_asset, monkeypatch, account, classes, cash
):
    asset = build(
        client,
        make_asset,
        monkeypatch,
        account,
        classes,
        cash=cash,
        separate=False,
        purchase=False,
        release=False,
    )

    # R$ 10.000,00 parados no caixa não diluem a rentabilidade: continua R$ 10,00 sobre R$ 1.000,00.
    body = summary(client)
    assert body["return_bps"] == 100
    assert (body["total_invested_cents"], body["total_current_cents"]) == (100_000, 101_000)
    assert body["cash_cents"] == (1_000_000 if cash else 0)
    assert body["total_with_cash_cents"] == 101_000 + (1_000_000 if cash else 0)

    performance = portfolio_return(client)
    assert (performance["portfolio_bps"], performance["cdi_bps"]) == (100, 100)
    assert performance["vs_cdi_bps"] == 0
    points = client.get(f"{API}/analytics/performance").json()["points"]
    assert [p["value_cents"] for p in points] == [START, AFTER_BONUS, AFTER_BONUS]  # sem o caixa

    assert asset_vs_cdi(client, asset["id"])["pct_of_cdi_bps"] == 10_000
    assert earnings_gain(client) == (1_000, 1_000)


# ---- 5. patrimônio com o separado, rentabilidade só sobre o investido -------------------------


def test_net_worth_after_a_purchase_keeps_the_return_on_the_invested(
    client, make_asset, monkeypatch, account, classes
):
    build(
        client,
        make_asset,
        monkeypatch,
        account,
        classes,
        cash=True,
        separate=True,
        purchase=True,
        release=False,
    )

    body = summary(client)

    # Separado: 3 x R$ 40,00 = R$ 120,00; a compra de R$ 100,00 gasta o separado primeiro e sobram
    # R$ 20,00. Patrimônio: R$ 1.110,00 investidos + R$ 20,00 = R$ 1.130,00.
    assert body["reserved_cents"] == 3 * SEPARATION - PURCHASE == 2_000
    assert (body["total_invested_cents"], body["total_current_cents"]) == (110_000, 111_000)
    assert body["net_worth_cents"] == 113_000
    # R$ 10,00 sobre R$ 1.100,00 = 0,909% -> 91 bps. Com o separado no denominador (1.000 sobre
    # 112.000) seria 89 bps.
    assert body["return_bps"] == 91


def test_net_worth_with_leftover_reserved_does_not_dilute_the_return(
    client, make_asset, monkeypatch, account, classes
):
    build(
        client,
        make_asset,
        monkeypatch,
        account,
        classes,
        cash=True,
        separate=True,
        purchase=False,
        release=True,
    )

    body = summary(client)

    # Separado em aberto: 3 x R$ 40,00 - R$ 15,00 liberados = R$ 105,00 (10.500 centavos).
    assert body["reserved_cents"] == 3 * SEPARATION - RELEASE == 10_500
    # Patrimônio: R$ 1.010,00 investidos + R$ 105,00 separados = R$ 1.115,00.
    assert body["net_worth_cents"] == 111_500
    # A rentabilidade segue R$ 10,00 sobre R$ 1.000,00 (1,00%); somar o separado ao denominador
    # daria 0,90% (90 bps), e ao numerador, 11,5%.
    assert (body["total_invested_cents"], body["total_current_cents"]) == (100_000, 101_000)
    assert body["return_bps"] == 100
    last = client.get(f"{API}/history/evolution").json()["points"][-1]
    assert last["net_worth_cents"] == last["total_cents"] + last["reserved_cents"]
    assert last["total_cents"] == 101_000
