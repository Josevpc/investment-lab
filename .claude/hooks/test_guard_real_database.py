"""Testes do hook que protege o banco real. Rode: python -m pytest .claude/hooks"""

import json
import os
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).with_name("guard_real_database.py")


ROOT = Path(__file__).resolve().parents[2]


def run(tool: str, **tool_input) -> subprocess.CompletedProcess:
    event = json.dumps({"tool_name": tool, "tool_input": tool_input, "cwd": str(ROOT)})
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(ROOT)}
    return subprocess.run(
        [sys.executable, "-I", str(HOOK)],
        input=event,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )


def blocked(result: subprocess.CompletedProcess) -> bool:
    return result.returncode == 2 and "Bloqueado" in result.stderr


def test_blocks_writing_the_real_database_and_data_folder():
    assert blocked(run("Write", file_path=str(ROOT / "data" / "investment.db")))
    assert blocked(run("Edit", file_path="data/investment.db"))
    assert blocked(run("Write", file_path="data/backups/investment-x.db"))
    assert blocked(run("Write", file_path=str(ROOT / "data" / "qualquer.txt")))
    assert blocked(run("Write", file_path="backend/../data/outra-coisa.txt"))  # não escapa por ..


def test_allows_the_demo_folder_and_normal_files():
    assert run("Write", file_path="data/demo/investment-demo.db").returncode == 0
    assert run("Edit", file_path="backend/app/main.py").returncode == 0
    # Uma pasta "data" dentro do código não é a pasta de dados do usuário.
    assert run("Write", file_path="frontend/src/data/format.ts").returncode == 0
    assert run("Write", file_path="backend/app/data/seed.py").returncode == 0


def test_blocks_shell_commands_that_change_the_real_database():
    for command in (
        "rm data/investment.db",
        "cp copia.db data/investment.db",
        "python -c \"import sqlite3; sqlite3.connect('data/investment.db').execute('delete from asset')\"",
        "Remove-Item data\\investment.db",
    ):
        assert blocked(run("Bash", command=command)), command


def test_allows_read_only_access_and_listing():
    readonly = "python -I -c \"import sqlite3; sqlite3.connect('file:data/investment.db?mode=ro', uri=True)\""
    assert run("Bash", command=readonly).returncode == 0
    assert run("Bash", command="ls -la data/investment.db").returncode == 0


def test_blocks_launchers_and_servers_that_would_migrate_the_real_database():
    assert blocked(run("Bash", command="./iniciar.bat"))
    assert blocked(run("PowerShell", command=".\\scripts\\desenvolver.ps1"))
    assert blocked(run("Bash", command="python -m uvicorn app.main:app --port 8011"))
    assert blocked(run("Bash", command="alembic upgrade head"))


def test_allows_servers_pointed_at_another_database_and_the_demo():
    assert (
        run(
            "Bash",
            command="INVESTMENT_DATABASE_URL=sqlite:///tmp/x.db python -m uvicorn app.main:app",
        ).returncode
        == 0
    )
    assert run("Bash", command="./demonstracao.bat").returncode == 0
    assert run("Bash", command="python -m pytest -q").returncode == 0


def test_ignores_unrelated_tools_and_broken_input():
    assert run("Read", file_path="data/investment.db").returncode == 0  # ler é permitido
    broken = subprocess.run(
        [sys.executable, "-I", str(HOOK)], input="isso não é json", capture_output=True, text=True, check=False
    )
    assert broken.returncode == 0
