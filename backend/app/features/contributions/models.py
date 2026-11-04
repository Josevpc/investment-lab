from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Contribution(Base):
    __tablename__ = "contribution"

    id: Mapped[int] = mapped_column(primary_key=True)
    month: Mapped[str] = mapped_column(String(7), unique=True)  # YYYY-MM
    salary_cents: Mapped[int] = mapped_column(Integer)
    percent_bps: Mapped[int] = mapped_column(Integer)
    calculated_cents: Mapped[int] = mapped_column(Integer)
    final_cents: Mapped[int] = mapped_column(Integer)
    # Plano do mês, gravado ao salvar: parte da reserva, modo de divisão e valor por categoria.
    reserve_cents: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    mode: Mapped[str | None] = mapped_column(String(12), nullable=True)
    plan_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    items: Mapped[list["ContributionItem"]] = relationship(
        back_populates="contribution", cascade="all, delete-orphan", order_by="ContributionItem.id"
    )


class ContributionItem(Base):
    """Quanto do aporte do mês foi planejado para cada categoria."""

    __tablename__ = "contribution_item"
    __table_args__ = (UniqueConstraint("contribution_id", "class_id", name="uq_contribution_item"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    contribution_id: Mapped[int] = mapped_column(
        ForeignKey("contribution.id", ondelete="CASCADE"), index=True
    )
    class_id: Mapped[int] = mapped_column(ForeignKey("asset_class.id"))
    amount_cents: Mapped[int] = mapped_column(Integer)

    contribution: Mapped[Contribution] = relationship(back_populates="items")
