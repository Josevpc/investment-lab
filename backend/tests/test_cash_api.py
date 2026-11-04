from cash_helpers import (
    API,
    activate,
    balance,
    capital,
    day,
    entries,
    new_account,
    post,
)

# ---- contas e saldo inicial ----------------------------------------------------------------


def test_creating_an_institution_creates_an_account_with_the_same_name(client, institution):
    accounts = client.get(f"{API}/accounts").json()
    assert [(a["name"], a["institution_id"]) for a in accounts] == [
        ("Banco Teste", institution["id"])
    ]
    assert accounts[0]["cash_enabled"] is False
    assert accounts[0]["balance_cents"] == 0


def test_new_asset_goes_to_the_institution_account_by_default(client, institution, make_asset):
    account = client.get(f"{API}/accounts").json()[0]
    assert make_asset()["account_id"] == account["id"]


def test_asset_can_be_created_in_another_account_of_the_same_institution(
    client, institution, make_asset
):
    second = new_account(client, "Conta Extra", institution["id"])
    assert make_asset(account_id=second["id"])["account_id"] == second["id"]


def test_asset_cannot_use_an_account_of_another_institution(client, institution, make_asset):
    other = client.post(f"{API}/institutions", json={"name": "Outro Banco"}).json()
    foreign = new_account(client, "Conta do Outro", other["id"])
    response = client.post(
        f"{API}/assets",
        json={
            "name": "X",
            "class_key": "renda_fixa",
            "institution_id": institution["id"],
            "current_cents": 100,
            "account_id": foreign["id"],
        },
    )
    assert response.status_code == 422
    assert "outra instituição" in response.json()["detail"]


def test_account_names_are_unique_and_institution_must_exist(client, institution):
    assert (
        client.post(
            f"{API}/accounts", json={"name": "banco teste", "institution_id": institution["id"]}
        ).status_code
        == 409
    )
    assert (
        client.post(f"{API}/accounts", json={"name": "Nova", "institution_id": 999}).status_code
        == 422
    )


def test_opening_balance_activates_the_cash_once(client, institution):
    account = client.get(f"{API}/accounts").json()[0]
    entry = activate(client, account["id"], 600)
    assert (entry["kind"], entry["amount_cents"], entry["balance_cents"]) == (
        "saldo_inicial",
        600,
        600,
    )
    shown = client.get(f"{API}/accounts/{account['id']}").json()
    assert shown["cash_enabled"] is True
    assert shown["opening_date"] == day(-30)
    assert shown["balance_cents"] == 600

    again = client.post(
        f"{API}/accounts/{account['id']}/opening-balance",
        json={"date": day(-10), "amount_cents": 1},
    )
    assert again.status_code == 409
    assert balance(client, account["id"]) == 600


def test_entries_need_the_cash_to_be_activated(client, institution):
    account = client.get(f"{API}/accounts").json()[0]
    response = post(client, account["id"], "deposits", date=day(), amount_cents=100)
    assert response.status_code == 422
    assert "saldo inicial" in response.json()["detail"]


def test_entry_dated_before_the_opening_balance_is_refused(client, institution):
    account = client.get(f"{API}/accounts").json()[0]
    activate(client, account["id"], 600, on=-10)
    response = post(client, account["id"], "deposits", date=day(-11), amount_cents=100)
    assert response.status_code == 422
    assert "só tem caixa a partir de" in response.json()["detail"]
    assert (
        post(client, account["id"], "deposits", date=day(-10), amount_cents=100).status_code == 201
    )
    assert balance(client, account["id"]) == 700


# ---- lançamentos manuais e extrato ---------------------------------------------------------


def test_manual_entries_have_the_right_sign_and_the_statement_shows_running_balance(
    client, institution
):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    activate(client, account, 1_000, on=-20)
    assert post(client, account, "deposits", date=day(-15), amount_cents=500).status_code == 201
    assert post(client, account, "withdrawals", date=day(-10), amount_cents=200).status_code == 201
    assert post(client, account, "fees", date=day(-5), amount_cents=30).status_code == 201
    assert post(client, account, "adjustments", date=day(-4), amount_cents=-20).status_code == 201
    assert post(client, account, "adjustments", date=day(-3), amount_cents=5).status_code == 201

    shown = entries(client, account)
    # Do mais recente ao mais antigo, com o saldo logo depois de cada lançamento.
    assert [(e["kind"], e["amount_cents"], e["balance_cents"]) for e in shown] == [
        ("ajuste", 5, 1_255),
        ("ajuste", -20, 1_250),
        ("taxa", -30, 1_270),
        ("retirada", -200, 1_300),
        ("deposito", 500, 1_500),
        ("saldo_inicial", 1_000, 1_000),
    ]
    assert balance(client, account) == 1_255


def test_statement_filters_by_period_but_keeps_the_running_balance(client, institution):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    activate(client, account, 1_000, on=-20)
    post(client, account, "deposits", date=day(-10), amount_cents=500)
    body = client.get(
        f"{API}/accounts/{account}/entries", params={"start": day(-12), "end": day(-5)}
    ).json()
    assert [(e["kind"], e["balance_cents"]) for e in body["entries"]] == [("deposito", 1_500)]
    assert body["balance_cents"] == 1_500


def test_invalid_amounts_are_rejected(client, institution):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    activate(client, account, 1_000)
    for path, amount in [("deposits", 0), ("withdrawals", -5), ("fees", 0), ("adjustments", 0)]:
        assert post(client, account, path, amount_cents=amount).status_code == 422
    assert balance(client, account) == 1_000


def test_withdrawal_above_the_cash_is_refused_with_the_shortfall_and_saves_nothing(
    client, institution
):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    activate(client, account, 1_000)
    response = post(client, account, "withdrawals", date=day(), amount_cents=1_250)
    assert response.status_code == 422
    body = response.json()
    assert body["shortfall_cents"] == 250
    assert "R$ 2,50" in body["detail"]
    assert len(entries(client, account)) == 1
    assert capital(client)["contributed_cents"] == 0


def test_negative_balance_on_a_future_day_blocks_an_earlier_entry(client, institution):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    activate(client, account, 600)
    # Uma retirada futura de tudo: o saldo hoje (600) sobra, mas depois dela fica zero.
    assert post(client, account, "withdrawals", date=day(10), amount_cents=600).status_code == 201

    response = post(client, account, "fees", date=day(), amount_cents=100)
    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 100
    assert balance(client, account, as_of=day(10)) == 0

    # Um depósito no meio do caminho cobre a taxa e libera.
    post(client, account, "deposits", date=day(), amount_cents=100)
    assert post(client, account, "fees", date=day(), amount_cents=100).status_code == 201


def test_removing_a_deposit_that_covers_later_spending_is_blocked(client, institution):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    activate(client, account, 0)
    deposit = post(client, account, "deposits", date=day(-5), amount_cents=500).json()
    post(client, account, "withdrawals", date=day(-1), amount_cents=500)

    response = client.delete(f"{API}/cash/entries/{deposit['id']}")
    assert response.status_code == 409
    assert response.json()["shortfall_cents"] == 500
    assert balance(client, account) == 0


def test_entries_can_be_deleted_by_hand_but_not_the_opening_with_other_entries(client, institution):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    opening = activate(client, account, 600)
    fee = post(client, account, "fees", date=day(-1), amount_cents=100).json()
    assert fee["deletable"] is True
    assert entries(client, account)[-1]["deletable"] is False  # o saldo inicial, com outros

    assert client.delete(f"{API}/cash/entries/{opening['id']}").status_code == 409
    assert client.delete(f"{API}/cash/entries/{fee['id']}").status_code == 204
    assert balance(client, account) == 600
    assert client.delete(f"{API}/cash/entries/{fee['id']}").status_code == 404

    # Sozinho, o saldo inicial pode sair: o caixa volta a ficar desativado.
    assert client.delete(f"{API}/cash/entries/{opening['id']}").status_code == 204
    assert client.get(f"{API}/accounts/{account}").json()["cash_enabled"] is False


# ---- transferência entre contas ------------------------------------------------------------


def two_accounts(client, institution):
    a = client.get(f"{API}/accounts").json()[0]["id"]
    b = new_account(client, "Conta B", institution["id"])["id"]
    return a, b


def test_transfer_moves_cash_without_touching_total_or_capital(client, institution):
    a, b = two_accounts(client, institution)
    activate(client, a, 30_000)
    activate(client, b, 0)
    post(client, a, "deposits", date=day(-10), amount_cents=5_000)
    total_before = client.get(f"{API}/cash/balance").json()["total_cents"]
    capital_before = capital(client)["contributed_cents"]

    response = client.post(
        f"{API}/cash/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount_cents": 10_000, "date": day()},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["from_entry"]["amount_cents"] == -10_000
    assert body["to_entry"]["amount_cents"] == 10_000
    assert (
        body["from_entry"]["transfer_id"] == body["to_entry"]["transfer_id"] == body["transfer_id"]
    )
    assert body["from_entry"]["counterpart_account_id"] == b
    assert body["to_entry"]["counterpart_account_id"] == a

    assert balance(client, a) == 25_000
    assert balance(client, b) == 10_000
    consolidated = client.get(f"{API}/cash/balance").json()
    assert consolidated["total_cents"] == total_before == 35_000
    assert {x["account_id"]: x["balance_cents"] for x in consolidated["accounts"]} == {
        a: 25_000,
        b: 10_000,
    }
    assert capital(client)["contributed_cents"] == capital_before == 5_000


def test_transfer_without_enough_cash_is_blocked_and_leaves_no_half_entry(client, institution):
    a, b = two_accounts(client, institution)
    activate(client, a, 5_000)
    activate(client, b, 0)
    response = client.post(
        f"{API}/cash/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount_cents": 10_000},
    )
    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 5_000
    assert (balance(client, a), balance(client, b)) == (5_000, 0)
    assert len(entries(client, a)) == 1
    assert len(entries(client, b)) == 1


def test_transfer_to_an_account_without_cash_saves_nothing(client, institution):
    a, b = two_accounts(client, institution)
    activate(client, a, 5_000)  # b não tem caixa ativado
    response = client.post(
        f"{API}/cash/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount_cents": 1_000},
    )
    assert response.status_code == 422
    assert balance(client, a) == 5_000
    assert len(entries(client, a)) == 1


def test_transfer_needs_different_accounts(client, institution):
    a, _ = two_accounts(client, institution)
    activate(client, a, 5_000)
    response = client.post(
        f"{API}/cash/transfers",
        json={"from_account_id": a, "to_account_id": a, "amount_cents": 1_000},
    )
    assert response.status_code == 422


def test_deleting_a_transfer_removes_both_legs_unless_it_would_overdraw_the_destination(
    client, institution
):
    a, b = two_accounts(client, institution)
    activate(client, a, 10_000)
    activate(client, b, 0)
    moved = client.post(
        f"{API}/cash/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount_cents": 4_000, "date": day(-5)},
    ).json()
    post(client, b, "withdrawals", date=day(-1), amount_cents=4_000)

    blocked = client.delete(f"{API}/cash/entries/{moved['from_entry']['id']}")
    assert blocked.status_code == 409
    assert (balance(client, a), balance(client, b)) == (6_000, 0)

    post(client, b, "deposits", date=day(-2), amount_cents=4_000)
    assert client.delete(f"{API}/cash/entries/{moved['to_entry']['id']}").status_code == 204
    assert balance(client, a) == 10_000


# ---- conciliação ---------------------------------------------------------------------------


def reconcile(client, account, real, **params):
    return client.get(f"{API}/accounts/{account}/reconcile", params={"real_cents": real, **params})


def test_reconcile_reports_positive_negative_and_zero_differences_read_only(client, institution):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    activate(client, account, 10_000)

    over = reconcile(client, account, 10_300).json()
    assert (over["calculated_cents"], over["real_cents"], over["difference_cents"]) == (
        10_000,
        10_300,
        300,
    )
    assert reconcile(client, account, 9_700).json()["difference_cents"] == -300
    assert reconcile(client, account, 10_000).json()["difference_cents"] == 0
    assert len(entries(client, account)) == 1  # conciliar não grava nada


def test_reconcile_uses_the_balance_as_of_the_given_date(client, institution):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    activate(client, account, 10_000)
    post(client, account, "deposits", date=day(-5), amount_cents=2_000)
    result = reconcile(client, account, 10_000, as_of=day(-10)).json()
    assert (result["calculated_cents"], result["difference_cents"]) == (10_000, 0)
    assert reconcile(client, account, 10_000, as_of=day(-31)).status_code == 422  # antes do corte


def test_adjustment_is_only_saved_with_confirmation_and_a_difference(client, institution):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    activate(client, account, 10_000)
    url = f"{API}/accounts/{account}/reconcile/adjustment"

    unconfirmed = client.post(url, json={"real_cents": 10_300})
    assert unconfirmed.status_code == 422
    assert balance(client, account) == 10_000

    no_difference = client.post(url, json={"real_cents": 10_000, "confirm": True})
    assert no_difference.status_code == 422
    assert len(entries(client, account)) == 1

    positive = client.post(url, json={"real_cents": 10_300, "confirm": True})
    assert positive.status_code == 201
    assert (positive.json()["kind"], positive.json()["amount_cents"]) == ("ajuste", 300)
    assert balance(client, account) == 10_300

    negative = client.post(url, json={"real_cents": 9_000, "confirm": True}).json()
    assert negative["amount_cents"] == -1_300
    assert balance(client, account) == 9_000
    assert reconcile(client, account, 9_000).json()["difference_cents"] == 0
    assert capital(client)["contributed_cents"] == 0  # ajuste não é capital


def test_negative_adjustment_cannot_overdraw_a_future_day(client, institution):
    account = client.get(f"{API}/accounts").json()[0]["id"]
    activate(client, account, 1_000)
    post(client, account, "withdrawals", date=day(5), amount_cents=1_000)
    response = client.post(
        f"{API}/accounts/{account}/reconcile/adjustment",
        json={"real_cents": 500, "as_of": day(), "confirm": True},
    )
    assert response.status_code == 422
    assert response.json()["shortfall_cents"] == 500


# ---- capital aportado ----------------------------------------------------------------------


def test_contributed_capital_by_account_and_consolidated(client, institution):
    a, b = two_accounts(client, institution)
    activate(client, a, 50_000)
    activate(client, b, 0)
    post(client, a, "deposits", date=day(-10), amount_cents=20_000)
    post(client, a, "withdrawals", date=day(-9), amount_cents=5_000)
    post(client, b, "deposits", date=day(-8), amount_cents=1_000)
    post(client, a, "fees", date=day(-7), amount_cents=100)

    total = capital(client)
    assert (total["deposits_cents"], total["withdrawals_cents"], total["contributed_cents"]) == (
        21_000,
        5_000,
        16_000,
    )
    assert {x["account_id"]: x["contributed_cents"] for x in total["by_account"]} == {
        a: 15_000,
        b: 1_000,
    }
    only_a = capital(client, account_id=a)
    assert only_a["contributed_cents"] == 15_000
    assert [x["account_id"] for x in only_a["by_account"]] == [a]
    assert capital(client, as_of=day(-9))["contributed_cents"] == 15_000
    assert capital(client, start=day(-8))["contributed_cents"] == 1_000
    assert (
        client.get(f"{API}/cash/contributed-capital", params={"account_id": 999}).status_code == 404
    )


# ---- contas: arquivar, renomear, instituição -----------------------------------------------


def test_account_with_cash_cannot_be_archived_until_empty(client, institution):
    a, b = two_accounts(client, institution)
    activate(client, b, 1_000)
    blocked = client.put(f"{API}/accounts/{b}", json={"name": "Conta B", "archived": True})
    assert blocked.status_code == 409
    post(client, b, "withdrawals", date=day(), amount_cents=1_000)
    done = client.put(f"{API}/accounts/{b}", json={"name": "Conta B2", "archived": True})
    assert (done.status_code, done.json()["name"], done.json()["archived"]) == (
        200,
        "Conta B2",
        True,
    )
    assert [x["id"] for x in client.get(f"{API}/accounts").json()] == [a]
    # Conta arquivada não recebe lançamentos nem ativos novos.
    assert post(client, b, "deposits", amount_cents=100).status_code == 422


def test_renaming_the_institution_renames_its_untouched_account(client, institution):
    client.put(f"{API}/institutions/{institution['id']}", json={"name": "Banco Novo"})
    assert [a["name"] for a in client.get(f"{API}/accounts").json()] == ["Banco Novo"]


def test_institution_without_cash_history_can_be_deleted_with_its_account(client):
    created = client.post(f"{API}/institutions", json={"name": "Sem Uso"}).json()
    assert client.delete(f"{API}/institutions/{created['id']}").status_code == 204
    assert client.get(f"{API}/accounts").json() == []


def test_institution_with_cash_entries_cannot_be_deleted(client):
    created = client.post(f"{API}/institutions", json={"name": "Com Caixa"}).json()
    account = client.get(f"{API}/accounts").json()[0]["id"]
    activate(client, account, 100)
    assert client.delete(f"{API}/institutions/{created['id']}").status_code == 409
    assert len(client.get(f"{API}/accounts").json()) == 1


# ---- resumo da carteira --------------------------------------------------------------------


OLD_SUMMARY_FIELDS = [
    "total_current_cents",
    "total_invested_cents",
    "return_bps",
    "assets_count",
    "investments_current_cents",
    "reserve_current_cents",
    "reserve_invested_cents",
    "proventos_cents",
    "by_class",
    "by_type",
    "fii_segments",
    "by_institution",
]


def test_summary_shows_cash_apart_without_changing_the_old_totals(client, institution, make_asset):
    make_asset(invested=100_000, current=110_000)
    before = client.get(f"{API}/portfolio/summary").json()
    assert (before["cash_cents"], before["total_with_cash_cents"]) == (0, 110_000)

    a, b = two_accounts(client, institution)
    activate(client, a, 30_000)
    activate(client, b, 5_000)
    post(client, a, "deposits", date=day(-1), amount_cents=2_000)
    post(client, b, "withdrawals", date=day(-1), amount_cents=500)
    # Lançamento futuro não conta no caixa de hoje.
    post(client, a, "deposits", date=day(20), amount_cents=9_999)

    after = client.get(f"{API}/portfolio/summary").json()
    assert after["cash_cents"] == 30_000 + 2_000 + 5_000 - 500
    assert after["total_with_cash_cents"] == 110_000 + after["cash_cents"]
    for field in OLD_SUMMARY_FIELDS:
        assert after[field] == before[field], field
