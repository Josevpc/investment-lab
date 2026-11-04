"""Serve a tela compilada (SPA) a partir da própria API, para rodar tudo em um processo só."""

from pathlib import Path, PurePosixPath

from fastapi import FastAPI
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles

# Prefixos que pertencem à API: um caminho inexistente aqui deve ser 404, não a tela.
_API_PREFIXES = ("api/", "docs", "redoc", "openapi.json", "health")


def _should_serve_app(path: str) -> bool:
    """Só rotas "de página" caem na tela: nada da API e nada que pareça um arquivo."""
    # No Windows o Starlette entrega o caminho com barras invertidas.
    normalized = path.replace("\\", "/").lstrip("/")
    if normalized.startswith(_API_PREFIXES):
        return False
    return PurePosixPath(normalized).suffix == ""


class SPAStaticFiles(StaticFiles):
    """Arquivos estáticos com fallback para `index.html`.

    As rotas do React (ex.: /portfolio ao recarregar a página) não existem como arquivo, então
    o servidor devolve a tela e o roteador do front resolve o caminho. Arquivos que faltam
    (ex.: /assets/x.js) continuam sendo 404, para o erro aparecer em vez de ser mascarado.
    """

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or not _should_serve_app(path):
                raise
            return await super().get_response("index.html", scope)


def mount_frontend(app: FastAPI, static_dir: Path | None) -> bool:
    """Monta a tela em "/" se a pasta compilada existir (chamar depois das rotas da API)."""
    if static_dir is None or not (static_dir / "index.html").is_file():
        return False
    app.mount("/", SPAStaticFiles(directory=static_dir, html=True), name="frontend")
    return True
