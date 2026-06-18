# D:\planai\field → mobile/www (Capacitor web assets)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\config.ps1"

if (-not $PLANAI_MOBILE_ROOT) {
  Write-Error "PLANAI_MOBILE_ROOT bulunamadı. PLANAI_MOBILE_ROOT ortam değişkenini ayarlayın."
}

$env:PLANAI_FIELD_ROOT = $PLANAI_FIELD_ROOT
Write-Host "Kaynak (canonical): $PLANAI_FIELD_ROOT"
Write-Host "Mobile shell:       $PLANAI_MOBILE_ROOT"
Write-Host ""

Set-Location $PLANAI_MOBILE_ROOT
npm run sync:www

Write-Host ""
Write-Host "mobile/www güncellendi."
