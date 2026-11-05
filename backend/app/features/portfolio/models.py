import datetime as dt

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class AssetGroup(Base):
    """Grupo de categorias (ex.: "Renda variável" com FII e Ações/ETF).

    Só apresentação: agrupa categorias nas telas. Nenhuma regra de aporte, meta ou rebalanceamento
    olha para ele; a meta do grupo é apenas a soma das metas das categorias dentro dele.
    """

    __tablename__ = "asset_group"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True)
    color: Mapped[str] = mapped_column(String(16))
    # Grupo "removido": solta as categorias e some das telas.
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))


class AssetClass(Base):
    __tablename__ = "asset_class"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    color: Mapped[str] = mapped_column(String(16))
    # Categoria "removida" da carteira: some das telas, mas o histórico continua válido.
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    # Grupo a que a categoria pertence (no máximo um); nulo = fora de qualquer grupo.
    group_id: Mapped[int | None] = mapped_column(ForeignKey("asset_group.id"))


class Institution(Base):
    __tablename__ = "institution"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class Asset(Base):
    __tablename__ = "asset"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    ticker: Mapped[str | None] = mapped_column(String(20))
    class_id: Mapped[int] = mapped_column(ForeignKey("asset_class.id"))
    institution_id: Mapped[int] = mapped_column(ForeignKey("institution.id"))
    indexer: Mapped[str | None] = mapped_column(String(10))
    rate_bps: Mapped[int | None] = mapped_column(Integer)
    maturity_date: Mapped[dt.date | None] = mapped_column(Date)
    quantity: Mapped[str | None] = mapped_column(String(40))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    # Finalidade do ativo, independente da categoria. Hoje só "reserva" (reserva de emergência).
    purpose: Mapped[str | None] = mapped_column(String(20))
    # Tipo do ativo para análises micro: "acao", "etf" ou "fii".
    asset_type: Mapped[str | None] = mapped_column(String(12))
    # Só para fundos imobiliários: "papel" ou "tijolo".
    fii_segment: Mapped[str | None] = mapped_column(String(12))
    # Conta (corretora/banco) onde o ativo está e de cujo caixa saem as compras. Nulo só em
    # ativos criados antes do caixa e fora de qualquer conta.
    account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    # "Manter posição": o ativo não recebe aportes novos, mas continua contando no valor da
    # categoria. Só a categoria cujos ativos estão TODOS mantidos sai da base e do peso das metas.
    # O padrão em Python cobre backups antigos, sem a coluna.
    hold_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    # O saldo que o usuário digita já vem com o IR descontado (ex.: Caixinha do Mercado Pago) em vez
    # de bruto (ex.: Tesouro Reserva). Só rotula o desempenho: o app não calcula imposto.
    balance_is_net: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))

    asset_class: Mapped[AssetClass] = relationship(lazy="joined")
    institution: Mapped[Institution] = relationship(lazy="joined")


class AssetValuation(Base):
    __tablename__ = "asset_valuation"
    __table_args__ = (UniqueConstraint("asset_id", "date", name="uq_valuation_asset_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("asset.id", ondelete="CASCADE"))
    date: Mapped[dt.date] = mapped_column(Date)
    invested_cents: Mapped[int] = mapped_column(Integer)
    current_cents: Mapped[int] = mapped_column(Integer)
    # True quando o saldo foi digitado a partir do extrato (cadastro, fechamento ou correção).
    # False nas linhas criadas por transferência ou provento, que não trazem o rendimento
    # acumulado até a data: o desempenho contra o CDI só usa saldos observados.
    observed: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("1"))


class AssetMovement(Base):
    """Diário de movimentos: aportes, proventos, transferências entre ativos e resgates.

    - aporte: dinheiro novo no ativo `asset_id`.
    - provento: `asset_id` pagou; `related_asset_id` (opcional) é o ativo que recebeu o dinheiro.
    - transferencia: `related_asset_id` (origem) -> `asset_id` (destino); `cost_cents` é o
      custo de aquisição que acompanha o dinheiro.
    - resgate: dinheiro que saiu do ativo `asset_id` (sem destino na carteira); `cost_cents` é o
      custo de aquisição que saiu do investido junto com o valor.
    """

    __tablename__ = "asset_movement"
    # No máximo um aporte inicial por ativo.
    __table_args__ = (
        Index(
            "uq_movement_initial_per_asset",
            "asset_id",
            unique=True,
            sqlite_where=text("initial = 1"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(16))
    asset_id: Mapped[int] = mapped_column(ForeignKey("asset.id"))
    related_asset_id: Mapped[int | None] = mapped_column(ForeignKey("asset.id"))
    amount_cents: Mapped[int] = mapped_column(Integer)
    cost_cents: Mapped[int | None] = mapped_column(Integer)
    # Aporte lançado como compra na hora (e não no fechamento do mês): o valor já está em todas as
    # linhas de valorização desde a data, e não só no próximo saldo digitado. Vale ao desfazer.
    from_purchase: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    # Aporte inicial de um ativo cadastrado como novo: nasce do valor investido da 1ª valorização,
    # que já contém o dinheiro. Só alimenta os relatórios de aporte; nunca mexe em saldos nem no
    # caixa, e some se o ativo deixa de ser marcado como novo.
    initial: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    # Resgate: motivo livre e opcional (só para exibir; nunca entra em conta nenhuma).
    note: Mapped[str | None] = mapped_column(String(120))
    # Resgate cujo saldo digitado já veio sem o dinheiro: o valor nunca saiu do saldo por aqui, só o
    # custo saiu do investido. Vale ao desfazer, para reverter só o que foi mexido.
    in_balance: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    # Aporte "fora da meta" (só em kind="aporte"): segue sendo dinheiro aportado em tudo (investido,
    # patrimônio, rentabilidade, caixa, saldos), mas não conta no plano do mês, na sequência de
    # meses cumpridos nem no ritmo de aporte. É só uma marca: não mexe em saldo nem em caixa.
    off_goal: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))

    asset: Mapped[Asset] = relationship(foreign_keys=[asset_id], lazy="joined")
    related_asset: Mapped[Asset | None] = relationship(
        foreign_keys=[related_asset_id], lazy="joined"
    )
