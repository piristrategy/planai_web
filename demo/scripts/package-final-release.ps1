# PlanAI Field v1.0.0 - final release packaging
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\config.ps1"

$Version = '1.0.0'
$Stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$FinalRoot = Join-Path $PLANAI_FIELD_ROOT "final\PlanAI-Field-v$Version"
$WebSnap = Join-Path $FinalRoot 'web'
$YedekDir = Join-Path $FinalRoot 'yedek'
$AndroidDir = Join-Path $FinalRoot 'android'
$IosDir = Join-Path $FinalRoot 'ios'
$DocsDir = Join-Path $FinalRoot 'docs'

Write-Host "=== PlanAI Field v$Version FINAL packaging ==="
Write-Host "Target: $FinalRoot"

if (Test-Path $FinalRoot) {
  Remove-Item -Recurse -Force $FinalRoot
}
New-Item -ItemType Directory -Path $WebSnap, $YedekDir, $AndroidDir, $IosDir, $DocsDir -Force | Out-Null

cmd /c "robocopy `"$PLANAI_FIELD_ROOT`" `"$WebSnap`" /E /XD final node_modules .git .cursor interaktif-replay\node_modules walk /XF *.zip _cmp_*.js _tpl_*.js /NFL /NDL /NJH /NJS /nc /ns /np" | Out-Null
Write-Host "Web snapshot: $WebSnap"

Copy-Item -Force (Join-Path $PLANAI_FIELD_ROOT 'index.html') (Join-Path $YedekDir 'index.html')
Copy-Item -Force (Join-Path $PLANAI_FIELD_ROOT 'css\app.css') (Join-Path $YedekDir 'app.css')
Copy-Item -Force (Join-Path $PLANAI_FIELD_ROOT 'integrity-manifest.json') (Join-Path $YedekDir 'integrity-manifest.json')
if (Test-Path (Join-Path $PLANAI_FIELD_ROOT 'yedek\index.html')) {
  Copy-Item -Force (Join-Path $PLANAI_FIELD_ROOT 'yedek\index.html') (Join-Path $YedekDir 'index.html.prior')
}
Write-Host "Yedek: $YedekDir"

foreach ($doc in @('RELEASE_HARDENING_v1.0.md', 'DEPLOY_CHECKLIST.md', 'SECURITY.md', 'README.md', 'AGENTS.md')) {
  $src = Join-Path $PLANAI_FIELD_ROOT $doc
  if (Test-Path $src) { Copy-Item -Force $src (Join-Path $DocsDir $doc) }
}

$versionTxt = "PlanAI Field`r`nVersion: $Version`r`nPackaged: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`r`nCanonical: $PLANAI_FIELD_ROOT"
Set-Content -Path (Join-Path $FinalRoot 'VERSION.txt') -Value $versionTxt -Encoding UTF8

Push-Location $PLANAI_FIELD_ROOT
node scripts\verify-integrity-manifest.js 2>&1 | Tee-Object -FilePath (Join-Path $FinalRoot 'integrity-verify.log')
Pop-Location

$apkBuilt = $false
if ($PLANAI_MOBILE_ROOT -and (Test-Path $PLANAI_MOBILE_ROOT)) {
  Write-Host "=== Android build ==="
  try {
    & "$PSScriptRoot\sync-mobile-www.ps1"
    Set-Location $PLANAI_MOBILE_ROOT
    $pkgPath = Join-Path $PLANAI_MOBILE_ROOT 'package.json'
    if (Test-Path $pkgPath) {
      npm run android:debug 2>&1 | Write-Host
      $debugApk = Join-Path $PLANAI_MOBILE_ROOT 'android\app\build\outputs\apk\debug\app-debug.apk'
      if (Test-Path $debugApk) {
        $outApk = Join-Path $AndroidDir "PlanAI-Field-$Version-debug.apk"
        Copy-Item -Force $debugApk $outApk
        $apkBuilt = $true
        Write-Host "APK: $outApk"
      }
    } else {
      Write-Warning "mobile/package.json missing - APK not built"
    }
  } catch {
    Write-Warning "Android build error: $($_.Exception.Message)"
  }
} else {
  Write-Warning "PLANAI_MOBILE_ROOT missing - APK skipped"
}

if (-not $apkBuilt) {
  $relApk = Join-Path $PLANAI_RELEASES_DIR "PlanAI-Field-$Version-debug.apk"
  if (Test-Path $relApk) {
    Copy-Item -Force $relApk (Join-Path $AndroidDir "PlanAI-Field-$Version-debug.apk")
    $apkBuilt = $true
  }
}

$iosReadme = @(
  "PlanAI Field v$Version - iOS (IPA)",
  "",
  "IPA was not built on this machine.",
  "Requires macOS, Xcode, Capacitor iOS project, Apple signing.",
  "",
  "Steps:",
  "1. npm run sync:www in mobile shell",
  "2. npx cap sync ios",
  "3. Xcode Archive and Distribute",
  "4. Copy PlanAI-Field-$Version.ipa to this ios folder"
) -join "`r`n"
Set-Content -Path (Join-Path $IosDir 'README-IPA.txt') -Value $iosReadme -Encoding UTF8

$apkStatus = if ($apkBuilt) { 'OK' } else { 'MISSING - restore mobile shell' }
$manifest = @(
  "PlanAI Field v$Version - FINAL PACKAGE",
  "Generated: $Stamp",
  "",
  "web/       Full web source snapshot",
  "yedek/     index.html, app.css backups",
  "android/   APK (if built)",
  "ios/       IPA instructions",
  "docs/      Security and release notes",
  "",
  "APK status: $apkStatus"
) -join "`r`n"
Set-Content -Path (Join-Path $FinalRoot 'MANIFEST.txt') -Value $manifest -Encoding UTF8

$zipOut = Join-Path $PLANAI_FIELD_ROOT "final\PlanAI-Field-v$Version.zip"
if (Test-Path $zipOut) { Remove-Item -Force $zipOut }
Write-Host "Creating ZIP (may take a few minutes)..."
Compress-Archive -Path $FinalRoot -DestinationPath $zipOut -CompressionLevel Fastest

Write-Host ""
Write-Host "DONE"
Write-Host "Folder: $FinalRoot"
Write-Host "ZIP:    $zipOut"
