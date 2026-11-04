# Inicia o Investment Lab em MODO DEMONSTRAÇÃO, com um banco separado e dados fictícios.
#
#   .\scripts\demonstracao.ps1             sobe a demonstração (porta 8001) e abre o navegador
#   .\scripts\demonstracao.ps1 -Reset      apaga só o banco de demonstração e recria os dados de exemplo
#   .\scripts\demonstracao.ps1 -NoBrowser  não abre o navegador
#
# O banco real (data\investment.db) nunca é aberto por este script.
param(
    [int]$Port = 8001,
    [switch]$NoBrowser,
    [switch]$Reset,
    [switch]$Rebuild
)

. (Join-Path $PSScriptRoot "_comum.ps1")

$url = "http://localhost:$Port"
$demoDir = Join-Path $Root "data\demo"
$demoDb = Join-Path $demoDir "investment-demo.db"

try {
    if (Test-PortInUse $Port) {
        if (Test-ServerUp $Port) {
            Write-Step "A demonstração já está rodando em $url"
            if (-not $NoBrowser) { Start-Process $url }
            exit 0
        }
        Stop-WithError "A porta $Port já está em uso por outro programa. Use -Port para escolher outra."
    }

    Initialize-Backend
    Build-Frontend -Force:$Rebuild

    New-Item -ItemType Directory -Force $demoDir | Out-Null
    if ($Reset) {
        # Só mexe em arquivos dentro de data\demo.
        Get-ChildItem $demoDir -Filter "investment-demo.db*" | Remove-Item -Force
        Write-Step "Banco de demonstração recriado"
    }

    # Variáveis só deste processo: apontam para o banco de demonstração.
    $env:INVESTMENT_DATABASE_URL = "sqlite:///" + ($demoDb -replace "\\", "/")
    $env:INVESTMENT_DEMO = "1"
    $env:INVESTMENT_BENCHMARKS_AUTO = "0"

    if (-not $NoBrowser) {
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

    Write-Step "Modo demonstração em $url"
    Write-Note "Dados fictícios em data\demo\investment-demo.db. Seus dados reais não são usados."
    Write-Note "Para encerrar, feche esta janela ou pressione Ctrl+C."
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
