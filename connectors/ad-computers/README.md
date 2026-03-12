# AD Computers Connector

Collects computer objects from Active Directory and pushes snapshots to MongoDB — entirely in PowerShell, no Node.js required.

## Architecture

```
Domain-joined Windows machine
┌──────────────────────────────────┐
│  Collect-ADComputers.ps1         │
│  (PowerShell + RSAT AD)          │
│         │                        │
│         ▼ YAML file              │
│                                  │
│  Push-ADSnapshot.ps1             │
│  (PowerShell + Mdbc)             │
│         │                        │
│         ▼                        │
│    MongoDB                       │
└──────────────────────────────────┘
```

Both scripts can run on the same Windows machine. If the AD machine cannot reach MongoDB directly, copy the YAML file to a machine that can and run `Push-ADSnapshot.ps1` there.

## Prerequisites

- PowerShell 5.1+ or PowerShell 7+
- RSAT Active Directory module:
  ```powershell
  # Windows Server
  Install-WindowsFeature RSAT-AD-PowerShell

  # Windows 10/11
  Add-WindowsCapability -Online -Name Rsat.ActiveDirectory.DS-LDS.Tools~~~~0.0.1.0
  ```
- `powershell-yaml` module:
  ```powershell
  Install-Module powershell-yaml -Scope CurrentUser
  ```
- `Mdbc` module (MongoDB driver for PowerShell):
  ```powershell
  Install-Module Mdbc -Scope CurrentUser
  ```

## Usage

### 1. Collect from AD

```powershell
# All enabled computers in the domain
.\Collect-ADComputers.ps1

# Specific OU
.\Collect-ADComputers.ps1 -SearchBase "OU=Servers,DC=corp,DC=local"

# Custom output path
.\Collect-ADComputers.ps1 -OutputPath C:\exports\ad-snapshot.yaml

# Custom filter (all computers including disabled)
.\Collect-ADComputers.ps1 -Filter '*'
```

Output: `ad-computers-snapshot-<timestamp>.yaml`

### 2. Push to MongoDB

```powershell
# Push the latest snapshot (auto-finds most recent YAML in script directory)
.\Push-ADSnapshot.ps1

# Push a specific file
.\Push-ADSnapshot.ps1 -YamlPath C:\exports\ad-computers-snapshot-20260311-093000.yaml

# Explicit connection settings
.\Push-ADSnapshot.ps1 -MongoUri "mongodb+srv://user:pass@cluster0.example.net" -Database prism
```

Connection defaults:
- `MongoUri`: `$env:MONGODB_URI` or `mongodb://localhost:27017`
- `Database`: `$env:MONGODB_DB` or `prism`
- `Collection`: `snapshots_ad-computers`

### Collect and push in one go

```powershell
.\Collect-ADComputers.ps1 -OutputPath .\snapshot.yaml
.\Push-ADSnapshot.ps1 -YamlPath .\snapshot.yaml
```

## Schema Mapping

| AD Property | AssetComputer Field | Notes |
|---|---|---|
| ObjectGUID | `id` | Stable unique identifier |
| Name | `name`, `hostname` | Computer name |
| DNSHostName | `fqdn` | Fully qualified domain name |
| OperatingSystem | `os` | e.g. "Windows Server 2022 Datacenter" |
| OperatingSystemVersion | `osVersion` | e.g. "10.0 (20348)" |
| IPv4Address | `network[0].ipAddress` | Primary IPv4 |
| Enabled | `status` | `running` if enabled, `stopped` if disabled |
| DistinguishedName | `location.datacenter` | OU path |
| ManagedBy | `ownership.owner` | CN extracted from DN |
| Description | `description` | |
| SID, WhenCreated, WhenChanged, LastLogonDate, MemberOf, ServicePrincipalNames | `extendedData.*` | AD-specific metadata |

## Sync Rules

Recommended priority for AD data in sync rules:

| Field | Priority | Rationale |
|---|---|---|
| `hostname`, `fqdn` | 85 | Authoritative for domain-joined names |
| `os`, `osVersion` | 75 | Good but may lag behind agent-reported |
| `status` | 60 | AD Enabled flag is coarse |
| `ownership` | 70 | ManagedBy is useful but not always set |

## Scheduling

Set up a Windows Scheduled Task to collect and push on a schedule:

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument '-File C:\scripts\Collect-ADComputers.ps1 -OutputPath C:\scripts\snapshot.yaml; C:\scripts\Push-ADSnapshot.ps1 -YamlPath C:\scripts\snapshot.yaml'
$trigger = New-ScheduledTaskTrigger -Daily -At '06:00'
Register-ScheduledTask -TaskName 'Prism-AD-Collection' -Action $action -Trigger $trigger
```
