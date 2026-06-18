# PlanAI Field — launcher icon kaynaklarını üret ve Android'e uygula
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\config.ps1"

if (-not $PLANAI_MOBILE_ROOT) {
  Write-Error "PLANAI_MOBILE_ROOT bulunamadı."
}

$scriptDir = $PSScriptRoot
$mobileRoot = $PLANAI_MOBILE_ROOT

Push-Location $mobileRoot
try {
  if (-not (Test-Path 'node_modules\sharp') -or -not (Test-Path 'node_modules\@capacitor\assets')) {
    Write-Host 'Installing sharp + @capacitor/assets...'
    npm install --no-save sharp @capacitor/assets
  }

  $env:PLANAI_MOBILE_ROOT = $mobileRoot
  node (Join-Path $scriptDir 'generate-android-icons.mjs')

  Write-Host 'Generating Android mipmap assets...'
  npx capacitor-assets generate --android --assetPath ./resources --iconBackgroundColor '#FFFFFF' --splashBackgroundColor '#FFFFFF'

  Write-Host 'Launcher icons updated.'
}
finally {
  Pop-Location
}
