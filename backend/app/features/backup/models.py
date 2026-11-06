from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class OffsiteBackupSetting(Base):
    """Configuração única (id = 1) da cópia do banco fora deste computador.

    A pasta é um caminho deste computador, então a tabela fica **fora** do JSON de backup e não é
    apagada ao restaurar nem ao reiniciar os dados (ver `serialization.LOCAL_TABLES`).
    """

    __tablename__ = "offsite_backup_setting"
    __table_args__ = (CheckConstraint("id = 1", name="ck_offsite_backup_setting_single_row"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nula = cópia externa desligada.
    folder: Mapped[str | None] = mapped_column(String, nullable=True)
    # Hora local, sem fuso, da última cópia gravada com sucesso na pasta atual (trocar de pasta ou
    # desligar zera este campo e o de baixo).
    last_copy_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Só o nome do arquivo: a pasta pode mudar e o nome continua dizendo qual foi.
    last_copy_file: Mapped[str | None] = mapped_column(String, nullable=True)
