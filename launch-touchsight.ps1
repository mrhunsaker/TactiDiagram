# Launch TactiDiagram: .\launch-touchsight.ps1 [desktop|web]
param(
    [Parameter(Position = 0)]
    [ValidateSet('desktop', 'web', '')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

switch ($Mode) {
    'desktop' { $runCmd = 'npm run desktop' }
    'web'     { $runCmd = 'npm run serve' }
    default   {
        Write-Host "Usage: .\launch-touchsight.ps1 [desktop|web]"
        Write-Host "  desktop - run the Neutralino desktop app"
        Write-Host "  web     - start the web server and open the preferred browser"
        exit 1
    }
}

# Debug logging on by default (override with $env:VERBOSE = '0')
if ($env:VERBOSE -ne '0') {
    $env:DEBUG = '*'
    if (-not $env:NODE_OPTIONS) { $env:NODE_OPTIONS = '' }
    $env:NODE_OPTIONS += ' --trace-warnings'
    $InformationPreference = 'Continue'
}

Write-Host '==> Installing dependencies'
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run vendor
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Mode -eq 'web') {
    $port = 5173
    if ($env:PORT) {
        $parsedPort = 0
        if ([int]::TryParse($env:PORT, [ref]$parsedPort) -and $parsedPort -gt 0) {
            $port = $parsedPort
        }
    }
    $url = "http://localhost:$port/"

    Write-Host "==> Starting TactiDiagram web server on $url"
    $server = Start-Process -FilePath 'node' -ArgumentList @('scripts/serve.mjs') -WorkingDirectory $PSScriptRoot -PassThru -NoNewWindow

    try {
        # Wait until the local server accepts connections.
        $ready = $false
        for ($i = 0; $i -lt 60; $i++) {
            if ($server.HasExited) {
                throw 'TactiDiagram web server exited before becoming ready.'
            }
            $client = $null
            try {
                $client = [System.Net.Sockets.TcpClient]::new()
                $connect = $client.BeginConnect('127.0.0.1', $port, $null, $null)
                if ($connect.AsyncWaitHandle.WaitOne(250) -and $client.Connected) {
                    $client.EndConnect($connect)
                    $ready = $true
                    break
                }
            }
            catch {
                # Retry until the startup timeout.
            }
            finally {
                if ($client) { $client.Dispose() }
            }
        }
        if (-not $ready) {
            throw "TactiDiagram web server did not start on port $port."
        }

        # Search PATH and standard install locations in strict priority order.
        $browserCandidates = @(
            [pscustomobject]@{ Name = 'Ungoogled Chromium'; Commands = @('ungoogled-chromium', 'ungoogled_chromium'); Paths = @(
                "$env:ProgramFiles\Ungoogled Chromium\Application\chrome.exe",
                "$env:LOCALAPPDATA\Programs\Ungoogled Chromium\Application\chrome.exe",
                "$env:LOCALAPPDATA\Chromium\Application\chrome.exe"
            ) },
            [pscustomobject]@{ Name = 'Chromium'; Commands = @('chromium', 'chromium-browser'); Paths = @(
                "$env:ProgramFiles\Chromium\Application\chrome.exe",
                "$env:LOCALAPPDATA\Chromium\Application\chrome.exe"
            ) },
            [pscustomobject]@{ Name = 'Microsoft Edge'; Commands = @('msedge', 'msedge.exe'); Paths = @(
                "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
                "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
            ) },
            [pscustomobject]@{ Name = 'Google Chrome'; Commands = @('chrome', 'chrome.exe'); Paths = @(
                "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
                "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
                "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
            ) }
        )

        $launched = $false
        foreach ($candidate in $browserCandidates) {
            $browserPath = $null

            foreach ($commandName in $candidate.Commands) {
                $command = Get-Command $commandName -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($command) {
                    $browserPath = $command.Source
                    break
                }
            }

            if (-not $browserPath) {
                foreach ($path in $candidate.Paths) {
                    if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
                        $browserPath = $path
                        break
                    }
                }
            }

            if ($browserPath) {
                try {
                    Write-Host "==> Opening TactiDiagram with $($candidate.Name)"
                    Start-Process -FilePath $browserPath -ArgumentList $url
                    $launched = $true
                    break
                }
                catch {
                    Write-Warning "Could not start $($candidate.Name): $($_.Exception.Message)"
                }
            }
        }

        if (-not $launched) {
            throw 'No supported browser found. Install Ungoogled Chromium, Chromium, Microsoft Edge, or Google Chrome.'
        }

        # Keep the server alive while the browser is being used.
        Write-Host 'TactiDiagram is running. Press Ctrl+C to stop the web server.'
        Wait-Process -Id $server.Id
    }
    finally {
        if ($server -and -not $server.HasExited) {
            Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
        }
    }
    exit 0
}

Write-Host "==> Starting TactiDiagram ($Mode)"
Invoke-Expression $runCmd
exit $LASTEXITCODE
