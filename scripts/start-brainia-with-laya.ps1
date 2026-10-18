$root = Split-Path -Parent $PSScriptRoot
$settings = Join-Path $root '.env.laya.local'
if (!(Test-Path -LiteralPath $settings)) { throw "Create .env.laya.local from .env.laya.example first." }
@((Join-Path $root '.env.local'), $settings) | ForEach-Object {
  if (!(Test-Path -LiteralPath $_)) { return }
  Get-Content -LiteralPath $_ | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      Set-Item -Path "Env:$($matches[1])" -Value $matches[2].Trim().Trim([char]34).Trim([char]39)
    }
  }
}
& npm run dev
