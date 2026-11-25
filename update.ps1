# One-click update: commit + push (this updates the phone page) + new version tag (this builds the laptop update)
# + waits until the phone page on GitHub Pages is really the new one.
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
Set-Location -LiteralPath $PSScriptRoot

function Git {
  & git @args
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed" }
}

try {
  if (-not (Test-Path .git)) { throw 'This folder is not a git folder. Put update.bat inside the crockery-pos folder.' }
  $remote = (& git remote get-url origin 2>$null)
  if ($remote -notmatch 'github\.com[:/]([^/]+)/([^/]+?)(\.git)?$') { throw "Cannot read the GitHub address from: $remote" }
  $owner = $Matches[1]; $repo = $Matches[2]
  $pages = "https://$($owner.ToLower()).github.io/$repo"

  Write-Host ''
  Write-Host '=== Crockery Store Manager - update ===' -ForegroundColor Cyan
  $note = Read-Host 'What changed? (short note, e.g. gaz unit)  [Enter = update]'
  if ([string]::IsNullOrWhiteSpace($note)) { $note = 'update' }

  try { & git fetch --tags 2>$null | Out-Null } catch { }
  $best = $null
  foreach ($t in (& git tag --list 'v*')) {
    if ($t -match '^v(\d+)\.(\d+)\.(\d+)$') {
      $v = [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
      if (-not $best -or $v -gt $best) { $best = $v }
    }
  }
  if ($best) { $tag = "v$($best.Major).$($best.Minor).$($best.Build + 1)" } else { $tag = 'v1.0.1' }
  $branch = (& git rev-parse --abbrev-ref HEAD).Trim()

  Write-Host ''
  Write-Host "  Branch : $branch"
  Write-Host "  New tag: $tag   (last used: v$best)"
  Write-Host "  Note   : $note"
  Write-Host ''
  Read-Host 'Press Enter to start (close this window to cancel)' | Out-Null

  Git add .
  & git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { Git commit -m "$tag $note" } else { Write-Host 'Nothing new to commit (files are already saved).' }
  Git push origin $branch
  Git tag $tag
  Git push origin $tag
  Write-Host ''
  Write-Host "Pushed. Laptop update $tag is being built:" -ForegroundColor Green
  Write-Host "  https://github.com/$owner/$repo/actions"

  # ---- is the phone page really new?
  $want = $null
  if (Test-Path 'docs/sw.js') { $m = Select-String -Path 'docs/sw.js' -Pattern "VERSION = '([^']+)'" | Select-Object -First 1; if ($m) { $want = $m.Matches[0].Groups[1].Value } }
  if ($want) {
    Write-Host ''
    Write-Host "Waiting for the phone page ($want) to appear on GitHub Pages (up to 4 minutes)..."
    $ok = $false
    for ($i = 0; $i -lt 16; $i++) {
      try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$pages/sw.js?x=$([guid]::NewGuid())" -TimeoutSec 20
        if ($r.Content -match "VERSION = '$([regex]::Escape($want))'") { $ok = $true; break }
      } catch { }
      Start-Sleep -Seconds 15
    }
    if ($ok) { Write-Host "PHONE PAGE IS NEW ($want). On the phone: menu, then 'Get the newest page'." -ForegroundColor Green }
    else { Write-Host "The phone page is not new yet. Wait a few minutes, then open $pages/sw.js and look for $want. If it never changes, check the Actions tab: 'pages build and deployment'." -ForegroundColor Yellow }
  }
} catch {
  Write-Host ''
  Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ''
Read-Host 'Press Enter to close'
