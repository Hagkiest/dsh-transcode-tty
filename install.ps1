<#
.SYNOPSIS
    Install dsh-transcode-tty into a DeepSeek Harness profile.

.DESCRIPTION
    A thin wrapper around scripts/install.mjs, provided because Windows users
    normally start from PowerShell. It resolves the Node executable, refuses to
    run when Node is too old, and forwards every argument unchanged.

    Requires PowerShell 5.1 or later. The execution policy only has to allow
    running a script once:

        powershell -ExecutionPolicy Bypass -File .\install.ps1

.PARAMETER ProfileDir
    Path to the DSH profile directory. Defaults to %USERPROFILE%\.dsh\profiles\desktop.

.PARAMETER Profile
    Profile name, used only when -ProfileDir is not given.

.EXAMPLE
    .\install.ps1

.EXAMPLE
    .\install.ps1 -ProfileDir "D:\dsh\profiles\work"
#>
[CmdletBinding()]
param(
    [string] $ProfileDir,
    [string] $Profile
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$installer = Join-Path $repoRoot 'scripts\install.mjs'

if (-not (Test-Path -LiteralPath $installer)) {
    Write-Error "Cannot find $installer. Run this script from a clone of the repository."
    exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
    Write-Error @'
Node.js was not found on PATH.

Install Node.js 20 or newer from https://nodejs.org and open a new terminal,
then run this script again.
'@
    exit 1
}

$version = (& node --version).TrimStart('v')
$major = [int] ($version.Split('.')[0])
if ($major -lt 20) {
    Write-Error "Node.js $version is too old. This plugin needs Node.js 20 or newer."
    exit 1
}

$arguments = @($installer)
if ($ProfileDir) { $arguments += @('--profile-dir', $ProfileDir) }
if ($Profile) { $arguments += @('--profile', $Profile) }

& node @arguments
exit $LASTEXITCODE
