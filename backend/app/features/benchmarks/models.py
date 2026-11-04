import datetime as dt
from datetime import datetime

from sqlalchemy import Date, DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class BenchmarkRate(Base):
    """Taxa acumulada de um índice de referência (CDI ou Selic) em um mês.

    `rate_ppm` guarda a taxa em partes por milhão de 1 (1,08% = 10.800), sem ponto flutuante.
    """

    __tablename__ = "benchmark_rate"
    __table_args__ = (UniqueConstraint("series", "month", name="uq_benchmark_series_month"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    series: Mapped[str] = mapped_column(String(8))  # "cdi" ou "selic"
    month: Mapped[str] = mapped_column(String(7))  # AAAA-MM
    rate_ppm: Mapped[int] = mapped_column(Integer)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class BenchmarkDaily(Base):
    """Taxa diária do CDI (dias úteis), usada para medir quantos % do CDI um ativo rendeu.

    `rate_e9` guarda a taxa do dia em bilionésimos de 1: 0,043739% a.d. = 437.390. O Banco Central
    publica 6 casas decimais em %, então o inteiro é exato.
    """

    __tablename__ = "benchmark_daily"
    __table_args__ = (UniqueConstraint("series", "date", name="uq_benchmark_daily_series_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    series: Mapped[str] = mapped_column(String(8))  # hoje só "cdi"
    date: Mapped[dt.date] = mapped_column(Date)
    rate_e9: Mapped[int] = mapped_column(Integer)


class BenchmarkIndexLevel(Base):
    """Fechamento diário de um índice de preço (hoje só o Ibovespa), em pontos.

    Fica fora de `benchmark_daily` porque nível de índice não é taxa: o CDI guarda quanto rendeu
    no dia e se acumula multiplicando; o Ibovespa guarda onde fechou e o retorno de um período é
    fechamento final dividido pelo inicial. Misturar os dois na mesma coluna convidaria a
    compor pontos como se fossem taxas.

    `close_e2` guarda o fechamento em centésimos de ponto, sem ponto flutuante:
    129.593,29 pontos = 12.959.329.
    """

    __tablename__ = "benchmark_index_level"
    __table_args__ = (
        UniqueConstraint("series", "date", name="uq_benchmark_index_level_series_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    series: Mapped[str] = mapped_column(String(16))  # hoje só "ibovespa"
    date: Mapped[dt.date] = mapped_column(Date)
    close_e2: Mapped[int] = mapped_column(Integer)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
