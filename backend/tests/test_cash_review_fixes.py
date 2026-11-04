"""Correções da revisão do caixa: arquivar conta, cortes em movimentos e saldo futuro."""

import pytest
from cash_helpers import API, activate, balance, day, entries, new_account, post
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.db import Base, make_engine
from app.features.cash import service
from app.features.cash.models import Account
from app.features.cash.schemas import AccountUpdate
from app.features.portfolio.models import Institution


@pytest.fixture
def account(client, institution):
    return client.get(f"{API}/accounts").json()[0]["id"]


def two_accounts(client, institution):
    a = client.get(f"{API}/accounts").json()[0]["id"]
    return a, new_account(client, "Conta B", institution["id"])["id"]


def purchase(client, asset_id, **body):
    return client.post(f"{API}/purchases", json={"asset_id": asset_id, **body})


def provento(client, asset_id, cents, on=0):
    response = client.post(
        f"{API}/proventos", json={"asset_id": asset_id, "amount_cents": cents, "date": day(on)}
    )
    assert response.status_code == 201, response.text
    return response.json()


def close_month(client, asset_id, **body):
    return client.post(f"{API}/assets/{asset_id}/balance", json=body)


def movements(client):
    return client.get(f"{API}/movements").json()


def kinds(client, account_id):
    return [(e["kind"], e["amount_cents"]) for e in reversed(entries(client, account_id))]


def asset_state(client, asset_id):
    body = client.get(f"{API}/assets/{asset_id}").json()
    return body["invested_cents"], body["current_cents"]


# ---- arquivar conta: ativos e o campo `archived` ---------------------------------------------


def test_account_with_active_assets_cannot_be_archived_until_they_are_archived(
    client, institution, make_asset
):
    _, b = two_accounts(client, institution)
    fii = make_asset("FII", account_id=b)

    blocked = client.put(f"{API}/accounts/{b}", json={"name": "Conta B", "archived": True})
    assert blocked.status_code == 409
    assert "ativos" in blocked.json()["detail"]
    assert client.get(f"{API}/accounts/{b}").json()["archived"] is False

    archived_asset = client.put(
        f"{API}/assets/{fii['id']}",
        json={
            "name": "FII",
            "class_key": "renda_fixa",
            "institution_id": institution["id"],
            "account_id": b,
            "archived": True,
        },
    )
    assert archived_asset.status_code == 200, archived_asset.text
    done = client.put(f"{API}/accounts/{b}", json={"name": "Conta B", "archived": True})
    assert (done.status_code, done.json()["archived"]) == (200, True)


def test_active_account_with_assets_keeps_closing_months_and_receiving_proventos(
    client, account, make_asset
):
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    activate(client, account, 600)
    # Renomear sem arquivar não atrapalha o dia a dia da conta.
    assert client.put(f"{API}/accounts/{account}", json={"name": "Principal"}).status_code == 200
    assert provento(client, cdb["id"], 200)["kind"] == "provento"
    assert close_month(client, cdb["id"], balance_cents=100_000).status_code == 200
    assert balance(client, account) == 800


def test_renaming_without_sending_archived_keeps_the_current_value(client, institution):
    _, b = two_accounts(client, institution)
    client.put(f"{API}/accounts/{b}", json={"name": "Conta B", "archived": True})

    renamed = client.put(f"{API}/accounts/{b}", json={"name": "Conta B2"})

    assert renamed.status_code == 200
    assert (renamed.json()["name"], renamed.json()["archived"]) == ("Conta B2", True)
    explicit = client.put(f"{API}/accounts/{b}", json={"name": "Conta B2", "archived": False})
    assert explicit.json()["archived"] is False


def test_account_names_differing_only_by_case_do_not_cause_a_false_conflict():
    """Contas "Banco" e "banco" (possíveis em bancos antigos) escolhem-se pelo id, não pelo nome."""
    engine = make_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as session:
        session.add_all([Institution(name="Banco"), Institution(name="banco")])
        session.flush()
        session.add_all(
            [Account(name="Banco", institution_id=1), Account(name="banco", institution_id=2)]
        )
        session.commit()

        # Mantém o próprio nome: não é conflito, mesmo com a "irmã" que difere só na caixa.
        assert service.update_account(session, 2, AccountUpdate(name="banco")).name == "banco"
        # Já a troca para um nome que colide de verdade segue recusada.
        with pytest.raises(service.ConflictError):
            service.update_account(session, 2, AccountUpdate(name="BANCO"))

        # Renomear a instituição acompanha a conta pelo id e pelo nome antigo exato.
        service.rename_institution_accounts(session, 2, "banco", "Banco Novo")
        assert [a.name for a in service.list_accounts(session)] == ["Banco", "Banco Novo"]
    engine.dispose()


# ---- conciliação ---------------------------------------------------------------------------


def test_reconcile_rejects_a_real_balance_out_of_bounds(client, account):
    activate(client, account, 1_000)

    def reconcile(real):
        return client.get(f"{API}/accounts/{account}/reconcile", params={"real_cents": real})

    assert reconcile(-1).status_code == 422
    assert reconcile(10**13 + 1).status_code == 422
    assert reconcile(0).status_code == 200
    assert reconcile(10**13).status_code == 200


# ---- saldo futuro e cortes em transferências -----------------------------------------------


def transfer(client, a, b, cents, on=0):
    return client.post(
        f"{API}/cash/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount_cents": cents, "date": day(on)},
    )


def test_outgoing_transfer_is_blocked_by_a_future_negative_balance(client, institution):
    a, b = two_accounts(client, institution)
    activate(client, a, 1_000)
    activate(client, b, 0)
    post(client, a, "withdrawals", date=day(10), amount_cents=1_000)  # esvazia a conta no futuro

    response = transfer(client, a, b, 300)

    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 300
    assert (balance(client, a), balance(client, b)) == (1_000, 0)
    assert len(entries(client, a)) == 2 and len(entries(client, b)) == 1


def test_transfer_to_an_account_whose_opening_is_after_the_date_saves_nothing(client, institution):
    a, b = two_accounts(client, institution)
    activate(client, a, 1_000)
    activate(client, b, 0, on=5)  # o caixa de b só começa daqui a 5 dias

    response = transfer(client, a, b, 300)

    assert response.status_code == 422
    assert "só tem caixa a partir de" in response.json()["detail"]
    assert balance(client, a) == 1_000
    assert len(entries(client, a)) == 1 and len(entries(client, b)) == 1


# ---- datas e cortes em movimentos já lançados ----------------------------------------------


def test_legacy_contribution_cannot_be_moved_to_after_the_opening(client, account, make_asset):
    cdb = make_asset("CDB", invested=100_000, current=100_000, valuation_date=day(-20))
    activate(client, account, 7_000, on=0)
    close_month(
        client,
        cdb["id"],
        date=day(1),
        balance_cents=150_000,
        contribution_cents=50_000,
        contribution_date=day(-5),
    )
    movement = movements(client)[0]

    refused = client.patch(f"{API}/movements/{movement['id']}", json={"date": day(1)})

    assert refused.status_code == 422
    assert "antes do caixa" in refused.json()["detail"]
    assert movements(client)[0]["date"] == day(-5)
    assert kinds(client, account) == [("saldo_inicial", 7_000)]
    # Dentro do período anterior ao corte, a correção segue livre.
    moved = client.patch(f"{API}/movements/{movement['id']}", json={"date": day(-3)})
    assert moved.status_code == 200


def test_legacy_provento_cannot_be_moved_to_after_the_opening(client, account, make_asset):
    fii = make_asset("FII")
    activate(client, account, 600, on=0)
    movement = provento(client, fii["id"], 200, on=-3)  # anterior ao corte: fora do ledger

    refused = client.patch(f"{API}/movements/{movement['id']}", json={"date": day(0)})

    assert refused.status_code == 422
    assert "antes do caixa" in refused.json()["detail"]
    assert balance(client, account) == 600


def test_provento_cannot_be_moved_to_before_the_opening(client, account, make_asset):
    fii = make_asset("FII")
    activate(client, account, 600, on=-10)
    movement = provento(client, fii["id"], 200, on=0)

    refused = client.patch(f"{API}/movements/{movement['id']}", json={"date": day(-11)})

    assert refused.status_code == 422
    assert "só tem caixa a partir de" in refused.json()["detail"]
    assert movements(client)[0]["date"] == day(0)
    assert balance(client, account) == 800
    ok = client.patch(f"{API}/movements/{movement['id']}", json={"date": day(-10)})
    assert ok.status_code == 200
    assert balance(client, account, as_of=day(-10)) == 800


def test_purchase_today_is_blocked_by_a_future_withdrawal(client, account, make_asset):
    fii = make_asset("FII", invested=50_000, current=50_000)
    activate(client, account, 1_000)
    post(client, account, "withdrawals", date=day(10), amount_cents=1_000)

    response = purchase(client, fii["id"], date=day(), amount_cents=500)

    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 500
    assert asset_state(client, fii["id"]) == (50_000, 50_000)
    assert movements(client) == []


def test_use_cash_contribution_edit_and_undo_follow_the_cash_after_it(client, account, make_asset):
    cdb = make_asset("CDB", invested=100_000, current=100_000)
    activate(client, account, 80_000)
    close_month(
        client,
        cdb["id"],
        date=day(1),
        balance_cents=150_000,
        contribution_cents=50_000,
        use_cash=True,
    )
    post(client, account, "withdrawals", date=day(2), amount_cents=30_000)  # caixa a zero
    movement = movements(client)[0]

    # Aumentar o aporte gastaria dinheiro que já saiu: recusa, com o quanto falta.
    more = client.patch(f"{API}/movements/{movement['id']}", json={"amount_cents": 60_000})
    assert more.status_code == 409
    assert more.json()["shortfall_cents"] == 10_000
    assert kinds(client, account)[1] == ("compra", -50_000)
    assert asset_state(client, cdb["id"]) == (150_000, 150_000)

    # Desfazer só devolve dinheiro ao caixa (remove uma saída), então o gasto depois não o barra.
    assert client.post(f"{API}/movements/{movement['id']}/undo").status_code == 200
    assert balance(client, account, as_of=day(2)) == 50_000
