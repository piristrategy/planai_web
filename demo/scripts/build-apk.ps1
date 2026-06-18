# D:\planai\field kaynağından debug APK derle ve releases/ altına kopyala
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\config.ps1"

if (-not $PLANAI_MOBILE_ROOT) {
  Write-Error "PLANAI_MOBILE_ROOT bulunamadı. PLANAI_MOBILE_ROOT ortam değişkenini ayarlayın."
}

if (-not $env:ANDROID_HOME -and (Test-Path "$env:LOCALAPPDATA\Android\Sdk")) {
  $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
}

$env:PLANAI_FIELD_ROOT = $PLANAI_FIELD_ROOT
Write-Host "Kaynak (canonical): $PLANAI_FIELD_ROOT"
Write-Host "Mobile shell:       $PLANAI_MOBILE_ROOT"
Write-Host "ANDROID_HOME:       $env:ANDROID_HOME"
Write-Host ""

Set-Location $PLANAI_MOBILE_ROOT
npm run android:debug
if ($LASTEXITCODE -ne 0) {
  Write-Error "Gradle derlemesi başarısız (exit $LASTEXITCODE)."
}

$apk = Join-Path $PLANAI_MOBILE_ROOT 'android\app\build\outputs\apk\debug\app-debug.apk'
$distApk = Join-Path $PLANAI_MOBILE_ROOT 'dist\PlanAI-Field-1.0.0-debug.apk'
$releaseApk = Join-Path $PLANAI_RELEASES_DIR 'PlanAI-Field-1.0.0-debug.apk'

if (-not (Test-Path $apk)) {
  Write-Error "APK bulunamadı: $apk"
}

New-Item -ItemType Directory -Path (Split-Path $distApk -Parent) -Force | Out-Null
New-Item -ItemType Directory -Path $PLANAI_RELEASES_DIR -Force | Out-Null

Copy-Item -Force $apk $distApk
Copy-Item -Force $apk $releaseApk

Write-Host ""
Write-Host "APK hazır:"
Write-Host "  $releaseApk"
Write-Host "  $distApk"
