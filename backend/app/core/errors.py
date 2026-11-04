from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class DomainError(Exception):
    status_code = 422

    def __init__(self, message: str, **extra: int | str):
        super().__init__(message)
        self.message = message
        # Campos extras de máquina (ex.: `shortfall_cents`) vão ao lado de `detail` no corpo.
        self.extra = extra


class InvalidInputError(DomainError):
    status_code = 422


class NotFoundError(DomainError):
    status_code = 404


class ConflictError(DomainError):
    status_code = 409


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _handle_domain_error(_request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code, content={"detail": exc.message, **exc.extra}
        )
