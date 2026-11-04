from sqlalchemy import Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ReserveSetting(Base):
    """Configuração única (id = 1) da reserva de emergência."""

    __tablename__ = "reserve_setting"

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_cents: Mapped[int] = mapped_column(Integer, default=0)
    months: Mapped[int] = mapped_column(Integer, default=6)  # meses de salário que a meta cobre
    monthly_cents: Mapped[int] = mapped_column(Integer, default=0)  # aporte mensal planejado
    # Parte do aporte do mês que vai para a reserva, quando `monthly_mode` é "percent".
    percent_bps: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    monthly_mode: Mapped[str] = mapped_column(
        String(8), default="fixed", server_default=text("'fixed'")
    )
