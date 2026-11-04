# Funções compartilhadas pelos scripts de inicialização. Não é para ser executado direto.

$ErrorActionPreference = "Stop"

$script:Root = Split-Path -Parent $PSScriptRoot
$script:BackendDir = Join-Path $Root "backend"
$script:FrontendDir = Join-Path $Root "frontend"
$script:VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
$script:DistIndex = Join-Path $FrontendDir "dist\index.html"

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Note([string]$Message) { Write-Host "    $Message" -ForegroundColor DarkGray }
function Stop-WithError([string]$Message) { throw $Message }

# O PATH da sessão pode estar desatualizado se o Node ou o Python foram instalados há pouco.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Test-PythonVersion([string]$Executable) {
    try {
        $ok = & $Executable -c "import sys; print(sys.version_info >= (3, 12))" 2>$null
        return ($ok -eq "True")
    } catch {
        return $false
    }
}

# Procura um Python 3.12+ (o "python" da Microsoft Store, que só abre a loja, não conta).
function Find-Python {
    $candidates = @()
    $programs = Join-Path $env:LOCALAPPDATA "Programs\Python"
    if (Test-Path $programs) {
        $candidates += Get-ChildItem $programs -Directory -Filter "Python3*" |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName "python.exe" }
    }
    foreach ($name in "python", "py") {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command -and $command.Source -notlike "*\WindowsApps\*") { $candidates += $command.Source }
    }
    foreach ($candidate in $candidates) {
        if ((Test-Path $candidate) -and (Test-PythonVersion $candidate)) { return $candidate }
    }
    return $null
}

function Get-TextHash([string[]]$Paths) {
    $parts = foreach ($path in $Paths) {
        if (Test-Path $path) { (Get-FileHash $path -Algorithm SHA256).Hash }
    }
    return ($parts -join "-")
}

# Garante o ambiente virtual do Python e as dependências do back-end (só reinstala se mudaram).
function Initialize-Backend {
    if (-not (Test-Path $VenvPython)) {
        Write-Step "Criando o ambiente Python (primeira execução)"
        $python = Find-Python
        if (-not $python) {
            Update-SessionPath
            $python = Find-Python
        }
        if (-not $python) {
            Stop-WithError "Python 3.12 ou superior não encontrado. Instale com: winget install Python.Python.3.14"
        }
        Write-Note "Usando $python"
        & $python -m venv (Join-Path $BackendDir ".venv")
        if ($LASTEXITCODE -ne 0) { Stop-WithError "Não foi possível criar o ambiente virtual do Python." }
    }

    $stamp = Join-Path $BackendDir ".venv\.deps-stamp"
    $wanted = Get-TextHash @((Join-Path $BackendDir "pyproject.toml"))
    $current = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { "" }
    if ($wanted -ne $current) {
        Write-Step "Instalando as dependências do back-end"
        & $VenvPython -m pip install --quiet --disable-pip-version-check -e $BackendDir
        if ($LASTEXITCODE -ne 0) { Stop-WithError "Falha ao instalar as dependências do back-end." }
        Set-Content -Path $stamp -Value $wanted -Encoding ASCII
    }
}

function Test-FrontendBuildNeeded {
    if (-not (Test-Path $DistIndex)) { return $true }
    $built = (Get-Item $DistIndex).LastWriteTime
    $sources = @(Get-ChildItem (Join-Path $FrontendDir "src") -Recurse -File)
    foreach ($name in "package.json", "index.html", "vite.config.ts", "tsconfig.json") {
        $path = Join-Path $FrontendDir $name
        if (Test-Path $path) { $sources += Get-Item $path }
    }
    $newest = ($sources | Measure-Object -Property LastWriteTime -Maximum).Maximum
    return ($newest -gt $built)
}

function Initialize-FrontendDependencies {
    $modules = Join-Path $FrontendDir "node_modules"
    $stamp = Join-Path $modules ".deps-stamp"
    $wanted = Get-TextHash @((Join-Path $FrontendDir "package.json"), (Join-Path $FrontendDir "package-lock.json"))
    $current = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { "" }
    if (-not (Test-Path $modules) -or $wanted -ne $current) {
        Write-Step "Instalando as dependências do front-end (pode levar alguns minutos)"
        Push-Location $FrontendDir
        try { & npm install --no-audit --no-fund } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { Stop-WithError "Falha ao instalar as dependências do front-end." }
        Set-Content -Path $stamp -Value $wanted -Encoding ASCII
    }
}

function Test-Npm {
    if (Get-Command npm -ErrorAction SilentlyContinue) { return $true }
    Update-SessionPath
    return [bool](Get-Command npm -ErrorAction SilentlyContinue)
}

# Compila a tela (npm run build) quando ela não existe ou os arquivos-fonte são mais novos.
function Build-Frontend([switch]$Force) {
    if (-not ($Force -or (Test-FrontendBuildNeeded))) { return }
    if (-not (Test-Npm)) {
        if (Test-Path $DistIndex) {
            Write-Warning "Node.js não encontrado; usando a versão já compilada da tela, que pode estar desatualizada."
            return
        }
        Stop-WithError "Node.js não encontrado. Instale com: winget install OpenJS.NodeJS.LTS"
    }
    Initialize-FrontendDependencies
    Write-Step "Compilando a tela"
    Push-Location $FrontendDir
    try { & npm run build } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { Stop-WithError "Falha ao compilar a tela (npm run build)." }
}

function Test-ServerUp([int]$Port) {
    try {
        $response = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
        return ($response.status -eq "ok")
    } catch {
        return $false
    }
}

function Test-PortInUse([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
