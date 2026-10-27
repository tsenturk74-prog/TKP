[CmdletBinding()]
param(
  [switch]$Repair
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Version = '1.1.333'
$RuntimeRevision = 'ascii-light-r16-baseline-selective-tek-fast-start'
$NodeVersion = '18.12.1'
$NodeFolderName = 'node-v18.12.1-win-x64'
$NodeArchiveName = 'node-v18.12.1-win-x64.zip'
$NodeUrl = 'https://nodejs.org/dist/v18.12.1/node-v18.12.1-win-x64.zip'
$NodeSha256 = '5478a5a2dce2803ae22327a9f8ae8494c1dec4a4beca5bbf897027380aecf4c7'
$AppArchiveName = 'TKP_COLLECTOR_APP_1_1_333_R17_LIVE_FIX.tkpr'
$AppSha256 = '5cd88927664520f461e43575e723792322f0b1efe39c803147082bbf0c437f64'
$BundledBackupName = 'TKP_CORE_YEDEK_2026-09-13_165941_R17_BACKFILLED.tkbz'
$BundledBackupSha256 = 'cdac956492729ee80b5a0ceaf451bfe0e0ca953e9ac7c37367991226db9c1ca9'
$PlaywrightVersion = '1.29.2'
$ChromiumRevision = '1041'

$Base = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageRoot = Split-Path -Parent $Base
$BundledBackupPath = Join-Path (Join-Path $PackageRoot 'YEDEKLER') $BundledBackupName
$UiRoot = Join-Path $PackageRoot 'TKP'
$AppArchive = Join-Path $Base $AppArchiveName
$UserBase = $env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($UserBase)) { $UserBase = Join-Path $env:USERPROFILE 'AppData\Local' }
$TkpUserRoot = Join-Path $UserBase 'TKP'
$RuntimeRoot = Join-Path $TkpUserRoot ('Runtime\' + $Version)
$NodeRoot = Join-Path $RuntimeRoot $NodeFolderName
$NodeExe = Join-Path $NodeRoot 'node.exe'
$NpmCmd = Join-Path $NodeRoot 'npm.cmd'
$NodeArchive = Join-Path $RuntimeRoot $NodeArchiveName
$AppRoot = Join-Path $RuntimeRoot 'collector-app'
$AppMarker = Join-Path $AppRoot '.tkp-app-sha256'
$PlaywrightPackage = Join-Path $AppRoot 'node_modules\playwright\package.json'
$PlaywrightCorePackage = Join-Path $AppRoot 'node_modules\playwright-core\package.json'
$BrowsersRoot = Join-Path $RuntimeRoot 'browsers'
$RuntimeMarker = Join-Path $RuntimeRoot 'runtime-smoke.ok'
$LogsRoot = Join-Path $TkpUserRoot 'Logs'
$BrowserSmokeLog = Join-Path $LogsRoot 'browser-smoke.log'
$DataRoot = Join-Path $TkpUserRoot 'TKP_VERILER'
$ProfilesRoot = Join-Path $TkpUserRoot 'BrowserProfiles'
$HealthUrl = 'http://127.0.0.1:3762/health'
$UiUrl = 'http://127.0.0.1:3762/tkp/TKP_CORE_CLAUDE.html?v=' + $Version
$script:NodeRepairDone = $false

function Write-Step([string]$Text) {
  Write-Host ('[TKP] ' + $Text)
}

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      return (($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Download-Verified([string]$Url, [string]$Target, [string]$ExpectedHash) {
  $part = $Target + '.part'
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
    try {
      Write-Step ('Resmi dosya indiriliyor (' + $attempt + '/3)...')
      $client = New-Object System.Net.WebClient
      try {
        $client.Headers.Add('User-Agent', 'TKP-Win81-Bootstrap/1.1.333')
        if ($client.Proxy) { $client.Proxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials }
        $client.DownloadFile($Url, $part)
      } finally {
        $client.Dispose()
      }
      $actual = Get-Sha256 $part
      if ($actual -ne $ExpectedHash) {
        throw ('SHA-256 uyusmadi. Beklenen ' + $ExpectedHash + ', gelen ' + $actual)
      }
      Move-Item -LiteralPath $part -Destination $Target -Force
      return
    } catch {
      Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
      if ($attempt -eq 3) { throw }
      Start-Sleep -Seconds 2
    }
  }
}

function Expand-ZipClean([string]$ZipPath, [string]$Destination) {
  Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue
  $parent = Split-Path -Parent $Destination
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Destination)
}

function Ensure-Node([switch]$NeedNpm) {
  $mustExpand = -not (Test-Path -LiteralPath $NodeExe)
  if ($NeedNpm -and -not (Test-Path -LiteralPath $NpmCmd)) { $mustExpand = $true }
  # R16 baseline: -Repair saglam Node runtime'ini gereksiz yere yeniden acmaz.
  # Eksik runtime zaten $mustExpand ile, bozuk surum ise asagidaki surum kontrolu ile yakalanir.

  if ($mustExpand) {
    if (-not (Test-Path -LiteralPath $NodeArchive) -or (Get-Sha256 $NodeArchive) -ne $NodeSha256) {
      New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
      Download-Verified $NodeUrl $NodeArchive $NodeSha256
    }
    $extractRoot = Join-Path $RuntimeRoot '_node_extract'
    Expand-ZipClean $NodeArchive $extractRoot
    $extracted = Join-Path $extractRoot $NodeFolderName
    if (-not (Test-Path -LiteralPath (Join-Path $extracted 'node.exe'))) {
      throw 'Node arsivi beklenen klasor yapisini icermiyor.'
    }
    Remove-Item -LiteralPath $NodeRoot -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $extracted -Destination $NodeRoot
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    $script:NodeRepairDone = $true
  }

  $process = $null
  try {
    # Native ciktiyi Select-Object -First ile boru hattinda kesmek Windows
    # PowerShell 4/5.1'de dogru surum yazisini alip sureci basarisiz kodla
    # sonlandirabilir. Sureci tamamen bekle ve cikis kodunu dogrudan oku.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $NodeExe
    $startInfo.Arguments = '-p process.versions.node'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'Node.exe sureci baslatilamadi.' }
    $rawVersion = $process.StandardOutput.ReadToEnd()
    $nodeError = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $nodeExitCode = $process.ExitCode
  } catch {
    throw 'Node.exe calistirilamadi. Windows 8.1 guncellemeleri ve Universal C Runtime eksik olabilir.'
  } finally {
    if ($process) { $process.Dispose() }
  }

  $versionText = [regex]::Replace([string]$rawVersion, '\A(?:\s|\uFEFF)+|(?:\s|\uFEFF)+\z', '')
  $versionMatch = [regex]::Match($versionText, '\Av?(?<major>0|[1-9][0-9]*)\.(?<minor>0|[1-9][0-9]*)\.(?<patch>0|[1-9][0-9]*)\z', [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)
  $actualVersion = $versionText
  if ($versionMatch.Success) {
    $actualVersion = $versionMatch.Groups['major'].Value + '.' + $versionMatch.Groups['minor'].Value + '.' + $versionMatch.Groups['patch'].Value
  }
  if ($nodeExitCode -ne 0 -or -not $versionMatch.Success -or ([version]$actualVersion -ne [version]$NodeVersion)) {
    $detail = if ([string]::IsNullOrWhiteSpace($nodeError)) { '' } else { ' Ayrinti: ' + $nodeError.Trim() }
    if ($Repair -and -not $script:NodeRepairDone) {
      Write-Step 'Node runtime dogrulamasi basarisiz; yalniz bozuk runtime yeniden kuruluyor...'
      Remove-Item -LiteralPath $NodeRoot -Recurse -Force -ErrorAction SilentlyContinue
      $script:NodeRepairDone = $true
      if ($NeedNpm) { Ensure-Node -NeedNpm } else { Ensure-Node }
      return
    }
    throw ('Node surumu dogrulanamadi. Beklenen ' + $NodeVersion + ', gelen ' + $actualVersion + ', cikis kodu ' + $nodeExitCode + '.' + $detail)
  }
}

function Ensure-App {
  if (-not (Test-Path -LiteralPath $AppArchive)) { throw ('Eksik paket: ' + $AppArchiveName) }
  $actualAppHash = Get-Sha256 $AppArchive
  if ($actualAppHash -ne $AppSha256) { throw 'Collector uygulama arsivi bozuk veya degistirilmis.' }
  $installedHash = ''
  if (Test-Path -LiteralPath $AppMarker) {
    $installedHash = (Get-Content -LiteralPath $AppMarker -Raw -ErrorAction SilentlyContinue).Trim()
  }
  if ($Repair -or $installedHash -ne $AppSha256 -or -not (Test-Path -LiteralPath (Join-Path $AppRoot 'apps\collector\src\server.js'))) {
    Write-Step 'Collector uygulamasi yerel calisma alanina kuruluyor...'
    Expand-ZipClean $AppArchive $AppRoot
    Set-Content -LiteralPath $AppMarker -Value $AppSha256 -Encoding ASCII
  }
}

function Ensure-Packages {
  $ready = (Test-Path -LiteralPath $PlaywrightPackage) -and (Test-Path -LiteralPath $PlaywrightCorePackage)
  if ($ready) {
    try {
      $pw = Get-Content -LiteralPath $PlaywrightPackage -Raw | ConvertFrom-Json
      $pwc = Get-Content -LiteralPath $PlaywrightCorePackage -Raw | ConvertFrom-Json
      $ready = ([string]$pw.version -eq $PlaywrightVersion -and [string]$pwc.version -eq $PlaywrightVersion)
    } catch { $ready = $false }
  }
  # R16 baseline: KUR_ONAR saglam Playwright kurulumunu yeniden npm install etmez.
  # Gercek tarayici smoke testi Ensure-Browser icinde yine her -Repair calismasinda yapilir.
  if ($ready) { return }

  Ensure-Node -NeedNpm
  Write-Step 'Playwright 1.29.2 kuruluyor...'
  $oldSkip = $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
  $oldCache = $env:npm_config_cache
  $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
  $env:npm_config_cache = Join-Path $RuntimeRoot 'npm-cache'
  $env:npm_config_update_notifier = 'false'
  $env:npm_config_audit = 'false'
  $env:npm_config_fund = 'false'
  try {
    Push-Location $AppRoot
    try {
      & $NpmCmd install --omit=dev --no-audit --no-fund --ignore-scripts --package-lock=false --loglevel=error
      if ($LASTEXITCODE -ne 0) { throw ('npm install hata kodu: ' + $LASTEXITCODE) }
    } finally {
      Pop-Location
    }
  } finally {
    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = $oldSkip
    $env:npm_config_cache = $oldCache
  }

  $pw = Get-Content -LiteralPath $PlaywrightPackage -Raw | ConvertFrom-Json
  $pwc = Get-Content -LiteralPath $PlaywrightCorePackage -Raw | ConvertFrom-Json
  if ([string]$pw.version -ne $PlaywrightVersion -or [string]$pwc.version -ne $PlaywrightVersion) {
    throw 'Playwright surumu 1.29.2 olarak kilitlenemedi.'
  }
  $browserJsonPath = Join-Path $AppRoot 'node_modules\playwright-core\browsers.json'
  $browserJson = Get-Content -LiteralPath $browserJsonPath -Raw | ConvertFrom-Json
  $chromium = $browserJson.browsers | Where-Object { $_.name -eq 'chromium' } | Select-Object -First 1
  if ([string]$chromium.revision -ne $ChromiumRevision) {
    throw ('Beklenmeyen Chromium revision: ' + [string]$chromium.revision)
  }
}

function Find-SystemBrowser {
  # R16.3 / Win8.1: Kullanıcı arayüzü için öncelik Opera'dır.
  # Sıra: 1) açık env override, 2) kurulu Opera, 3) kurulu Chrome/Chromium,
  # 4) paket Playwright Chromium. Opera yoksa Chromium'a güvenli fallback yapılır.
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($env:TKP_BROWSER_PATH -and ([System.IO.Path]::GetFileName($env:TKP_BROWSER_PATH) -ne 'launcher.exe')) { $candidates.Add($env:TKP_BROWSER_PATH) }
  $pf86 = ${env:ProgramFiles(x86)}
  $operaRoots = New-Object System.Collections.Generic.List[string]
  if ($env:LOCALAPPDATA) { $operaRoots.Add((Join-Path $env:LOCALAPPDATA 'Programs\Opera')) }
  if ($env:ProgramFiles) { $operaRoots.Add((Join-Path $env:ProgramFiles 'Opera')) }
  if ($pf86) { $operaRoots.Add((Join-Path $pf86 'Opera')) }
  foreach ($root in $operaRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $versionExecutables = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending | ForEach-Object { Join-Path $_.FullName 'opera.exe' })
    foreach ($operaExe in $versionExecutables) { $candidates.Add($operaExe) }
    $candidates.Add((Join-Path $root 'opera.exe'))
  }
  if ($env:LOCALAPPDATA) {
    $candidates.Add((Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))
    $candidates.Add((Join-Path $env:LOCALAPPDATA 'Chromium\Application\chrome.exe'))
  }
  if ($env:ProgramFiles) { $candidates.Add((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')) }
  if ($pf86) { $candidates.Add((Join-Path $pf86 'Google\Chrome\Application\chrome.exe')) }
  $candidates.Add((Join-Path $BrowsersRoot ('chromium-' + $ChromiumRevision + '\chrome-win\chrome.exe')))
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return [System.IO.Path]::GetFullPath($candidate) }
  }
  return $null
}

function Set-BrowserEnvironment([string]$BrowserPath) {
  if ($BrowserPath) { $env:TKP_BROWSER_PATH = $BrowserPath } else { Remove-Item Env:TKP_BROWSER_PATH -ErrorAction SilentlyContinue }
  if ($BrowserPath -and $BrowserPath -match '(?i)\\Opera\\|\\Programs\\Opera\\') {
    $env:TKP_BROWSER_VENDOR = 'opera'
    $env:TKP_BROWSER_VISIBLE_ONLY = '1'
  } else {
    $env:TKP_BROWSER_VENDOR = 'chromium'
    Remove-Item Env:TKP_BROWSER_VISIBLE_ONLY -ErrorAction SilentlyContinue
  }
}

function Install-PlaywrightChromium {
  Write-Step 'Win8.1 uyumlu Chromium 109 kuruluyor...'
  New-Item -ItemType Directory -Path $BrowsersRoot -Force | Out-Null
  $env:PLAYWRIGHT_BROWSERS_PATH = $BrowsersRoot
  $env:PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT = '120000'
  $cli = Join-Path $AppRoot 'node_modules\playwright\cli.js'
  & $NodeExe $cli install chromium
  if ($LASTEXITCODE -ne 0) { throw ('Chromium kurulum hata kodu: ' + $LASTEXITCODE) }
}

function Get-BrowserSmokeFailureReason {
  if (-not (Test-Path -LiteralPath $BrowserSmokeLog)) { return '(log yok)' }
  $lines = @(Get-Content -LiteralPath $BrowserSmokeLog -ErrorAction SilentlyContinue | Where-Object { $_ -and $_.Trim() -ne '' })
  if (-not $lines -or $lines.Count -eq 0) { return '(log bos)' }
  $tail = ($lines | Select-Object -Last 6) -join ' | '
  return $tail.Substring(0, [Math]::Min(400, $tail.Length))
}

function Test-Browser([string]$BrowserPath) {
  Set-BrowserEnvironment $BrowserPath
  $env:PLAYWRIGHT_BROWSERS_PATH = $BrowsersRoot
  $smoke = Join-Path $AppRoot 'runtime-smoke.cjs'
  Remove-Item -LiteralPath $BrowserSmokeLog -Force -ErrorAction SilentlyContinue
  $browserExitCode = 1
  try {
    & $NodeExe $smoke *> $BrowserSmokeLog
    $browserExitCode = $LASTEXITCODE
  } catch {
    Set-Content -LiteralPath $BrowserSmokeLog -Value $_.Exception.Message -Encoding UTF8
  }
  return ($browserExitCode -eq 0)
}

function Ensure-Browser {
  $browser = Find-SystemBrowser
  $markerText = ''
  if (Test-Path -LiteralPath $RuntimeMarker) { $markerText = Get-Content -LiteralPath $RuntimeMarker -Raw -ErrorAction SilentlyContinue }
  $expectedMarker = $RuntimeRevision + '|' + $AppSha256 + '|' + [string]$browser
  if (-not $Repair -and $browser -and $markerText.Trim() -eq $expectedMarker) {
    Set-BrowserEnvironment $browser
    $env:PLAYWRIGHT_BROWSERS_PATH = $BrowsersRoot
    return $browser
  }

  if ($browser) {
    if (Test-Browser $browser) {
      Set-BrowserEnvironment $browser
      Set-Content -LiteralPath $RuntimeMarker -Value $expectedMarker -Encoding ASCII
      return $browser
    }
    # KÖK ÇÖZÜM (R16.7): Bulunan tarayici (genelde Opera) smoke testinden
    # gecemezse ONCEDEN sessizce pakete gomulu Chromium 109'a dusuluyordu;
    # kullanici "Opera kurulu, neden Chromium aciliyor?" sorusuna hicbir
    # yanit goremiyordu. Simdi gercek hata (browser-smoke.log'un son
    # satirlari) ekrana yaziliyor. En sik gorulen neden: kurulu Opera/Chrome
    # otomatik guncellenip Windows 8.1 destegini artik birakmis surume
    # gecmis olur (Chromium ~110+ Win7/8.1'i desteklemiyor) -- bu paket bu
    # yuzden ozellikle Win8.1 ile uyumlu, sabit Chromium 109 tasiyor.
    $reason = Get-BrowserSmokeFailureReason
    Write-Step ('Bulunan tarayici baslatilamadi: ' + $browser)
    Write-Step ('  Neden (browser-smoke.log): ' + $reason)
    Write-Step '  Not: kurulu Opera/Chrome guncellenip Windows 8.1 destegini birakmis olabilir (Chromium 110+ Win7/8.1de calismaz). Pakete gomulu, Win8.1 ile uyumlu sabit Chromium 109a geciliyor.'
  } else {
    Write-Step 'Sistemde Opera/Chrome bulunamadi (Opera icin bakilan yollar: %LOCALAPPDATA%\Programs\Opera, Program Files\Opera, Program Files (x86)\Opera). Pakete gomulu Chromium 109a geciliyor.'
  }

  Install-PlaywrightChromium
  # Ilk bulunan Opera/Chrome smoke testini gecemediyse Find-SystemBrowser onu
  # yeniden secebilir. Kurulan Playwright Chromium'u burada kesin yoldan dene.
  $browser = Join-Path $BrowsersRoot ('chromium-' + $ChromiumRevision + '\chrome-win\chrome.exe')
  if (-not $browser -or -not (Test-Browser $browser)) {
    throw ('Tarayici motoru kurulamadi veya acilamadi (' + (Get-BrowserSmokeFailureReason) + '). KUR_ONAR.bat dosyasini tekrar calistirin.')
  }
  Set-BrowserEnvironment $browser
  $expectedMarker = $RuntimeRevision + '|' + $AppSha256 + '|' + [string]$browser
  Set-Content -LiteralPath $RuntimeMarker -Value $expectedMarker -Encoding ASCII
  return $browser
}

function Open-TkpUi([string]$BrowserPath) {
  # Win8.1'de varsayilan tarayici IE olabilir. UI modern JS kullandigi icin,
  # dogrulanmis Chrome/Chromium/Opera yolu varsa URL'yi dogrudan onunla ac.
  # Tarayici yedegi kurulamadiysa sistem varsayilani son care olarak kullanilir.
  try {
    if ($BrowserPath -and (Test-Path -LiteralPath $BrowserPath)) {
      Start-Process -FilePath $BrowserPath -ArgumentList @('--new-window', $UiUrl) | Out-Null
      return
    }
  } catch {
    Write-Step ('Dogrulanmis tarayici ile UI acilamadi; varsayilan tarayici deneniyor: ' + $_.Exception.Message)
  }
  Start-Process $UiUrl | Out-Null
}

function Trim-NodeRuntime {
  # npm binlerce kucuk dosya getirir; kurulum bitince yalniz node.exe ve lisans kalir.
  if (-not (Test-Path -LiteralPath $NodeRoot)) { return }
  Get-ChildItem -LiteralPath $NodeRoot -Force | Where-Object {
    $_.Name -ne 'node.exe' -and $_.Name -ne 'LICENSE'
  } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $RuntimeRoot 'npm-cache') -Recurse -Force -ErrorAction SilentlyContinue
}

function Get-Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -Method Get -TimeoutSec 2
    if ($response.StatusCode -ne 200) { return $null }
    return ($response.Content | ConvertFrom-Json)
  } catch { return $null }
}

function Get-PortPids {
  $pids = @()
  $lines = @(netstat -ano -p tcp 2>$null)
  foreach ($line in $lines) {
    $text = [string]$line
    if ($text -match '^\s*TCP\s+[^\s:]+:3762\s+[^\s]+\s+[^\s]+\s+(\d+)\s*$') {
      $pids += [int]$Matches[1]
    }
  }
  return @($pids | Sort-Object -Unique | Where-Object { $_ -gt 0 })
}

function Test-SamePath([string]$Left, [string]$Right) {
  if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
  try {
    $leftFull = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
    $rightFull = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
    return [string]::Equals($leftFull, $rightFull, [System.StringComparison]::OrdinalIgnoreCase)
  } catch { return $false }
}

function Test-MatchingCollector($Health) {
  if (-not $Health -or [string]$Health.service -ne 'tkp-data-collector') { return $false }
  return (
    [string]$Health.version -eq $Version -and
    [string]$Health.runtimeRevision -eq $RuntimeRevision -and
    [string]$Health.appSha256 -eq $AppSha256 -and
    [string]$Health.bundledBackupName -eq $BundledBackupName -and
    [string]$Health.bundledBackupSha256 -eq $BundledBackupSha256 -and
    (Test-SamePath ([string]$Health.bundledBackupPath) $BundledBackupPath) -and
    (Test-SamePath ([string]$Health.uiRoot) $UiRoot) -and
    (Test-SamePath ([string]$Health.dataRoot) $DataRoot)
  )
}

function Prepare-Collector {
  $health = Get-Health
  if ($health -and [string]$health.service -eq 'tkp-data-collector') {
    if (-not $Repair -and (Test-MatchingCollector $health)) { return $true }
    $ownedPids = @(Get-PortPids)
    if ($ownedPids.Count -eq 0) {
      throw 'Eski TKP servisi yanit veriyor ancak islem kimligi bulunamadi; runtime dosyalarina dokunulmadi.'
    }
    foreach ($targetPid in $ownedPids) {
      try { & taskkill.exe /PID $targetPid /T /F | Out-Null } catch { }
    }
    $stopDeadline = (Get-Date).AddSeconds(8)
    do {
      Start-Sleep -Milliseconds 250
      if (@(Get-PortPids).Count -eq 0) { return $false }
    } while ((Get-Date) -lt $stopDeadline)
    throw 'Eski TKP servisi durdurulamadi; runtime dosyalarina dokunulmadi.'
    return $false
  }
  $occupied = @(Get-PortPids)
  if ($occupied.Count -gt 0) {
    throw '3762 portu TKP disinda baska bir program tarafindan kullaniliyor.'
  }
  return $false
}

function Start-Collector {
  $serverScript = Join-Path $AppRoot 'apps\collector\src\server.js'
  $outLog = Join-Path $LogsRoot 'collector-output.log'
  $errLog = Join-Path $LogsRoot 'collector-error.log'
  Remove-Item -LiteralPath $outLog -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $errLog -Force -ErrorAction SilentlyContinue

  $env:TKP_UI_ROOT = $UiRoot
  $env:TKP_DATA_DIR = $DataRoot
  $env:TKP_BROWSER_PROFILE_DIR = $ProfilesRoot
  $env:TKP_RUNTIME_REVISION = $RuntimeRevision
  $env:TKP_APP_SHA256 = $AppSha256
  $env:TKP_BUNDLED_BACKUP_PATH = $BundledBackupPath
  $env:TKP_BUNDLED_BACKUP_NAME = $BundledBackupName
  $env:TKP_BUNDLED_BACKUP_SHA256 = $BundledBackupSha256
  $env:PLAYWRIGHT_BROWSERS_PATH = $BrowsersRoot
  $serverArg = '"' + $serverScript + '"'
  Start-Process -FilePath $NodeExe -ArgumentList $serverArg -WorkingDirectory $AppRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null

  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 400
    $health = Get-Health
    if (Test-MatchingCollector $health) { return }
  } while ((Get-Date) -lt $deadline)

  Write-Host ''
  Write-Host 'Collector baslatilamadi. Son hata kaydi:'
  if (Test-Path -LiteralPath $errLog) { Get-Content -LiteralPath $errLog | Select-Object -Last 40 | Write-Host }
  throw ('Servis saglik kontrolu gecmedi. Log: ' + $errLog)
}

function Start-R17SidecarIfReady {
  # R17 optionaldir: Model/Python yoksa ana TKP akisini ASLA durdurma.
  $r17Root = Join-Path $PackageRoot 'R17_MODEL'
  $r17Model = Join-Path $r17Root 'autogluon_model'
  $r17Report = Join-Path $r17Root 'r17_training_report.json'
  $r17Service = Join-Path (Join-Path $PackageRoot 'DOGRULAMA\tools') 'tkp_r17_service.py'
  $r17Python = Join-Path $TkpUserRoot 'R17Python\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $r17Python) -or -not (Test-Path -LiteralPath $r17Model) -or -not (Test-Path -LiteralPath $r17Service)) { return }
  try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3763/health' -Method Get -TimeoutSec 1
    if ($health.StatusCode -eq 200) { return }
  } catch { }
  $occupied = $false
  foreach ($line in @(netstat -ano -p tcp 2>$null)) {
    if ([string]$line -match '^\s*TCP\s+[^\s:]+:3763\s+') { $occupied = $true; break }
  }
  if ($occupied) { Write-Step 'R17 sidecar 3763 portu dolu; R16.94 ile devam ediliyor.'; return }
  $outLog = Join-Path $LogsRoot 'r17-sidecar-output.log'
  $errLog = Join-Path $LogsRoot 'r17-sidecar-error.log'
  $args = '"' + $r17Service + '" --host 127.0.0.1 --port 3763 --model-dir "' + $r17Model + '" --report "' + $r17Report + '"'
  try {
    Start-Process -FilePath $r17Python -ArgumentList $args -WorkingDirectory $PackageRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
    Write-Step 'R17 AutoGluon sidecar arka planda baslatildi.'
  } catch {
    Write-Step ('R17 sidecar baslatilamadi; R16.94 ile devam ediliyor: ' + $_.Exception.Message)
  }
}


function Start-R18SidecarIfReady {
  # R18.1 optional shadow sidecar: model/Python yoksa Champion akisini ASLA durdurma.
  $r18Root = Join-Path $PackageRoot 'R18_MODEL'
  $r18Model = Join-Path $r18Root 'r18_model.joblib'
  $r18Report = Join-Path $r18Root 'r18_training_report.json'
  $r18Service = Join-Path $r18Root 'tkp_r18_service.py'
  $r18Python = Join-Path $TkpUserRoot 'R17Python\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $r18Python) -or -not (Test-Path -LiteralPath $r18Model) -or -not (Test-Path -LiteralPath $r18Report) -or -not (Test-Path -LiteralPath $r18Service)) { return }
  try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3764/health' -Method Get -TimeoutSec 1
    if ($health.StatusCode -eq 200) { return }
  } catch { }
  $occupied = $false
  foreach ($line in @(netstat -ano -p tcp 2>$null)) {
    if ([string]$line -match '^\s*TCP\s+[^\s:]+:3764\s+') { $occupied = $true; break }
  }
  if ($occupied) { Write-Step 'R18 sidecar 3764 portu dolu; Champion ile devam ediliyor.'; return }
  $outLog = Join-Path $LogsRoot 'r18-sidecar-output.log'
  $errLog = Join-Path $LogsRoot 'r18-sidecar-error.log'
  $args = '"' + $r18Service + '" --host 127.0.0.1 --port 3764 --model "' + $r18Model + '" --report "' + $r18Report + '" --simulations 10000'
  try {
    Start-Process -FilePath $r18Python -ArgumentList $args -WorkingDirectory $PackageRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
    Write-Step 'R18.1 analytics sidecar shadow modda baslatildi.'
  } catch {
    Write-Step ('R18 sidecar baslatilamadi; Champion ile devam ediliyor: ' + $_.Exception.Message)
  }
}

$mutex = New-Object System.Threading.Mutex($false, 'Local\TKP_COLLECTOR_BOOTSTRAP_1_1_333')
$locked = $false
try {
  $locked = $mutex.WaitOne(60000)
  if (-not $locked) { throw 'Baska bir TKP kurulum/baslatma islemi hala calisiyor.' }

  try { [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12 } catch { }
  New-Item -ItemType Directory -Path $RuntimeRoot, $LogsRoot, $DataRoot, $ProfilesRoot -Force | Out-Null

  Write-Step ('Veri Toplayici V' + $Version + ' kontrol ediliyor...')
  $reuseCollector = Prepare-Collector
  if ($reuseCollector) {
    Write-Step 'Ayni runtime servisi zaten hazir. TKP aciliyor...'
    Start-R17SidecarIfReady
    Start-R18SidecarIfReady
    Open-TkpUi (Find-SystemBrowser)
    exit 0
  }
  Ensure-App
  Ensure-Node
  $browser = $null
  try {
    Ensure-Packages
    $browser = Ensure-Browser
  } catch {
    # Tarayici yalniz HTML/PDF/giris yedegidir. GC, TJK, Misli ve
    # Hipodrom dogrudan HTTP/JSON yollarinin calismasini engellememelidir.
    $browser = $null
    Remove-Item -LiteralPath $RuntimeMarker -Force -ErrorAction SilentlyContinue
    Remove-Item Env:TKP_BROWSER_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:TKP_BROWSER_VENDOR -ErrorAction SilentlyContinue
    Remove-Item Env:TKP_BROWSER_VISIBLE_ONLY -ErrorAction SilentlyContinue
    $env:PLAYWRIGHT_BROWSERS_PATH = $BrowsersRoot
    Write-Step ('Tarayici yedegi kullanilamadi: ' + $_.Exception.Message)
  }
  if ($browser) {
    Write-Step ('Tarayici hazir: ' + $browser)
  } else {
    Write-Step ('Dogrudan HTTP/JSON modunda devam ediliyor. Tarayici ayrintisi: ' + $BrowserSmokeLog)
  }
  Trim-NodeRuntime
  Start-Collector
  Start-R17SidecarIfReady
  Start-R18SidecarIfReady
  Write-Step 'Servis hazir. TKP aciliyor...'
  $uiBrowser = if ($browser) { $browser } else { Find-SystemBrowser }
  Open-TkpUi $uiBrowser
  exit 0
} catch {
  Write-Host ''
  Write-Host ('[TKP HATA] ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host ('Log klasoru: ' + $LogsRoot)
  exit 1
} finally {
  if ($locked) { try { $mutex.ReleaseMutex() } catch { } }
  $mutex.Dispose()
}
