import datetime as dt

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# Sinal de cada tipo de lançamento. Fica no banco também para que nada (nem um script) grave um
# depósito negativo ou uma compra positiva.
SIGN_RULE = (
    "(kind IN ('deposito', 'provento', 'venda') AND amount_cents > 0) OR "
    "(kind IN ('compra', 'retirada', 'taxa') AND amount_cents < 0) OR "
    "(kind = 'ajuste' AND amount_cents != 0) OR "
    "(kind = 'saldo_inicial' AND amount_cents >= 0) OR "
    "(kind = 'transferencia' AND amount_cents != 0)"
)


class Account(Base):
    """Conta de investimento (corretora ou banco) que guarda o caixa. Não tem coluna de saldo:
    o saldo é sempre a soma dos lançamentos (`cash_entry`)."""

    __tablename__ = "account"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    institution_id: Mapped[int] = mapped_column(ForeignKey("institution.id"))
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))


class CashEntry(Base):
    """Lançamento do caixa de uma conta. `amount_cents` tem sinal: entra (+) ou sai (-).

    - saldo_inicial: ativa o caixa da conta; nada pode ser lançado antes dessa data;
    - deposito / retirada: dinheiro externo que entra ou sai (compõem o capital aportado);
    - provento / venda: dinheiro que volta dos ativos; compra: dinheiro que vira ativo;
    - taxa / ajuste: custos e correções de conciliação;
    - transferencia: movimento entre duas contas, em par ligado por `transfer_id`.
    """

    __tablename__ = "cash_entry"
    __table_args__ = (
        CheckConstraint(SIGN_RULE, name="ck_cash_entry_sign"),
        Index("ix_cash_entry_account_date", "account_id", "date"),
        # No máximo um saldo inicial por conta.
        Index(
            "uq_cash_entry_opening",
            "account_id",
            unique=True,
            sqlite_where=text("kind = 'saldo_inicial'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"))
    date: Mapped[dt.date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(16))
    amount_cents: Mapped[int] = mapped_column(Integer)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("asset.id"))
    # Movimento da carteira que gerou o lançamento (aporte, provento); desfazer um remove o outro.
    movement_id: Mapped[int | None] = mapped_column(ForeignKey("asset_movement.id"))
    transfer_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=dt.datetime.now, server_default=text("CURRENT_TIMESTAMP")
    )


class CashReservation(Base):
    """Dinheiro do caixa de uma conta separado para comprar uma categoria. Não move saldo: o
    caixa continua sendo a soma de `cash_entry`; a reserva só marca quanto dele já tem destino.
    O que ainda está separado é `amount_cents` menos a soma dos usos (`cash_reservation_use`)."""

    __tablename__ = "cash_reservation"
    __table_args__ = (
        CheckConstraint("amount_cents > 0", name="ck_cash_reservation_amount"),
        Index("ix_cash_reservation_account_class_date", "account_id", "class_id", "date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"))
    class_id: Mapped[int] = mapped_column(ForeignKey("asset_class.id"))
    date: Mapped[dt.date] = mapped_column(Date)
    amount_cents: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=dt.datetime.now, server_default=text("CURRENT_TIMESTAMP")
    )


class CashReservationUse(Base):
    """Baixa de uma reserva. Sempre positiva; o `kind` diz o que foi feito com o dinheiro:

    - compra: virou ativo, e `movement_id` aponta para o aporte que o gastou;
    - liberacao: voltou a ser caixa livre, sem movimento da carteira (`movement_id` nulo).
    """

    __tablename__ = "cash_reservation_use"
    __table_args__ = (
        CheckConstraint("kind IN ('compra', 'liberacao')", name="ck_cash_reservation_use_kind"),
        CheckConstraint("amount_cents > 0", name="ck_cash_reservation_use_amount"),
        # Liberar dinheiro não mexe na carteira: só uma compra pode apontar para um movimento.
        CheckConstraint(
            "movement_id IS NULL OR kind = 'compra'", name="ck_cash_reservation_use_movement"
        ),
        Index("ix_cash_reservation_use_reservation", "reservation_id"),
        Index("ix_cash_reservation_use_movement", "movement_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    reservation_id: Mapped[int] = mapped_column(ForeignKey("cash_reservation.id"))
    kind: Mapped[str] = mapped_column(String(16))
    date: Mapped[dt.date] = mapped_column(Date)
    amount_cents: Mapped[int] = mapped_column(Integer)
    movement_id: Mapped[int | None] = mapped_column(ForeignKey("asset_movement.id"))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=dt.datetime.now, server_default=text("CURRENT_TIMESTAMP")
    )
