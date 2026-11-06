"""Cópia do banco fora deste computador: configuração da pasta, cópia consistente e retenção."""

import os
import shutil
import sqlite3
from datetime import datetime, timedelta

import pytest

from app.core.migrate import upgrade_to_head
from app.core.protection import APP_HEADER
from app.features.backup import domain

URL = "/api/v1/backup/offsite"
NOW = datetime(2026, 11, 5, 14, 30, 15)


@pytest.fixture
def clock(monkeypatch):
    """Controla o "agora" da cópia; `clock.set(dt)` muda o relógio no meio do teste."""

    class Clock:
        now = NOW

        def set(self, moment):
            self.now = moment

    fake = Clock()
    monkeypatch.setattr("app.features.backup.service._now", lambda: fake.now)
    return fake


@pytest.fixture(autouse=True)
def fake_real_data_dir(tmp_path, monkeypatch):
    """A `data/` "real" dos testes é temporária: nada aqui cria pasta na verdadeira."""
    monkeypatch.setattr(
        "app.features.backup.service.REAL_DATABASE_PATH", tmp_path / "realdata" / "investment.db"
    )


@pytest.fixture
def database(isolated_database_file):
    """O arquivo do banco "em uso" dos testes, migrado e com uma instituição."""
    isolated_database_file.parent.mkdir(parents=True, exist_ok=True)
    upgrade_to_head(f"sqlite:///{isolated_database_file.as_posix()}")
    with sqlite3.connect(isolated_database_file) as conn:
        conn.execute("insert into institution (name) values ('Banco da Cópia')")
    return isolated_database_file


@pytest.fixture
def cloud(tmp_path):
    folder = tmp_path / "Nuvem"
    folder.mkdir()
    return folder


@pytest.fixture
def configured(client, cloud):
    response = client.put(URL, json={"folder": str(cloud)})
    assert response.status_code == 200, response.text
    return cloud


def _error(response, status, code):
    assert response.status_code == status, response.text
    body = response.json()
    assert body["code"] == code
    assert body["detail"]  # mensagem em português para a tela mostrar como está
    return body


def _app_copies(folder):
    return sorted(p.name for p in folder.iterdir() if domain.is_app_copy(p.name))


# ---- Regras puras ---------------------------------------------------------------------------


def test_copy_name_follows_the_local_time():
    assert domain.copy_file_name(NOW) == "investment-2026-11-05-143015.db"
    assert domain.copy_file_name(datetime(2026, 1, 2, 3, 4, 5)) == "investment-2026-01-02-030405.db"


@pytest.mark.parametrize(
    "name",
    [
        "investment-2026-11-05-143015.db",
        "investment-1999-01-01-000000.db",
    ],
)
def test_only_the_exact_app_name_counts_as_an_app_copy(name):
    assert domain.is_app_copy(name)


@pytest.mark.parametrize(
    "name",
    [
        "investment.db",
        "investment-2026-11-05-143015.db.bak",
        "investment-2026-11-05-143015.db.tmp",
        "x-investment-2026-11-05-143015.db",
        "investment-2026-11-05-143015.DB",
        "investment-20261105-143015.db",
        "investment-2026-11-05-14301.db",
        "investment-2026-11-05-143015-antes-de-apagar.db",
        "investment-2026-11-05-143015.db\n",
        "Investment-2026-11-05-143015.db",
        # Dígitos de outros alfabetos (árabe-índicos, devanágari, largura total) não são do app.
        "investment-٢٠٢٦-١١-٠٥-١٤٣٠١٥.db",
        "investment-२०२६-११-०५-१४३०१५.db",
        "investment-２０２６-１１-０５-１４３０１５.db",
        "ferias.jpg",
    ],
)
def test_other_files_never_look_like_an_app_copy(name):
    assert not domain.is_app_copy(name)


def test_retention_keeps_the_ten_newest_and_ignores_other_names():
    names = [f"investment-2026-10-{day:02d}-120000.db" for day in range(1, 13)]
    names += ["investment.db", "investment-2026-10-01-120000.db.bak", "foto.png"]

    assert domain.copies_to_delete(names) == [
        "investment-2026-10-02-120000.db",
        "investment-2026-10-01-120000.db",
    ]
    assert domain.copies_to_delete(names[:10]) == []


def test_retention_never_deletes_the_copy_just_written_even_with_a_wrong_clock():
    names = [f"investment-2026-10-{day:02d}-120000.db" for day in range(10, 21)]
    oldest = "investment-2026-01-01-000000.db"

    doomed = domain.copies_to_delete([*names, oldest], protect=oldest)

    assert oldest not in doomed
    # Em vez dela, saem as duas mais velhas entre as demais.
    assert doomed == ["investment-2026-10-11-120000.db", "investment-2026-10-10-120000.db"]


@pytest.mark.parametrize(
    ("days", "stale"), [(0, False), (1, False), (6, False), (7, False), (8, True), (30, True)]
)
def test_a_copy_is_stale_only_after_seven_days(days, stale):
    last = NOW - timedelta(days=days)
    assert domain.days_since(last, NOW) == days
    assert domain.is_stale(last, NOW) is stale


def test_without_any_copy_it_is_stale_and_has_no_day_count():
    assert domain.days_since(None, NOW) is None
    assert domain.is_stale(None, NOW) is True


def test_days_use_the_calendar_and_never_go_negative():
    # 23h depois, mas já é outro dia: conta 1 dia.
    assert domain.days_since(datetime(2026, 11, 4, 23, 59), datetime(2026, 11, 5, 0, 1)) == 1
    assert domain.days_since(NOW + timedelta(days=3), NOW) == 0  # relógio atrasado


# ---- Configuração da pasta ------------------------------------------------------------------


def test_fresh_database_has_no_folder_and_asks_for_a_first_copy(client, clock):
    body = client.get(URL).json()

    assert body == {
        "folder": None,
        "folder_available": False,
        "same_drive": False,
        "last_copy_at": None,
        "last_copy_file": None,
        "days_since_last_copy": None,
        "stale": True,
    }


def test_reading_the_status_does_not_create_the_row(client, clock):
    client.get(URL)
    # Só ler não grava nada: a linha nasce na primeira escolha de pasta.
    from sqlalchemy import func, select

    from app.core.db import get_session
    from app.features.backup.models import OffsiteBackupSetting

    session = next(client.app.dependency_overrides[get_session]())
    assert session.scalar(select(func.count()).select_from(OffsiteBackupSetting)) == 0


def test_an_existing_folder_is_saved_and_reported_as_available(client, cloud, clock):
    response = client.put(URL, json={"folder": str(cloud)})

    assert response.status_code == 200
    body = response.json()
    assert body["folder"] == str(cloud)
    assert body["folder_available"] is True
    assert body["stale"] is True  # ainda sem cópia
    assert client.get(URL).json() == body
    assert list(cloud.iterdir()) == []  # a prova de escrita não deixa rastro


def test_a_missing_folder_is_created_when_its_parent_exists(client, cloud, clock):
    target = cloud / "Investment Lab"

    response = client.put(URL, json={"folder": str(target)})

    assert response.status_code == 200
    assert target.is_dir()
    assert response.json()["folder"] == str(target)
    assert response.json()["folder_available"] is True


def test_only_one_level_is_created(client, cloud, clock):
    target = cloud / "a" / "b"

    response = client.put(URL, json={"folder": str(target)})

    _error(response, 422, "folder_not_found")
    assert not (cloud / "a").exists()  # nem a mãe que faltava foi criada
    assert client.get(URL).json()["folder"] is None


def test_a_path_with_quotes_from_the_explorer_is_accepted(client, cloud, clock):
    response = client.put(URL, json={"folder": f'  "{cloud}"  '})

    assert response.status_code == 200
    assert response.json()["folder"] == str(cloud)


@pytest.mark.parametrize("raw", ["", "   ", "Nuvem/Backups", "Backups", "..", "./x"])
def test_a_relative_or_empty_path_is_refused(client, clock, raw):
    _error(client.put(URL, json={"folder": raw}), 422, "folder_not_absolute")


def test_a_path_that_is_a_file_is_refused(client, cloud, clock):
    a_file = cloud / "documento.txt"
    a_file.write_text("meu texto")

    _error(client.put(URL, json={"folder": str(a_file)}), 422, "folder_not_writable")

    assert a_file.read_text() == "meu texto"
    assert client.get(URL).json()["folder"] is None


def test_a_folder_that_refuses_writing_is_refused_and_the_new_one_is_removed(
    client, cloud, clock, monkeypatch
):
    monkeypatch.setattr("app.features.backup.service._can_write", lambda folder: False)
    target = cloud / "Somente leitura"

    _error(client.put(URL, json={"folder": str(target)}), 422, "folder_not_writable")

    assert not target.exists()  # a pasta que acabou de ser criada não fica para trás
    assert client.get(URL).json()["folder"] is None


def test_the_write_probe_is_a_real_write_and_is_removed(cloud, monkeypatch):
    from app.features.backup import service

    assert service._can_write(cloud) is True
    assert list(cloud.iterdir()) == []
    assert service._can_write(cloud / "nao-existe") is False


def test_the_app_data_folder_is_refused_and_nothing_is_created_there(
    client, database, clock, tmp_path
):
    inside_db_folder = database.parent / "copias"
    inside_real_data = tmp_path / "realdata" / "copias"
    (tmp_path / "realdata").mkdir()

    for target in (database.parent, inside_db_folder, inside_real_data, tmp_path / "realdata"):
        _error(client.put(URL, json={"folder": str(target)}), 422, "folder_inside_data")

    assert not inside_db_folder.exists()
    assert not inside_real_data.exists()
    assert client.get(URL).json()["folder"] is None


def test_the_parent_of_the_data_folder_is_not_inside_it(client, database, clock, tmp_path):
    outside = tmp_path / "fora"
    outside.mkdir()

    assert client.put(URL, json={"folder": str(outside)}).status_code == 200


def test_the_inside_data_check_sees_through_dots(client, database, clock):
    sneaky = database.parent / ".." / "data" / "copias"

    _error(client.put(URL, json={"folder": str(sneaky)}), 422, "folder_inside_data")


def test_a_refused_folder_keeps_the_previous_one(client, configured, clock, tmp_path):
    _error(client.put(URL, json={"folder": "relativo"}), 422, "folder_not_absolute")

    assert client.get(URL).json()["folder"] == str(configured)


def test_turning_off_clears_the_folder_and_the_last_copy_but_not_the_files(
    client, database, configured, clock
):
    copied = client.post(f"{URL}/copy").json()

    body = client.put(URL, json={"folder": None}).json()

    assert body["folder"] is None
    assert body["folder_available"] is False
    # Sem pasta não há "última cópia": a tela volta a pedir uma primeira.
    assert body["last_copy_file"] is None
    assert body["last_copy_at"] is None
    assert body["days_since_last_copy"] is None
    assert body["stale"] is True
    assert (configured / copied["file"]).exists()  # as cópias já gravadas não são mexidas


def test_choosing_another_folder_forgets_the_last_copy_of_the_old_one(
    client, database, configured, clock, tmp_path
):
    client.post(f"{URL}/copy")
    other = tmp_path / "Pendrive"
    other.mkdir()

    body = client.put(URL, json={"folder": str(other)}).json()

    assert body["folder"] == str(other)
    assert body["last_copy_at"] is None
    assert body["last_copy_file"] is None
    assert body["stale"] is True
    assert client.get(URL).json() == body


def test_saving_the_same_folder_again_keeps_the_last_copy(client, database, configured, clock):
    copied = client.post(f"{URL}/copy").json()
    same_other_way = configured / ".." / configured.name  # o mesmo lugar, escrito de outro jeito

    for raw in (str(configured), str(same_other_way), f'"{configured}"'):
        body = client.put(URL, json={"folder": raw}).json()

        assert body["last_copy_file"] == copied["file"]
        assert body["last_copy_at"] == "2026-11-05T14:30:15"
        assert body["stale"] is False


def test_a_refused_new_folder_keeps_the_last_copy_of_the_current_one(
    client, database, configured, clock
):
    copied = client.post(f"{URL}/copy").json()

    _error(client.put(URL, json={"folder": "relativo"}), 422, "folder_not_absolute")

    body = client.get(URL).json()
    assert body["folder"] == str(configured)
    assert body["last_copy_file"] == copied["file"]


def test_reading_the_status_never_writes_or_deletes_in_the_folder(
    client, database, configured, clock
):
    client.post(f"{URL}/copy")
    (configured / ".oculto").write_bytes(b"x")
    before = sorted(p.name for p in configured.iterdir())
    stamps = {p.name: p.stat().st_mtime_ns for p in configured.iterdir()}

    for _ in range(3):
        assert client.get(URL).json()["folder_available"] is True

    assert sorted(p.name for p in configured.iterdir()) == before
    assert {p.name: p.stat().st_mtime_ns for p in configured.iterdir()} == stamps
    # A pasta em si também não muda (criar/apagar o arquivo de prova mexeria nela).
    assert not any(p.name.startswith(".investment-lab-prova") for p in configured.iterdir())


def test_reading_the_status_does_not_run_the_write_probe(client, configured, clock, monkeypatch):
    def forbidden(folder):
        raise AssertionError("ler o estado não pode gravar na pasta")

    monkeypatch.setattr("app.features.backup.service._can_write", forbidden)

    assert client.get(URL).json()["folder_available"] is True


def test_the_folder_is_required_in_the_body(client, clock):
    assert client.put(URL, json={}).status_code == 422


def test_same_drive_is_reported_from_the_volume_of_each_path(
    client, database, configured, clock, monkeypatch
):
    assert client.get(URL).json()["same_drive"] is True  # tudo no mesmo disco temporário

    monkeypatch.setattr(
        "app.features.backup.service._volume",
        lambda path: "g:" if path == configured.resolve() else "c:",
    )
    assert client.get(URL).json()["same_drive"] is False


def test_same_drive_is_false_when_the_database_is_not_a_file(
    client, configured, clock, monkeypatch
):
    monkeypatch.setattr(
        "app.features.backup.service.get_settings",
        lambda: type("S", (), {"database_url": "sqlite://"})(),
    )

    assert client.get(URL).json()["same_drive"] is False


# ---- Copiar agora ---------------------------------------------------------------------------


def test_copy_without_a_folder_is_a_conflict(client, database, clock):
    _error(client.post(f"{URL}/copy"), 409, "no_folder")


def test_copy_writes_a_consistent_file_that_opens_and_passes_the_check(
    client, database, configured, clock
):
    response = client.post(f"{URL}/copy")

    assert response.status_code == 200, response.text
    body = response.json()
    expected = "investment-2026-11-05-143015.db"
    assert body["file"] == expected
    assert body["copied_at"] == "2026-11-05T14:30:15"
    assert body["kept"] == 1
    copy = configured / expected
    assert body["size_bytes"] == copy.stat().st_size > 0
    with sqlite3.connect(copy) as conn:
        assert conn.execute("pragma integrity_check").fetchall() == [("ok",)]
        assert conn.execute("select name from institution").fetchall() == [("Banco da Cópia",)]
        revision = conn.execute("select version_num from alembic_version").fetchone()[0]
    assert revision == "0018"
    # Só a cópia na pasta: nada de arquivo de trabalho nem de prova.
    assert [p.name for p in configured.iterdir()] == [expected]


def test_copy_leaves_the_database_in_use_untouched(client, database, configured, clock):
    with sqlite3.connect(database) as conn:
        before = list(conn.iterdump())

    client.post(f"{URL}/copy")

    with sqlite3.connect(database) as conn:
        assert list(conn.iterdump()) == before
    assert not list(database.parent.glob("*-journal")) and not list(database.parent.glob("*.tmp"))


def test_copy_records_the_date_and_file_and_clears_the_stale_warning(
    client, database, configured, clock
):
    assert client.get(URL).json()["stale"] is True

    client.post(f"{URL}/copy")

    body = client.get(URL).json()
    assert body["last_copy_file"] == "investment-2026-11-05-143015.db"
    assert body["last_copy_at"] == "2026-11-05T14:30:15"
    assert body["days_since_last_copy"] == 0
    assert body["stale"] is False


@pytest.mark.parametrize(
    ("days", "stale"), [(0, False), (6, False), (7, False), (8, True), (40, True)]
)
def test_status_turns_stale_after_seven_days(client, database, configured, clock, days, stale):
    client.post(f"{URL}/copy")

    clock.set(NOW + timedelta(days=days))
    body = client.get(URL).json()

    assert body["days_since_last_copy"] == days
    assert body["stale"] is stale


def test_a_second_copy_in_another_second_adds_a_second_file(client, database, configured, clock):
    client.post(f"{URL}/copy")
    clock.set(NOW + timedelta(seconds=1))

    body = client.post(f"{URL}/copy").json()

    assert body["kept"] == 2
    assert len(_app_copies(configured)) == 2


def test_retention_keeps_the_ten_newest_and_never_touches_other_files(
    client, database, configured, clock
):
    old = [f"investment-2026-10-{day:02d}-120000.db" for day in range(1, 13)]
    for name in old:
        (configured / name).write_bytes(b"copia antiga")
    others = [
        "investment.db",  # o banco de alguém, na mesma pasta
        "investment-2026-10-01-120000.db.bak",
        "investment-20261001-120000.db",
        "investment-2026-10-01-120000-antes-de-apagar.db",
        "notas.txt",
    ]
    for name in others:
        (configured / name).write_bytes(b"nao mexa")
    (configured / "investment-pasta.db").mkdir()  # nem uma pasta com nome parecido

    body = client.post(f"{URL}/copy").json()

    assert body["kept"] == 10
    kept = _app_copies(configured)
    assert len(kept) == 10
    assert body["file"] in kept
    assert kept[0] == "investment-2026-10-04-120000.db"  # as 3 mais antigas (01, 02, 03) saíram
    assert "investment-2026-10-03-120000.db" not in kept
    for name in others:
        assert (configured / name).read_bytes() == b"nao mexa"
    assert (configured / "investment-pasta.db").is_dir()


def test_retention_keeps_the_new_copy_even_if_the_clock_went_back(
    client, database, configured, clock
):
    for day in range(1, 11):
        (configured / f"investment-2026-12-{day:02d}-120000.db").write_bytes(b"x")

    body = client.post(f"{URL}/copy").json()

    assert (configured / body["file"]).is_file()
    assert body["kept"] == 10
    assert len(_app_copies(configured)) == 10


def test_a_folder_that_vanished_after_the_choice_is_unavailable(
    client, database, configured, clock
):
    client.post(f"{URL}/copy")
    shutil.rmtree(configured)  # pendrive tirado, Drive desconectado

    status = client.get(URL).json()
    assert status["folder_available"] is False
    assert status["folder"] == str(configured)

    _error(client.post(f"{URL}/copy"), 422, "folder_unavailable")

    assert not configured.exists()  # não recriou a pasta em lugar nenhum
    after = client.get(URL).json()
    assert after["last_copy_file"] == "investment-2026-11-05-143015.db"  # a última válida continua


def test_a_failing_cleanup_does_not_turn_a_good_copy_into_an_error(
    client, database, configured, clock, monkeypatch
):
    def broken_cleanup(folder, newest):
        raise PermissionError("a nuvem travou a pasta")

    monkeypatch.setattr("app.features.backup.service._prune", broken_cleanup)

    response = client.post(f"{URL}/copy")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kept"] == 1
    assert (configured / body["file"]).is_file()
    status = client.get(URL).json()  # a data da cópia boa ficou gravada
    assert status["last_copy_file"] == body["file"]
    assert status["last_copy_at"] == "2026-11-05T14:30:15"
    assert status["stale"] is False


def test_a_folder_that_cannot_be_listed_still_records_the_copy(
    client, database, configured, clock, monkeypatch
):
    real_scandir = os.scandir

    def broken_scandir(path="."):
        if os.fspath(path) == str(configured):  # só a pasta da nuvem; o resto do processo segue
            raise PermissionError("sem permissão para listar")
        return real_scandir(path)

    monkeypatch.setattr("app.features.backup.service.os.scandir", broken_scandir)

    response = client.post(f"{URL}/copy")

    assert response.status_code == 200, response.text
    assert client.get(URL).json()["last_copy_file"] == response.json()["file"]


def test_a_failed_copy_writes_nothing_and_keeps_the_last_valid_one(
    client, database, configured, clock, monkeypatch
):
    first = client.post(f"{URL}/copy").json()
    clock.set(NOW + timedelta(days=2))

    def broken_replace(source, destination):
        raise OSError("disco cheio")

    monkeypatch.setattr("app.features.backup.service.os.replace", broken_replace)
    body = _error(client.post(f"{URL}/copy"), 500, "copy_failed")

    assert "Nada foi gravado" in body["detail"]
    assert [p.name for p in configured.iterdir()] == [
        first["file"]
    ]  # sem sobra do arquivo de trabalho
    status = client.get(URL).json()
    assert status["last_copy_file"] == first["file"]
    assert status["last_copy_at"] == "2026-11-05T14:30:15"


def test_a_failed_check_never_becomes_a_copy(client, database, configured, clock, monkeypatch):
    class Cursor(sqlite3.Connection):
        def execute(self, sql, *args):
            if sql == "PRAGMA integrity_check":
                return iter([("*** in database main ***",)])
            return super().execute(sql, *args)

    real_connect = sqlite3.connect
    monkeypatch.setattr(
        "app.features.backup.service.sqlite3.connect",
        lambda *a, **k: real_connect(*a, **{**k, "factory": Cursor}),
    )

    _error(client.post(f"{URL}/copy"), 500, "copy_failed")

    assert list(configured.iterdir()) == []
    assert client.get(URL).json()["last_copy_file"] is None


def test_a_missing_database_file_fails_cleanly(client, configured, clock):
    # Sem o fixture `database`, o arquivo do banco em uso não existe.
    _error(client.post(f"{URL}/copy"), 500, "copy_failed")

    assert list(configured.iterdir()) == []


def test_a_leftover_work_file_from_a_dead_copy_is_replaced(client, database, configured, clock):
    (configured / ".investment-lab-copia.tmp").write_bytes(b"lixo de uma copia interrompida")

    assert client.post(f"{URL}/copy").status_code == 200

    assert not (configured / ".investment-lab-copia.tmp").exists()


# ---- Proteção das gravações -----------------------------------------------------------------


def test_writes_without_the_app_header_are_refused_and_change_nothing(
    client, database, configured, clock, cloud
):
    client.headers.pop(APP_HEADER)

    put = client.put(URL, json={"folder": None})
    post = client.post(f"{URL}/copy")

    assert put.status_code == post.status_code == 403
    assert list(cloud.iterdir()) == []
    client.headers[APP_HEADER] = "1"
    assert client.get(URL).json()["folder"] == str(configured)


def test_reading_the_status_does_not_need_the_header(client, clock):
    client.headers.pop(APP_HEADER)
    assert client.get(URL).status_code == 200


# ---- Restaurar e reiniciar ------------------------------------------------------------------


def test_the_setting_is_not_part_of_the_json_backup(client, configured, clock):
    exported = client.get("/api/v1/backup/export").json()

    assert "offsite_backup_setting" not in exported["tables"]
    inspection = client.post("/api/v1/backup/inspect", json=exported).json()
    assert inspection["valid"] is True
    assert "offsite_backup_setting" not in inspection["counts"]


def test_a_backup_cannot_carry_the_setting_in(client, configured, clock):
    exported = client.get("/api/v1/backup/export").json()
    exported["tables"]["offsite_backup_setting"] = [{"id": 1, "folder": "C:/outra/pasta"}]

    inspection = client.post("/api/v1/backup/inspect", json=exported).json()

    assert inspection["valid"] is False
    assert any("offsite_backup_setting" in p for p in inspection["problems"])


def test_restoring_a_backup_keeps_the_chosen_folder_and_the_last_copy(
    client, database, configured, clock
):
    copied = client.post(f"{URL}/copy").json()
    exported = client.get("/api/v1/backup/export").json()

    response = client.post("/api/v1/backup/restore", json={"backup": exported, "confirm": True})

    assert response.status_code == 200, response.text
    body = client.get(URL).json()
    assert body["folder"] == str(configured)
    assert body["last_copy_file"] == copied["file"]
    assert body["folder_available"] is True


def test_resetting_the_data_keeps_the_chosen_folder_and_the_last_copy(
    client, database, configured, clock
):
    copied = client.post(f"{URL}/copy").json()

    response = client.post("/api/v1/backup/reset", json={"confirm": "APAGAR"})

    assert response.status_code == 200, response.text
    body = client.get(URL).json()
    assert body["folder"] == str(configured)
    assert body["last_copy_file"] == copied["file"]
