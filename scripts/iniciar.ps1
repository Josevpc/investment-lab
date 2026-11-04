# Inicia o Investment Lab em um único processo: a API serve também a tela compilada.
#
#   .\scripts\iniciar.ps1                 prepara o que faltar, sobe o servidor e abre o navegador
#   .\scripts\iniciar.ps1 -Rebuild        recompila a tela mesmo que pareça atualizada
#   .\scripts\iniciar.ps1 -NoBrowser      não abre o navegador
#   .\scripts\iniciar.ps1 -Port 9000      usa outra porta
param(
    [int]$Port = 8000,
    [switch]$NoBrowser,
    [switch]$Rebuild
)

. (Join-Path $PSScriptRoot "_comum.ps1")

$url = "http://localhost:$Port"

try {
    if (Test-PortInUse $Port) {
        if (Test-ServerUp $Port) {
            Write-Step "O Investment Lab já está rodando em $url"
            if (-not $NoBrowser) { Start-Process $url }
            exit 0
        }
        Stop-WithError "A porta $Port já está em uso por outro programa. Use -Port para escolher outra."
    }

    Initialize-Backend
    Build-Frontend -Force:$Rebuild

    if (-not $NoBrowser) {
        # Abre o navegador assim que a API responder.
        Start-Job -ArgumentList $url -ScriptBlock {
            param($address)
            for ($i = 0; $i -lt 120; $i++) {
                try {
                    Invoke-RestMethod "$address/health" -TimeoutSec 1 | Out-Null
                    Start-Process $address
                    return
                } catch { Start-Sleep -Milliseconds 500 }
            }
        } | Out-Null
    }

    Write-Step "Investment Lab em $url"
    Write-Note "Para encerrar, feche esta janela ou pressione Ctrl+C."
    Write-Note "O banco de dados fica em data\investment.db (backup automático antes de migrações)."
    Push-Location $BackendDir
    try {
        & $VenvPython -m uvicorn app.main:app --host 127.0.0.1 --port $Port
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    exit $code
} catch {
    Write-Host ""
    Write-Host "Erro: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
