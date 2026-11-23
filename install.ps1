# Installe OpenJarvis sous Windows natif puis applique la configuration de ce dépôt.
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = 'Stop'
$Model = 'qwen3.5:4b'

Write-Host '==> 1/3 Installation d''OpenJarvis (uv, Python, Ollama, modele de depart)...'
Invoke-RestMethod https://open-jarvis.github.io/OpenJarvis/install.ps1 | Invoke-Expression

Write-Host '==> 2/3 Application de la configuration (config\config.toml)...'
$OjHome = if ($env:OPENJARVIS_HOME) { $env:OPENJARVIS_HOME } else { Join-Path $HOME '.openjarvis' }
New-Item -ItemType Directory -Force -Path $OjHome | Out-Null
$Target = Join-Path $OjHome 'config.toml'
if (Test-Path $Target) {
    $Backup = "$Target.bak.$(Get-Date -Format yyyyMMdd-HHmmss)"
    Copy-Item $Target $Backup
    Write-Host "    Ancienne configuration sauvegardee : $Backup"
}
Copy-Item (Join-Path $PSScriptRoot 'config\config.toml') $Target -Force

Write-Host "==> 3/3 Telechargement du modele $Model..."
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    ollama pull $Model
} else {
    Write-Host "    Ollama introuvable ; ouvre un nouveau terminal puis : ollama pull $Model"
}

Write-Host ''
Write-Host 'OpenJarvis est installe. Ouvre un nouveau terminal puis : jarvis doctor, puis jarvis'
