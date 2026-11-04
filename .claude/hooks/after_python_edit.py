"""Hook PostToolUse: confere com o ruff os arquivos Python do back-end que acabaram de ser editados.

Se houver problema, sai com código 2 e devolve a mensagem ao agente (que então corrige). Qualquer
outra falha do próprio hook é ignorada: ele nunca atrapalha o trabalho.
"""

import json
import os
import subprocess
import sys
from pathlib import Path


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError:
        return
    args = event.get("tool_input") or {}
    path = str(args.get("file_path") or "")
    if not path.endswith(".py"):
        return
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or event.get("cwd") or ".").resolve()
    backend = root / "backend"
    target = Path(path)
    target = target if target.is_absolute() else Path(event.get("cwd") or root) / target
    try:
        target = target.resolve()
    except OSError:
        return
    if backend not in target.parents or not target.exists():
        return
    python = backend / ".venv" / "Scripts" / "python.exe"
    if not python.exists():
        python = backend / ".venv" / "bin" / "python"
    if not python.exists():
        return
    try:
        result = subprocess.run(
            [str(python), "-m", "ruff", "check", str(target)],
            capture_output=True,
            text=True,
            cwd=backend,
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return
    if result.returncode != 0:
        print(f"ruff encontrou problemas em {path}:\n{result.stdout}{result.stderr}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
