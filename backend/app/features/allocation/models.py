from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class AllocationPlan(Base):
    __tablename__ = "allocation_plan"
    __table_args__ = (
        # No máximo um plano ativo por vez.
        Index(
            "uq_allocation_plan_active",
            "is_active",
            unique=True,
            sqlite_where=text("is_active = 1"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    targets: Mapped[list["AllocationTarget"]] = relationship(
        cascade="all, delete-orphan", order_by="AllocationTarget.class_id", lazy="selectin"
    )


class AllocationTarget(Base):
    __tablename__ = "allocation_target"

    plan_id: Mapped[int] = mapped_column(
        ForeignKey("allocation_plan.id", ondelete="CASCADE"), primary_key=True
    )
    class_id: Mapped[int] = mapped_column(ForeignKey("asset_class.id"), primary_key=True)
    percent_bps: Mapped[int] = mapped_column(Integer)
