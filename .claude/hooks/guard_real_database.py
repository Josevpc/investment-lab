"""Hook PreToolUse: protege o banco real do usuário (data/investment.db).

Lê o JSON do hook na entrada padrão e bloqueia (código de saída 2, motivo no stderr) o que pode
alterar, apagar ou migrar o banco real. Leitura continua liberada, e o trabalho com dados de
verdade passa por cópia (ou pelo modo demonstração).

Teste à mão:
    echo {"tool_name":"Bash","tool_input":{"command":"rm data/investment.db"}} | python guard_real_database.py
"""

import json
import os
import re
import sys
from pathlib import Path

REAL_DB = re.compile(r"investment\.db", re.IGNORECASE)
READ_ONLY_LISTING = re.compile(r"^\s*(ls|dir|stat|Get-ChildItem|Get-Item|file)\b", re.IGNORECASE)
LAUNCHERS = re.compile(r"\b(iniciar|desenvolver)(\.bat|\.ps1)\b", re.IGNORECASE)
SERVERS = re.compile(r"\b(uvicorn|alembic)\b", re.IGNORECASE)

WHY = (
    "O banco data/investment.db é do usuário (dados financeiros reais). "
    "Nunca altere, apague ou migre esse arquivo. Para testar, use uma cópia em um diretório "
    "temporário, o modo demonstração (demonstracao.bat) ou INVESTMENT_DATABASE_URL apontando "
    "para outro arquivo. Para só ler, abra com sqlite3 em modo somente leitura "
    "(file:...?mode=ro)."
)


def deny(message: str) -> None:
    print(f"Bloqueado: {message}\n{WHY}", file=sys.stderr)
    sys.exit(2)


def project_root(event: dict) -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or event.get("cwd") or os.getcwd())


def check_path(path: str, event: dict) -> None:
    if REAL_DB.search(path):
        deny(f"escrita em {path}.")
    if not path:
        return
    root = project_root(event).resolve()
    target = Path(path)
    target = (target if target.is_absolute() else Path(event.get("cwd") or root) / target).resolve()
    data_dir, demo_dir = root / "data", root / "data" / "demo"
    inside_data = data_dir in target.parents
    inside_demo = demo_dir == target or demo_dir in target.parents
    # Tudo na pasta data/ do projeto é do usuário (banco, cópias de segurança), menos a demonstração.
    if inside_data and not inside_demo and target.name != ".gitkeep":
        deny(f"escrita em {path}, dentro de data/ (dados do usuário).")


def check_command(command: str) -> None:
    if REAL_DB.search(command) and "mode=ro" not in command and not READ_ONLY_LISTING.search(command):
        deny("o comando mexe em investment.db sem abrir em modo somente leitura.")
    if LAUNCHERS.search(command):
        deny(
            "iniciar/desenvolver sobem o app no banco real e aplicam migrações nele. "
            "Quem usa o app é o usuário; para ver a tela use demonstracao.bat."
        )
    if SERVERS.search(command) and "INVESTMENT_DATABASE_URL" not in command:
        deny(
            "uvicorn/alembic sem INVESTMENT_DATABASE_URL usam o banco real e migram o arquivo "
            "dele. Defina INVESTMENT_DATABASE_URL para um banco temporário."
        )


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError:
        return  # entrada inesperada: não atrapalha o trabalho
    tool = event.get("tool_name", "")
    args = event.get("tool_input") or {}
    if tool in {"Edit", "Write", "MultiEdit", "NotebookEdit"}:
        check_path(str(args.get("file_path") or args.get("notebook_path") or ""), event)
    elif tool in {"Bash", "PowerShell"}:
        check_command(str(args.get("command") or ""))


if __name__ == "__main__":
    main()
