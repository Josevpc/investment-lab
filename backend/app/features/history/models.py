import datetime as dt

from sqlalchemy import Date, ForeignKey, Integer, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Snapshot(Base):
    __tablename__ = "snapshot"

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, unique=True)
    total_cents: Mapped[int] = mapped_column(Integer)
    invested_cents: Mapped[int] = mapped_column(Integer)
    # Parte do total que estava na reserva de emergência (já incluída em total_cents).
    reserve_cents: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))

    items: Mapped[list["SnapshotItem"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )


class SnapshotItem(Base):
    __tablename__ = "snapshot_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_id: Mapped[int] = mapped_column(ForeignKey("snapshot.id", ondelete="CASCADE"))
    # Nulo em snapshots digitados à mão, que guardam só o total por categoria.
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("asset.id"))
    # A classe é copiada para o snapshot: reclassificar o ativo depois não muda o histórico.
    class_id: Mapped[int] = mapped_column(ForeignKey("asset_class.id"))
    invested_cents: Mapped[int] = mapped_column(Integer)
    current_cents: Mapped[int] = mapped_column(Integer)
