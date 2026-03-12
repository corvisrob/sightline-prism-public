#Requires -Modules ActiveDirectory

# Update 
<#
.SYNOPSIS
    Collects computer objects from Active Directory and saves a Prism-compatible
    YAML snapshot for manual transport and MongoDB import.

.DESCRIPTION
    Queries the AD domain the local machine is joined to, transforms each
    computer object into the AssetComputer schema, wraps the result in a
    Snapshot document, and writes it as YAML.

    Prerequisites:
      - Windows machine joined to an AD domain
      - RSAT Active Directory module (Install-WindowsFeature RSAT-AD-PowerShell)
      - powershell-yaml module (Install-Module powershell-yaml)

.PARAMETER OutputPath
    Path for the output YAML file. Defaults to
    ./ad-computers-snapshot-<timestamp>.yaml in the script directory.

.PARAMETER SearchBase
    Optional AD search base (OU distinguished name) to limit scope.
    Defaults to the entire domain.

.PARAMETER Filter
    LDAP filter for Get-ADComputer. Defaults to all enabled computers.

.EXAMPLE
    .\Collect-ADComputers.ps1
    Collects all enabled computers from the domain and writes YAML next to the script.

.EXAMPLE
    .\Collect-ADComputers.ps1 -SearchBase "OU=Servers,DC=corp,DC=local" -OutputPath C:\exports\servers.yaml
    Collects computers from a specific OU.
#>

[CmdletBinding()]
param(
    [string]$OutputPath,

    [string]$SearchBase,

    [string]$Filter = 'Enabled -eq $true'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------

if (-not (Get-Module -ListAvailable -Name 'powershell-yaml')) {
    Write-Error @"
The 'powershell-yaml' module is required but not installed.
Install it with:  Install-Module powershell-yaml -Scope CurrentUser
"@
    exit 1
}

Import-Module powershell-yaml -ErrorAction Stop

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

$SOURCE_ID      = 'ad-computers'
$SCHEMA_NAME    = 'AssetComputer'
$SCHEMA_VERSION = 1

# AD properties to retrieve
$AdProperties = @(
    'Name'
    'DNSHostName'
    'OperatingSystem'
    'OperatingSystemVersion'
    'OperatingSystemServicePack'
    'IPv4Address'
    'Enabled'
    'Description'
    'DistinguishedName'
    'ObjectGUID'
    'SID'
    'WhenCreated'
    'WhenChanged'
    'LastLogonDate'
    'MemberOf'
    'Location'
    'ManagedBy'
    'ServicePrincipalNames'
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function ConvertTo-AssetComputer {
    <#
    .SYNOPSIS
        Transforms a single AD computer object into the AssetComputer schema.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [Microsoft.ActiveDirectory.Management.ADComputer]$Computer
    )

    $now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

    # Derive status from Enabled flag
    $status = if ($Computer.Enabled) { 'running' } else { 'stopped' }

    # Parse OU path from DistinguishedName for location context
    $dn = $Computer.DistinguishedName
    $ouParts = @($dn -split ',' |
        Where-Object { $_ -match '^OU=' } |
        ForEach-Object { $_ -replace '^OU=', '' })
    [array]::Reverse($ouParts)
    $ouPath = $ouParts -join '/'

    # Build network array
    $network = @()
    if ($Computer.IPv4Address) {
        $network += @{
            interface = 'eth0'
            ipAddress = $Computer.IPv4Address
            type      = 'physical'
        }
    }

    # Build tags
    $tags = @("source:$SOURCE_ID")
    if ($Computer.OperatingSystem) {
        $osTag = $Computer.OperatingSystem.ToLower() -replace '\s+', '-'
        $tags += "os:$osTag"
    }
    if ($ouPath) {
        $tags += "ou:$ouPath"
    }

    # Build the asset document
    @{
        id              = $Computer.ObjectGUID.ToString()
        name            = $Computer.Name
        type            = 'computer'
        discoveredAt    = $now
        source          = $SOURCE_ID
        schemaVersion   = $SCHEMA_VERSION
        description     = $Computer.Description
        tags            = $tags

        os              = $Computer.OperatingSystem
        osVersion       = $Computer.OperatingSystemVersion
        hostname        = $Computer.Name
        fqdn            = $Computer.DNSHostName
        status          = $status
        network         = $network

        location        = @{
            datacenter = $ouPath
        }

        ownership       = @{
            owner = if ($Computer.ManagedBy) {
                ($Computer.ManagedBy -split ',')[0] -replace '^CN=', ''
            } else {
                $null
            }
        }

        extendedData    = @{
            distinguishedName        = $dn
            sid                      = $Computer.SID.Value
            whenCreated              = $Computer.WhenCreated.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            whenChanged              = $Computer.WhenChanged.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            lastLogonDate            = if ($Computer.LastLogonDate) {
                $Computer.LastLogonDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            } else { $null }
            operatingSystemServicePack = $Computer.OperatingSystemServicePack
            location                 = $Computer.Location
            memberOf                 = @($Computer.MemberOf)
            servicePrincipalNames    = @($Computer.ServicePrincipalNames)
        }
    }
}

function New-Snapshot {
    <#
    .SYNOPSIS
        Wraps an array of assets into the Prism Snapshot document structure.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [array]$Assets,

        [Parameter(Mandatory)]
        [int]$DurationMs
    )

    @{
        snapshotTime  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        schemaName    = $SCHEMA_NAME
        schemaVersion = $SCHEMA_VERSION
        source        = $SOURCE_ID
        data          = $Assets
        metadata      = @{
            totalItems         = $Assets.Count
            validItems         = $Assets.Count
            invalidItems       = 0
            collectionDuration = $DurationMs
        }
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

$startTime = Get-Date

Write-Host "Starting AD computer collection..." -ForegroundColor Cyan

# Build Get-ADComputer parameters
$adParams = @{
    Filter     = $Filter
    Properties = $AdProperties
}
if ($SearchBase) {
    $adParams['SearchBase'] = $SearchBase
    Write-Host "  Search base: $SearchBase"
}

# Query AD
Write-Host "  Querying Active Directory..."
$computers = @(Get-ADComputer @adParams)
Write-Host "  Found $($computers.Count) computer(s)"

if ($computers.Count -eq 0) {
    Write-Warning "No computers matched the filter. Nothing to export."
    exit 0
}

# Transform
Write-Host "  Transforming to AssetComputer schema..."
$assets = foreach ($computer in $computers) {
    ConvertTo-AssetComputer -Computer $computer
}

# Build snapshot
$durationMs = [int]((Get-Date) - $startTime).TotalMilliseconds
$snapshot = New-Snapshot -Assets $assets -DurationMs $durationMs

# Resolve output path
if (-not $OutputPath) {
    $timestamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $OutputPath = Join-Path $PSScriptRoot "ad-computers-snapshot-$timestamp.yaml"
}

# Write YAML
Write-Host "  Writing YAML snapshot to: $OutputPath"
$yamlContent = ConvertTo-Yaml $snapshot -Options EmitDefaults
Set-Content -Path $OutputPath -Value $yamlContent -Encoding UTF8

$endTime = Get-Date
$totalSeconds = [math]::Round(($endTime - $startTime).TotalSeconds, 1)

Write-Host "Collection complete!" -ForegroundColor Green
Write-Host "  - Output:     $OutputPath"
Write-Host "  - Assets:     $($assets.Count)"
Write-Host "  - Duration:   ${totalSeconds}s"
Write-Host ""
Write-Host "To push to MongoDB, run:"
Write-Host "  .\Push-ADSnapshot.ps1 -YamlPath $OutputPath"
