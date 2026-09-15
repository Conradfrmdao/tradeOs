<#
.SYNOPSIS
  Installs the TradeOS agent into every MetaTrader terminal on this machine.

.DESCRIPTION
  Does the fiddly parts of the setup so the only things left are opening the
  terminal and pasting a pairing code:

    - copies the agent and its JSON helper into each terminal's MQL5/MQL4 tree
    - allow-lists the TradeOS API for WebRequest
    - enables automated trading

  The WebRequest allow-list is normally buried in
  Tools > Options > Expert Advisors, and getting it wrong is the single most
  common reason an agent silently fails to connect. Writing it here removes
  that step entirely.

  Run from an ordinary PowerShell prompt. Administrator rights are not needed:
  everything written lives under your own AppData.

.PARAMETER ApiUrl
  The TradeOS API to allow. Defaults to the hosted deployment.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install-windows.ps1
#>

[CmdletBinding()]
param(
  [string] $ApiUrl = 'https://tradeos-one-bice.vercel.app'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($msg) { Write-Host "  $msg" }
function Write-Ok($msg)   { Write-Host "  [ok] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }

Write-Host "`nTradeOS agent installer" -ForegroundColor Cyan
Write-Host "API: $ApiUrl`n"

# A terminal is identified by a data folder containing config\common.ini.
$roots = Join-Path $env:APPDATA 'MetaQuotes\Terminal'
if (-not (Test-Path $roots)) {
  Write-Warn 'No MetaTrader data folders found. Install and run MetaTrader once, then re-run this.'
  exit 1
}

$terminals = Get-ChildItem $roots -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName 'config\common.ini') }

if (-not $terminals) {
  Write-Warn 'No initialised MetaTrader terminals found. Start your terminal once, then re-run this.'
  exit 1
}

$installed = 0

foreach ($t in $terminals) {
  # MQL5 for MetaTrader 5, MQL4 for MetaTrader 4.
  $mql5 = Join-Path $t.FullName 'MQL5'
  $mql4 = Join-Path $t.FullName 'MQL4'

  if (Test-Path $mql5) { $mql = $mql5; $platform = 'MT5'; $ext = 'mq5' }
  elseif (Test-Path $mql4) { $mql = $mql4; $platform = 'MT4'; $ext = 'mq4' }
  else { continue }

  Write-Host "Terminal $($t.Name)  ($platform)" -ForegroundColor White

  $source = Join-Path $here "$($platform.ToLower())\TradeOsAgent.$ext"
  $shared = Join-Path $here 'shared\JsonLite.mqh'

  if (-not (Test-Path $source)) {
    Write-Warn "agent source missing: $source"
    continue
  }

  # --- copy the agent -------------------------------------------------------
  $expertsDir = Join-Path $mql 'Experts'
  $includeDir = Join-Path $mql 'Include\TradeOS'
  New-Item -ItemType Directory -Force -Path $expertsDir, $includeDir | Out-Null

  Copy-Item $source (Join-Path $expertsDir "TradeOsAgent.$ext") -Force
  Copy-Item $shared (Join-Path $includeDir 'JsonLite.mqh') -Force
  Write-Ok "agent copied into $platform"

  # --- allow the API through WebRequest ------------------------------------
  # MetaTrader rewrites common.ini on exit, so this only sticks while the
  # terminal is closed.
  $running = Get-Process terminal64, terminal -ErrorAction SilentlyContinue
  if ($running) {
    Write-Warn 'MetaTrader is running — close it and re-run to apply the WebRequest setting.'
  } else {
    $ini = Join-Path $t.FullName 'config\common.ini'
    $text = Get-Content $ini -Encoding Unicode -Raw

    $host_ = ([uri]$ApiUrl).GetLeftPart([System.UriPartial]::Authority)

    if ($text -notmatch '\[Experts\]') {
      $text += "`r`n[Experts]`r`nAllowLiveTrading=1`r`nAllowDllImport=0`r`nEnabled=1`r`nAccount=0`r`nProfile=0`r`nWebRequest=1`r`nWebRequestUrl1=$host_`r`n"
    } else {
      if ($text -notmatch [regex]::Escape($host_)) {
        # Append as the next free WebRequestUrlN slot.
        $used = ([regex]::Matches($text, 'WebRequestUrl(\d+)=') | ForEach-Object { [int]$_.Groups[1].Value })
        $next = if ($used) { ($used | Measure-Object -Maximum).Maximum + 1 } else { 1 }
        $text = $text -replace '(\[Experts\][^\[]*)', "`$1WebRequestUrl$next=$host_`r`n"
      }
      $text = $text -replace 'WebRequest=0', 'WebRequest=1'
      $text = $text -replace 'AllowLiveTrading=0', 'AllowLiveTrading=1'
    }

    [System.IO.File]::WriteAllText($ini, $text, [System.Text.Encoding]::Unicode)
    Write-Ok "allow-listed $host_ and enabled automated trading"
  }

  $installed++
}

if ($installed -eq 0) {
  Write-Warn 'Nothing installed.'
  exit 1
}

Write-Host "`nInstalled into $installed terminal(s).`n" -ForegroundColor Green
Write-Host "What's left, in the terminal:" -ForegroundColor Cyan
Write-Host "  1. Open it and log in to the trading account you want to connect."
Write-Host "  2. In Navigator, right-click Expert Advisors and choose Refresh,"
Write-Host "     then drag TradeOsAgent onto any chart."
Write-Host "  3. Paste the pairing code from the TradeOS dashboard and press OK."
Write-Host ""
Write-Host "The account should show as Connected within a few seconds.`n"
