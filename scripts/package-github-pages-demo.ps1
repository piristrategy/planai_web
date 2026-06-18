# PlanAI Field — GitHub Pages demo publish packager
# Copies only runtime-safe assets into demo/ (or -OutputDir).
param(
  [string]$SourceRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'demo'),
  [string]$OutputDir = '',
  [switch]$InPlace
)

$ErrorActionPreference = 'Stop'

$AllowFiles = @(
  'index.html',
  'manifest.json',
  'integrity-manifest.json',
  'LICENSE',
  'NOTICE',
  'README.md'
)

$AllowDirs = @(
  'assets',
  'css',
  'js',
  'libs',
  'mpyy'
)

$ExcludeAlways = @(
  'scripts',
  'yedek',
  'releases',
  'interaktif',
  'interaktif-replay',
  'workers'
)

function Copy-AllowedTree {
  param([string]$Src, [string]$Dst)
  if (-not (Test-Path $Src)) { return }
  New-Item -ItemType Directory -Path $Dst -Force | Out-Null
  Get-ChildItem $Src -Force | ForEach-Object {
    if ($ExcludeAlways -contains $_.Name) { return }
    $target = Join-Path $Dst $_.Name
    if ($_.PSIsContainer) {
      if ($AllowDirs -contains $_.Name -or $Dst -ne $OutputDir) {
        Copy-AllowedTree $_.FullName $target
      }
    } elseif ($AllowFiles -contains $_.Name) {
      Copy-Item -Force $_.FullName $target
    }
  }
}

if ($InPlace) {
  $OutputDir = $SourceRoot
  foreach ($name in $ExcludeAlways) {
    $path = Join-Path $SourceRoot $name
    if (Test-Path $path) { Remove-Item -Recurse -Force $path }
  }
  foreach ($file in @('app.css', 'app.js', 'index - Kopya.html', 'planai-field-app.html', 'AGENTS.md', 'DEPLOY_CHECKLIST.md', 'RELEASE_HARDENING_v1.0.md', 'THREAT_MODEL.md', 'CONTRIBUTING.md', 'SECURITY.md')) {
    $path = Join-Path $SourceRoot $file
    if (Test-Path $path) { Remove-Item -Force $path }
  }
  Write-Host "Pruned unsafe paths from $SourceRoot"
} else {
  if (-not $OutputDir) { $OutputDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'demo-publish' }
  if (Test-Path $OutputDir) { Remove-Item -Recurse -Force $OutputDir }
  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
  foreach ($file in $AllowFiles) {
    $src = Join-Path $SourceRoot $file
    if (Test-Path $src) { Copy-Item -Force $src (Join-Path $OutputDir $file) }
  }
  foreach ($dir in $AllowDirs) {
    $src = Join-Path $SourceRoot $dir
    $dst = Join-Path $OutputDir $dir
    if (Test-Path $src) {
      Copy-Item -Recurse -Force $src $dst
      Write-Host "  + $dir/"
    } else {
      Write-Warning "Missing allowlisted directory: $dir"
    }
  }
  Write-Host "Safe package written to $OutputDir"
}

# Ensure demo index has /demo/ base for GitHub Pages subdirectory
$indexPath = Join-Path $(if ($InPlace) { $SourceRoot } else { $OutputDir }) 'index.html'
if (Test-Path $indexPath) {
  $html = Get-Content $indexPath -Raw
  if ($html -notmatch '<base href="/demo/">') {
    $html = $html -replace '(<meta charset="UTF-8">)', '$1`n<base href="/demo/">'
    Set-Content -Path $indexPath -Value $html -NoNewline
  }
  $preload = @'
<script>
(function () {
  try {
    var x = new XMLHttpRequest();
    x.open('GET', 'interaktif/Field_Journey_17_06_2026_interaktif.html', false);
    x.send(null);
    if ((x.status === 200 || x.status === 0) && x.responseText) {
      window.__PLANAI_REPLAY_TEMPLATE__ = x.responseText;
    }
  } catch (e) {
    console.warn('[FieldReplay] template preload failed', e);
  }
})();
</script>

'@
  $html = Get-Content $indexPath -Raw
  if ($html.Contains($preload)) {
    $html = $html.Replace($preload, '')
    Set-Content -Path $indexPath -Value $html -NoNewline
  }
}

$manifestPath = Join-Path $(if ($InPlace) { $SourceRoot } else { $OutputDir }) 'manifest.json'
if (Test-Path $manifestPath) {
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $manifest.start_url = '/demo/'
  $manifest.scope = '/demo/'
  $manifest | ConvertTo-Json -Depth 5 | Set-Content $manifestPath
}

Write-Host 'Done.'
