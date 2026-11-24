$ErrorActionPreference = 'Stop'
$app = Join-Path $PWD 'src-tauri/target/release/seasonfetch.exe'
if (-not (Test-Path -LiteralPath $app)) { throw "Desktop executable not found: $app" }

$webViewRoots = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/EdgeWebView/Application'),
  (Join-Path $env:ProgramFiles 'Microsoft/EdgeWebView/Application'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft/EdgeWebView/Application')
)
$webViewRuntime = $null
foreach ($root in $webViewRoots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  $versionDirectories = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue
  foreach ($versionDirectory in $versionDirectories) {
    if (Test-Path -LiteralPath (Join-Path $versionDirectory.FullName 'msedgewebview2.exe')) {
      $webViewRuntime = $root
      break
    }
  }
  if ($webViewRuntime) { break }
}
if (-not $webViewRuntime) { throw 'Microsoft Edge WebView2 Runtime was not found on the Windows runner.' }
Write-Host "WebView2 runtime found under: $webViewRuntime"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$process = Start-Process -FilePath $app -PassThru
try {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) { throw "SeasonFetch exited during startup with code $($process.ExitCode)." }
    $windowHandle = $process.MainWindowHandle
  } while (-not $windowHandle -and (Get-Date) -lt $deadline)
  if (-not $windowHandle) { throw 'SeasonFetch did not create a Windows application window.' }

  $window = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)
  if ($window.Current.Name -ne 'SeasonFetch') {
    throw "Unexpected desktop window title: '$($window.Current.Name)'"
  }

  $deadline = (Get-Date).AddSeconds(45)
  $accessibleText = ''
  do {
    $elements = $window.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    $names = foreach ($element in $elements) {
      try {
        $name = $element.Current.Name
        if ($name) { $name }
      } catch {
        # Ignore transient UI Automation elements that disappear during a render.
      }
    }
    $accessibleText = $names -join "`n"
    if ($accessibleText.Contains('SeasonFetch') -and $accessibleText.Contains('Native bridge connected')) { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  if (-not $accessibleText.Contains('SeasonFetch')) {
    throw 'The SeasonFetch React interface did not appear in the Windows accessibility tree.'
  }
  if (-not $accessibleText.Contains('Native bridge connected')) {
    throw "The frontend did not receive the native Rust status event. Accessibility text: $accessibleText"
  }

  $searchField = $window.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      'Search a TV series'
    )
  )
  if (-not $searchField) { throw 'The desktop search field was not exposed through Windows UI Automation.' }
  $searchField.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('Derry Girls')
  $searchValuePattern = $searchField.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $inputDeadline = (Get-Date).AddSeconds(5)
  do {
    $searchValue = $searchValuePattern.Current.Value
    if ($searchValue -eq 'Derry Girls') { break }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $inputDeadline)
  if ($searchValue -ne 'Derry Girls') { throw "The controlled search field did not receive the test query. Current value: '$searchValue'" }
  Start-Sleep -Milliseconds 350

  $searchButton = $window.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      'Search'
    )
  )
  if (-not $searchButton) { throw 'The desktop search button was not exposed through Windows UI Automation.' }
  $searchButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()

  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    $elements = $window.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    $names = foreach ($element in $elements) {
      try {
        $name = $element.Current.Name
        if ($name) { $name }
      } catch {
        # Ignore transient UI Automation elements that disappear during a render.
      }
    }
    $accessibleText = $names -join "`n"
    if ($accessibleText.Contains('Matching series') -and $accessibleText.Contains('Derry Girls')) { break }
  } while ((Get-Date) -lt $deadline)

  if (-not $accessibleText.Contains('Matching series') -or -not $accessibleText.Contains('Derry Girls')) {
    throw "A submitted search did not return the live Cinemeta result through the desktop API transport. Accessibility text: $accessibleText"
  }
  Set-Content -Path 'desktop-smoke-ui.txt' -Value $accessibleText -Encoding utf8

  Write-Host 'SeasonFetch UI rendered and exposed through Windows UI Automation.'
  Write-Host 'Native Rust command/event IPC verified from the desktop status indicator.'
  Write-Host 'Submitted Derry Girls search returned a live Cinemeta result through the desktop API transport.'
  Write-Host 'The required WebView2 runtime is installed on this runner.'
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}
