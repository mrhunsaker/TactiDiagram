# Launch touchsight-NG: .\launch-touchsight.ps1 [desktop|web]
param(
    [Parameter(Position = 0)]
    [ValidateSet('desktop', 'web', '')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

switch ($Mode) {
    'desktop' { $runCmd = 'npm run desktop' }
    'web'     { $runCmd = 'npm run serve'   }
    default   {
        Write-Host "Usage: .\launch-touchsight.ps1 [desktop|web]"
        Write-Host "  desktop - run the Neutralino desktop app"
        Write-Host "  web     - run the dev web server"
        exit 1
    }
}

# Debug logging on by default (override with $env:VERBOSE = '0')
if ($env:VERBOSE -ne '0') {
    $env:DEBUG = '*'
    if (-not $env:NODE_OPTIONS) { $env:NODE_OPTIONS = '' }
    $env:NODE_OPTIONS += ' --trace-warnings'
    $Preference.InformationPreference = 'Continue'
}

Write-Host '==> Installing dependencies'
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run vendor
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Starting touchsight-NG ($Mode)"
Invoke-Expression $runCmd
exit $LASTEXITCODE