"""Proteção da API local contra outros sites abertos no mesmo navegador.

O app não tem login: quem alcança a API grava na carteira. Duas travas fecham o caminho de um
site qualquer:

- **Host:** só o endereço do próprio computador. Barra o "DNS rebinding", em que um site
  reaponta o próprio nome para 127.0.0.1 e passa a ler a API como se fosse da mesma origem.
- **Cabeçalho do app em toda gravação:** um site de fora não consegue mandar um cabeçalho
  próprio sem antes passar pelo CORS, que só libera as origens do front em desenvolvimento.
"""

from starlette.requests import Request
from starlette.responses import JSONResponse

APP_HEADER = "X-Investment-Lab"
APP_HEADER_VALUE = "1"
_READ_ONLY_METHODS = {"GET", "HEAD", "OPTIONS"}


def _hostname(host_header: str) -> str:
    """O nome do Host sem a porta; "[::1]:8000" fica "[::1]"."""
    if host_header.startswith("["):
        return host_header[: host_header.find("]") + 1]
    return host_header.split(":")[0]


def add_local_protection(app, allowed_hosts: tuple[str, ...]) -> None:
    allowed = {host.lower() for host in allowed_hosts}

    @app.middleware("http")
    async def protect_local_api(request: Request, call_next):
        # Lista vazia recusa tudo (nunca vira "aceita qualquer um").
        if _hostname(request.headers.get("host", "")).lower() not in allowed:
            return JSONResponse(
                status_code=400,
                content={
                    "detail": "Endereço não permitido. Abra o app por http://localhost:8000 "
                    "(ou 127.0.0.1)."
                },
            )
        is_api_write = (
            request.url.path.startswith("/api/") and request.method not in _READ_ONLY_METHODS
        )
        if is_api_write and request.headers.get(APP_HEADER) != APP_HEADER_VALUE:
            return JSONResponse(
                status_code=403,
                content={"detail": "Pedido recusado: ele não veio da tela do Investment Lab."},
            )
        return await call_next(request)
