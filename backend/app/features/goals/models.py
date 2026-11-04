from sqlalchemy import Integer, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class GoalSetting(Base):
    """Metas e premissas da projeção (id = 1). Zero em uma meta significa "sem meta"."""

    __tablename__ = "goal_setting"

    id: Mapped[int] = mapped_column(primary_key=True)
    net_worth_goal_cents: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    year_goal_cents: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    # Aporte mensal da projeção; zero = usar a média dos últimos aportes registrados.
    monthly_cents: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    horizon_years: Mapped[int] = mapped_column(Integer, default=20, server_default=text("20"))
    # Retornos e inflação nominais ao ano, em pontos-base.
    inflation_bps: Mapped[int] = mapped_column(Integer, default=450, server_default=text("450"))
    conservative_bps: Mapped[int] = mapped_column(Integer, default=600, server_default=text("600"))
    base_bps: Mapped[int] = mapped_column(Integer, default=900, server_default=text("900"))
    optimistic_bps: Mapped[int] = mapped_column(Integer, default=1200, server_default=text("1200"))
