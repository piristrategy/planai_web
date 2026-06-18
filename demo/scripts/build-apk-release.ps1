# D:\planai\field — signed release APK + AAB
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\config.ps1"

if (-not $PLANAI_MOBILE_ROOT) {
  Write-Error "PLANAI_MOBILE_ROOT bulunamadı. Capacitor mobile shell gerekli."
}

if (-not $env:ANDROID_HOME -and (Test-Path "$env:LOCALAPPDATA\Android\Sdk")) {
  $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
}

$version = '1.0.0'
$env:PLANAI_FIELD_ROOT = $PLANAI_FIELD_ROOT
Write-Host "Canonical web: $PLANAI_FIELD_ROOT"
Write-Host "Mobile shell:  $PLANAI_MOBILE_ROOT"
Write-Host ""

# Sync www from canonical field
& "$PSScriptRoot\sync-mobile-www.ps1"

Set-Location $PLANAI_MOBILE_ROOT

# Expect package.json scripts: android:release, android:bundle
$pkg = Get-Content (Join-Path $PLANAI_MOBILE_ROOT 'package.json') -Raw | ConvertFrom-Json
if (-not $pkg.scripts.'android:release') {
  Write-Warning "android:release script missing in mobile package.json — see scripts/android/release-buildtype.gradle.snippet"
}

npm run android:release 2>&1 | Write-Host
if ($LASTEXITCODE -ne 0) {
  Write-Error "Release APK build failed. Ensure signing config + R8 enabled in mobile shell."
}

$apk = Join-Path $PLANAI_MOBILE_ROOT 'android\app\build\outputs\apk\release\app-release.apk'
$aab = Join-Path $PLANAI_MOBILE_ROOT 'android\app\build\outputs\bundle\release\app-release.aab'

New-Item -ItemType Directory -Path $PLANAI_RELEASES_DIR -Force | Out-Null

if (Test-Path $apk) {
  $outApk = Join-Path $PLANAI_RELEASES_DIR "PlanAI-Field-$version-release.apk"
  Copy-Item -Force $apk $outApk
  Write-Host "Release APK: $outApk"
} else {
  Write-Warning "Release APK not found: $apk"
}

if ($pkg.scripts.'android:bundle') {
  npm run android:bundle 2>&1 | Write-Host
  if (Test-Path $aab) {
    $outAab = Join-Path $PLANAI_RELEASES_DIR "PlanAI-Field-$version-release.aab"
    Copy-Item -Force $aab $outAab
    Write-Host "Release AAB: $outAab"
  }
}

Write-Host "Done."
