# PlanAI Field — canonical path configuration
# Web uygulaması ve dağıtım çıktıları için tek kaynak: D:\planai\field

$script:PLANAI_FIELD_ROOT = 'D:\planai\field'

function Get-ValidMobileRoot([string]$Path) {
  if (-not $Path) { return $null }
  $pkg = Join-Path $Path 'package.json'
  if ((Test-Path -LiteralPath $Path) -and (Test-Path -LiteralPath $pkg)) { return $Path }
  return $null
}

$script:PLANAI_MOBILE_ROOT = $null

if ($env:PLANAI_MOBILE_ROOT) {
  $script:PLANAI_MOBILE_ROOT = Get-ValidMobileRoot $env:PLANAI_MOBILE_ROOT
}

if (-not $script:PLANAI_MOBILE_ROOT) {
  $pathFile = Join-Path $PSScriptRoot 'mobile-root.txt'
  if (Test-Path -LiteralPath $pathFile) {
    $fromFile = [System.IO.File]::ReadAllText($pathFile, [System.Text.Encoding]::UTF8).Trim()
    $script:PLANAI_MOBILE_ROOT = Get-ValidMobileRoot $fromFile
  }
}

if (-not $script:PLANAI_MOBILE_ROOT) {
  $script:PLANAI_MOBILE_ROOT = Get-ValidMobileRoot 'C:\Users\Lenovo\Desktop\planai_field_web\mobile'
}

$script:PLANAI_RELEASES_DIR = Join-Path $script:PLANAI_FIELD_ROOT 'releases'
