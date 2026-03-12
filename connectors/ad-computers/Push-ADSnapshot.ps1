#Requires -Modules powershell-yaml, Mdbc

<#
.SYNOPSIS
    Pushes an AD computers YAML snapshot directly to MongoDB.

.DESCRIPTION
    Reads a YAML snapshot file produced by Collect-ADComputers.ps1, converts it
    to the Prism snapshot document structure, and inserts it into MongoDB.

    This replaces the TypeScript import-snapshot.ts — no Node.js required.

    Prerequisites:
      - powershell-yaml module (Install-Module powershell-yaml)
      - Mdbc module (Install-Module Mdbc)

.PARAMETER YamlPath
    Path to the YAML snapshot file. If omitted, finds the most recent
    ad-computers-snapshot-*.yaml file in the script directory.

.PARAMETER MongoUri
    MongoDB connection string. Defaults to $env:MONGODB_URI or
    mongodb://localhost:27017 if not set.

.PARAMETER Database
    MongoDB database name. Defaults to $env:MONGODB_DB or 'prism'.

.PARAMETER Collection
    MongoDB collection name. Defaults to 'snapshots_ad-computers'.

.EXAMPLE
    .\Push-ADSnapshot.ps1
    Finds the latest snapshot YAML in the script directory and pushes to MongoDB.

.EXAMPLE
    .\Push-ADSnapshot.ps1 -YamlPath C:\exports\ad-computers-snapshot-20260311-093000.yaml
    Pushes a specific snapshot file.

.EXAMPLE
    .\Push-ADSnapshot.ps1 -MongoUri "mongodb://<user>:<pass>@<host1>:27017,<host2>:27017,<host3>:27017/?ssl=true&replicaSet=<replica-set>&authSource=admin&appName=<app>" -Database prism
    Pushes using an explicit Atlas replica set connection string.
#>

[CmdletBinding()]
param(
    [string]$YamlPath,

    [string]$MongoUri,

    [string]$Database,

    [string]$Collection = 'snapshots_ad-computers'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------

foreach ($mod in @('powershell-yaml', 'Mdbc')) {
    if (-not (Get-Module -ListAvailable -Name $mod)) {
        Write-Error @"
The '$mod' module is required but not installed.
Install it with:  Install-Module $mod -Scope CurrentUser
"@
        exit 1
    }
}

Import-Module powershell-yaml -ErrorAction Stop
Import-Module Mdbc -ErrorAction Stop

# ---------------------------------------------------------------------------
# Resolve parameters
# ---------------------------------------------------------------------------

if (-not $MongoUri) {
    # Atlas replica set format: mongodb://<user>:<pass>@<host1>:27017,<host2>:27017,<host3>:27017/?ssl=true&replicaSet=<name>&authSource=admin&appName=<app>
    $MongoUri = if ($env:MONGODB_URI) { $env:MONGODB_URI } else { 'mongodb://localhost:27017' }
}

if (-not $Database) {
    $Database = if ($env:MONGODB_DB) { $env:MONGODB_DB } else { 'prism' }
}

# ---------------------------------------------------------------------------
# Find snapshot file
# ---------------------------------------------------------------------------

if (-not $YamlPath) {
    $candidates = @(Get-ChildItem -Path $PSScriptRoot -Filter 'ad-computers-snapshot-*.yaml' |
        Sort-Object LastWriteTime -Descending)
    if ($candidates.Count -eq 0) {
        Write-Error "No snapshot YAML files found in $PSScriptRoot. Run Collect-ADComputers.ps1 first."
        exit 1
    }
    $YamlPath = $candidates[0].FullName
    Write-Host "Using most recent snapshot: $YamlPath" -ForegroundColor Cyan
}

if (-not (Test-Path $YamlPath)) {
    Write-Error "File not found: $YamlPath"
    exit 1
}

# ---------------------------------------------------------------------------
# Parse YAML
# ---------------------------------------------------------------------------

$startTime = Get-Date

Write-Host "Starting AD computers snapshot push..." -ForegroundColor Cyan
Write-Host "  File:       $YamlPath"
Write-Host "  MongoDB:    $($MongoUri -replace '://[^@]+@', '://***@')"
Write-Host "  Database:   $Database"
Write-Host "  Collection: $Collection"

Write-Host "  Parsing YAML..."
$yamlContent = Get-Content -Path $YamlPath -Raw -Encoding UTF8
$snapshot = ConvertFrom-Yaml $yamlContent

if (-not $snapshot -or $snapshot -isnot [hashtable]) {
    Write-Error "Invalid YAML: expected a snapshot object at the top level."
    exit 1
}

$assets = @($snapshot['data'])
if ($assets.Count -eq 0) {
    Write-Error 'Invalid snapshot: "data" field is missing or empty.'
    exit 1
}

Write-Host "  Found $($assets.Count) asset(s) in snapshot"

# ---------------------------------------------------------------------------
# Build the MongoDB document
# ---------------------------------------------------------------------------

# Use the snapshot time from the YAML, or current time as fallback
$snapshotTime = if ($snapshot['snapshotTime']) {
    [DateTime]::Parse($snapshot['snapshotTime']).ToUniversalTime()
} else {
    (Get-Date).ToUniversalTime()
}

$collectionDuration = [int]((Get-Date) - $startTime).TotalMilliseconds

$document = @{
    snapshotTime  = $snapshotTime
    schemaName    = if ($snapshot['schemaName'])    { $snapshot['schemaName'] }    else { 'AssetComputer' }
    schemaVersion = if ($snapshot['schemaVersion']) { $snapshot['schemaVersion'] } else { 1 }
    source        = if ($snapshot['source'])        { $snapshot['source'] }        else { 'ad-computers' }
    data          = @($assets)
    metadata      = @{
        totalItems         = $assets.Count
        validItems         = $assets.Count
        invalidItems       = 0
        collectionDuration = $collectionDuration
    }
}

# Preserve original metadata if present in the YAML
if ($snapshot['metadata']) {
    $origMeta = $snapshot['metadata']
    if ($origMeta['totalItems'])         { $document.metadata.totalItems         = $origMeta['totalItems'] }
    if ($origMeta['validItems'])         { $document.metadata.validItems         = $origMeta['validItems'] }
    if ($origMeta['invalidItems'])       { $document.metadata.invalidItems       = $origMeta['invalidItems'] }
    if ($origMeta['collectionDuration']) { $document.metadata.collectionDuration = $origMeta['collectionDuration'] }
}

# ---------------------------------------------------------------------------
# Insert into MongoDB
# ---------------------------------------------------------------------------

Write-Host "  Connecting to MongoDB..."
Connect-Mdbc $MongoUri $Database $Collection

Write-Host "  Inserting snapshot..."
$bsonDoc = [Mdbc.Dictionary]::new($document)
Add-MdbcData $bsonDoc

$insertedId = $bsonDoc['_id']

$totalSeconds = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)

Write-Host "Push complete!" -ForegroundColor Green
Write-Host "  - Snapshot ID:  $insertedId"
Write-Host "  - Total items:  $($document.metadata.totalItems)"
Write-Host "  - Valid items:  $($document.metadata.validItems)"
Write-Host "  - Duration:     ${totalSeconds}s"
