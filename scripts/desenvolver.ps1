# Modo de desenvolvimento: API com recarga automática (porta 8000) e Vite com hot reload (5173).
# Cada um abre em sua própria janela; feche as janelas para encerrar.
param([switch]$NoBrowser)

. (Join-Path $PSScriptRoot "_comum.ps1")

try {
    if ((Test-PortInUse 8000) -or (Test-PortInUse 5173)) {
        Stop-WithError "As portas 8000 ou 5173 já estão em uso. Feche o Investment Lab em execução antes."
    }

    Initialize-Backend
    if (-not (Test-Npm)) { Stop-WithError "Node.js não encontrado. Instale com: winget install OpenJS.NodeJS.LTS" }
    Initialize-FrontendDependencies

    Write-Step "Abrindo a API (porta 8000) e a tela (porta 5173)"
    Start-Process -FilePath $VenvPython -WorkingDirectory $BackendDir `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"
    Start-Process -FilePath "cmd.exe" -WorkingDirectory $FrontendDir -ArgumentList "/k", "npm run dev"

    if (-not $NoBrowser) {
        Start-Sleep -Seconds 4
        Start-Process "http://localhost:5173"
    }
    Write-Note "Tela com hot reload em http://localhost:5173 (a API responde em http://localhost:8000)."
} catch {
    Write-Host ""
    Write-Host "Erro: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
