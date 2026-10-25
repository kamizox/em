# start.ps1 — backend + cloudflared tunnel ek command mein.
#
# Chalao:  .\start.ps1
#
# Ye script tunnel ka public URL khud backend ko bata deti hai
# (backend\public-url.txt), is liye tunnel restart hone par bhi
# extension ki settings badalne ki zaroorat nahi — wahan hamesha
# http://localhost:3000 hi rehta hai.
#
# Band karne ke liye: Ctrl+C

$ErrorActionPreference = 'Stop'

$root      = $PSScriptRoot
$backend   = Join-Path $root 'backend'
$urlFile   = Join-Path $backend 'public-url.txt'
$logDir    = Join-Path $root '.run'
$tunnelLog = Join-Path $logDir 'cloudflared.log'
$serverLog = Join-Path $logDir 'server.log'

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "cloudflared nahi mila. Pehle install karo:" -ForegroundColor Red
  Write-Host "  winget install --id Cloudflare.cloudflared"
  exit 1
}

# Purana URL hata do taake agar tunnel na chale to stale URL use na ho
if (Test-Path $urlFile) { Remove-Item $urlFile -Force }

$server  = $null
$tunnel  = $null

try {
  # ---------- 1. backend ----------
  Write-Host "Backend start ho raha hai..." -ForegroundColor Cyan
  $server = Start-Process -FilePath 'node' -ArgumentList 'server.js' `
    -WorkingDirectory $backend -PassThru -NoNewWindow `
    -RedirectStandardOutput $serverLog -RedirectStandardError (Join-Path $logDir 'server.err.log')

  # port sunne ka intezaar
  $up = $false
  foreach ($i in 1..30) {
    Start-Sleep -Milliseconds 400
    try {
      Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 2 | Out-Null
      $up = $true; break
    } catch { }
  }
  if (-not $up) {
    Write-Host "Backend start nahi hua. Log dekho: $serverLog" -ForegroundColor Red
    exit 1
  }
  Write-Host "  Backend chal raha hai -> http://localhost:3000" -ForegroundColor Green

  # ---------- 2. tunnel ----------
  Write-Host "Cloudflare tunnel ban raha hai..." -ForegroundColor Cyan
  if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }
  $tunnel = Start-Process -FilePath 'cloudflared' `
    -ArgumentList 'tunnel', '--url', 'http://localhost:3000' `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput $tunnelLog -RedirectStandardError (Join-Path $logDir 'cloudflared.err.log')

  # cloudflared URL stderr par likhta hai — dono logs se dhoondo
  $public = $null
  foreach ($i in 1..60) {
    Start-Sleep -Milliseconds 500
    $text = ''
    foreach ($f in @($tunnelLog, (Join-Path $logDir 'cloudflared.err.log'))) {
      if (Test-Path $f) { $text += (Get-Content $f -Raw -ErrorAction SilentlyContinue) }
    }
    $m = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($m.Success) { $public = $m.Value; break }
  }

  if (-not $public) {
    Write-Host "Tunnel URL nahi mila. Log dekho: $tunnelLog" -ForegroundColor Red
    exit 1
  }

  # ---------- 3. URL backend ko batao ----------
  # BOM ke baghair likho — warna URL ke shuru mein invisible byte aa jata hai
  [System.IO.File]::WriteAllText($urlFile, $public, (New-Object System.Text.UTF8Encoding($false)))

  Write-Host ''
  Write-Host '  ===========================================================' -ForegroundColor Green
  Write-Host "  Public URL : $public" -ForegroundColor Green
  Write-Host "  Dashboard  : http://localhost:3000/dashboard" -ForegroundColor Green
  Write-Host '  ===========================================================' -ForegroundColor Green
  Write-Host ''
  Write-Host '  Extension options mein sirf http://localhost:3000 rakho —' -ForegroundColor Yellow
  Write-Host '  public URL ab khud-ba-khud uthaya jayega.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Band karne ke liye Ctrl+C dabao.' -ForegroundColor DarkGray

  # dono processes ke khatam hone tak rukay raho
  while ($true) {
    Start-Sleep -Seconds 2
    if ($server.HasExited) { Write-Host 'Backend band ho gaya.' -ForegroundColor Red; break }
    if ($tunnel.HasExited) { Write-Host 'Tunnel band ho gaya.' -ForegroundColor Red; break }
  }
}
finally {
  Write-Host 'Safai ho rahi hai...' -ForegroundColor DarkGray
  if (Test-Path $urlFile) { Remove-Item $urlFile -Force -ErrorAction SilentlyContinue }
  foreach ($p in @($tunnel, $server)) {
    if ($p -and -not $p.HasExited) {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
