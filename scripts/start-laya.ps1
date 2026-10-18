param(
  [ValidateSet('cpu', 'cuda')]
  [string]$Device = 'cpu',
  [int]$Port = 8000
)

$root = Split-Path -Parent $PSScriptRoot
$settings = Join-Path $root '.env.laya.local'
$server = Join-Path $root '.laya-venv\Scripts\laya-serve.exe'
if (!(Test-Path -LiteralPath $settings)) { throw "Create .env.laya.local from .env.laya.example first." }
if (!(Test-Path -LiteralPath $server)) { throw "Laya is not installed. Run the setup command documented in docs/laya-local.md." }

Get-Content -LiteralPath $settings | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { Set-Item -Path "Env:$($matches[1])" -Value $matches[2].Trim() }
}
$env:LAYA_HOST = '127.0.0.1'
$env:LAYA_PORT = "$Port"
$env:LAYA_DEVICE = $Device
$env:LAYA_PRELOAD = '1'
$env:LAYA_MODELS = 'multilingual'
& $server
