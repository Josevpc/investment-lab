API = "/api/v1"


def body(institution, **extra):
    return {
        "name": "Ativo",
        "class_key": "renda_variavel",
        "institution_id": institution["id"],
        "current_cents": 10_000,
        **extra,
    }


def create(client, institution, **extra):
    return client.post(f"{API}/assets", json=body(institution, **extra))


# ---- tipo e segmento ---------------------------------------------------------------------


def test_fii_requires_papel_or_tijolo(client, institution):
    missing = create(client, institution, asset_type="fii")
    assert missing.status_code == 422
    assert "papel ou de tijolo" in str(missing.json()["detail"])

    ok = create(client, institution, asset_type="fii", fii_segment="tijolo")
    assert ok.status_code == 201
    assert (ok.json()["asset_type"], ok.json()["fii_segment"]) == ("fii", "tijolo")


def test_segment_is_only_for_fiis(client, institution):
    for asset_type in (None, "acao", "etf"):
        extra = {"fii_segment": "papel", **({"asset_type": asset_type} if asset_type else {})}
        response = create(client, institution, **extra)
        assert response.status_code == 422, asset_type
        assert "só para fundos imobiliários" in str(response.json()["detail"])

    assert create(client, institution, asset_type="acao").status_code == 201
    assert create(client, institution, asset_type="etf").status_code == 201


def test_type_and_segment_values_are_validated(client, institution):
    assert create(client, institution, asset_type="cripto").status_code == 422
    assert create(client, institution, asset_type="fii", fii_segment="hibrido").status_code == 422


def test_assets_without_type_are_still_allowed(client, institution):
    created = create(client, institution).json()
    assert created["asset_type"] is None
    assert created["fii_segment"] is None


def update_body(asset, **extra):
    return {
        "name": asset["name"],
        "class_key": asset["class_key"],
        "institution_id": asset["institution_id"],
        "archived": False,
        **extra,
    }


def test_update_sets_changes_and_clears_type_and_segment(client, institution):
    asset = create(client, institution).json()
    url = f"{API}/assets/{asset['id']}"

    as_fii = client.put(url, json=update_body(asset, asset_type="fii", fii_segment="papel"))
    assert as_fii.status_code == 200
    assert as_fii.json()["fii_segment"] == "papel"

    # Trocar o segmento mantém o tipo; mudar o tipo exige tirar o segmento.
    assert (
        client.put(url, json=update_body(asset, asset_type="fii", fii_segment="tijolo")).json()[
            "fii_segment"
        ]
        == "tijolo"
    )
    stale = client.put(url, json=update_body(asset, asset_type="etf", fii_segment="tijolo"))
    assert stale.status_code == 422
    as_etf = client.put(url, json=update_body(asset, asset_type="etf")).json()
    assert (as_etf["asset_type"], as_etf["fii_segment"]) == ("etf", None)


# ---- composição no resumo ----------------------------------------------------------------


def test_summary_breaks_down_types_and_fii_segments(client, institution):
    create(client, institution, name="PETR4", asset_type="acao", current_cents=200_000)
    create(client, institution, name="IVVB11", asset_type="etf", current_cents=100_000)
    create(
        client,
        institution,
        name="HGLG11",
        asset_type="fii",
        fii_segment="tijolo",
        current_cents=300_000,
    )
    create(
        client,
        institution,
        name="KNCR11",
        asset_type="fii",
        fii_segment="papel",
        current_cents=100_000,
    )
    create(client, institution, name="Sem tipo", current_cents=50_000)
    fixed = client.post(
        f"{API}/assets",
        json=body(institution, name="CDB", class_key="renda_fixa", current_cents=900_000),
    ).json()
    assert fixed["asset_type"] is None

    summary = client.get(f"{API}/portfolio/summary").json()
    types = {t["asset_type"]: t for t in summary["by_type"]}
    assert [t["asset_type"] for t in summary["by_type"]] == ["acao", "etf", "fii"]
    assert types["fii"]["current_cents"] == 400_000
    assert types["fii"]["assets_count"] == 2
    assert types["fii"]["share_bps"] == 5_714  # 400 de 700 mil tipados
    assert types["acao"]["share_bps"] == 2_857

    segments = {s["segment"]: s for s in summary["fii_segments"]}
    assert segments["tijolo"]["current_cents"] == 300_000
    assert segments["tijolo"]["share_bps"] == 7_500
    assert segments["papel"]["share_bps"] == 2_500

    # Renda fixa não pede tipo; só o ativo de renda variável sem tipo aparece como pendente.
    assert summary["untyped_count"] == 1
    assert summary["untyped_current_cents"] == 50_000


def test_fii_segments_include_proventos_and_ignore_reserve_and_archived(client, institution):
    fii = create(client, institution, name="HGLG11", asset_type="fii", fii_segment="tijolo").json()
    client.post(
        f"{API}/proventos", json={"asset_id": fii["id"], "amount_cents": 800, "date": "2099-01-01"}
    )
    create(
        client,
        institution,
        name="Na reserva",
        asset_type="fii",
        fii_segment="papel",
        purpose="reserva",
    )
    gone = create(
        client, institution, name="Arquivado", asset_type="fii", fii_segment="papel"
    ).json()
    client.put(
        f"{API}/assets/{gone['id']}",
        json=update_body(gone, asset_type="fii", fii_segment="papel", archived=True),
    )

    segments = {
        s["segment"]: s for s in client.get(f"{API}/portfolio/summary").json()["fii_segments"]
    }
    assert set(segments) == {"tijolo"}
    assert segments["tijolo"]["proventos_cents"] == 800


def test_fii_without_segment_in_legacy_rows_shows_as_unclassified(client, institution):
    """Linhas antigas (tipo definido direto no banco, sem segmento) não quebram o resumo."""
    from sqlalchemy import update

    from app.core.db import get_session
    from app.features.portfolio.models import Asset

    asset = create(client, institution, name="Antigo", asset_type="fii", fii_segment="papel").json()
    session = next(client.app.dependency_overrides[get_session]())
    session.execute(update(Asset).where(Asset.id == asset["id"]).values(fii_segment=None))
    session.commit()

    summary = client.get(f"{API}/portfolio/summary").json()
    assert [s["segment"] for s in summary["fii_segments"]] == ["sem_segmento"]


# ---- histórico de valores: corrigir e excluir -------------------------------------------


def test_valuation_can_be_corrected_and_updates_the_current_position(client, institution):
    asset = create(
        client,
        institution,
        name="VGHF11",
        current_cents=553,
        invested_cents=2_877,
        valuation_date="2026-10-17",
    ).json()
    valuations = client.get(f"{API}/assets/{asset['id']}/valuations").json()
    assert len(valuations) == 1

    fixed = client.put(
        f"{API}/assets/{asset['id']}/valuations/{valuations[0]['id']}",
        json={"date": "2026-10-17", "invested_cents": 2_877, "current_cents": 2_790},
    )
    assert fixed.status_code == 200
    now = client.get(f"{API}/assets/{asset['id']}").json()
    assert now["current_cents"] == 2_790
    assert now["gain_cents"] == -87
    assert client.get(f"{API}/portfolio/summary").json()["total_current_cents"] == 2_790


def test_correcting_an_older_valuation_keeps_the_latest_as_current(client, institution):
    asset = create(
        client, institution, current_cents=100, invested_cents=100, valuation_date="2026-01-31"
    ).json()
    client.post(
        f"{API}/assets/{asset['id']}/valuations",
        json={"date": "2026-02-28", "invested_cents": 100, "current_cents": 150},
    )
    older = client.get(f"{API}/assets/{asset['id']}/valuations").json()[-1]
    assert older["date"] == "2026-01-31"

    client.put(
        f"{API}/assets/{asset['id']}/valuations/{older['id']}",
        json={"date": "2026-01-31", "invested_cents": 100, "current_cents": 90},
    )
    assert client.get(f"{API}/assets/{asset['id']}").json()["current_cents"] == 150


def test_valuation_date_change_rules(client, institution):
    asset = create(
        client, institution, current_cents=100, invested_cents=100, valuation_date="2026-01-31"
    ).json()
    client.post(
        f"{API}/assets/{asset['id']}/valuations",
        json={"date": "2026-02-28", "invested_cents": 100, "current_cents": 150},
    )
    first, second = sorted(
        client.get(f"{API}/assets/{asset['id']}/valuations").json(), key=lambda v: v["date"]
    )
    url = f"{API}/assets/{asset['id']}/valuations/{first['id']}"

    clash = client.put(url, json={"date": "2026-02-28", "invested_cents": 1, "current_cents": 1})
    assert clash.status_code == 409
    same = client.put(url, json={"date": "2026-01-31", "invested_cents": 5, "current_cents": 5})
    assert same.status_code == 200  # manter a própria data não é conflito
    moved = client.put(url, json={"date": "2026-03-31", "invested_cents": 5, "current_cents": 7})
    assert moved.status_code == 200
    assert (
        client.get(f"{API}/assets/{asset['id']}").json()["current_cents"] == 7
    )  # virou o mais recente
    assert (
        client.put(
            url, json={"date": "2026-03-31", "invested_cents": -1, "current_cents": 1}
        ).status_code
        == 422
    )
    assert second["current_cents"] == 150


def test_valuation_delete_rules(client, institution):
    asset = create(
        client, institution, current_cents=100, invested_cents=100, valuation_date="2026-01-31"
    ).json()
    client.post(
        f"{API}/assets/{asset['id']}/valuations",
        json={"date": "2026-02-28", "invested_cents": 100, "current_cents": 150},
    )
    latest, first = client.get(f"{API}/assets/{asset['id']}/valuations").json()

    # Apagar o registro mais recente devolve o ativo ao valor anterior.
    assert client.delete(f"{API}/assets/{asset['id']}/valuations/{latest['id']}").status_code == 204
    assert client.get(f"{API}/assets/{asset['id']}").json()["current_cents"] == 100

    # O último registro que sobra não pode ser apagado.
    only = client.delete(f"{API}/assets/{asset['id']}/valuations/{first['id']}")
    assert only.status_code == 409
    assert client.delete(f"{API}/assets/{asset['id']}/valuations/9999").status_code == 404
    other = create(client, institution, name="Outro").json()
    # Um valor de outro ativo não pode ser tocado por esta rota.
    assert client.delete(f"{API}/assets/{other['id']}/valuations/{first['id']}").status_code == 404
    assert (
        client.put(
            f"{API}/assets/{other['id']}/valuations/{first['id']}",
            json={"date": "2026-01-31", "invested_cents": 1, "current_cents": 1},
        ).status_code
        == 404
    )
