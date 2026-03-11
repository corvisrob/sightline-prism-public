# AD Computers Connector

Collects computer objects from Active Directory and exports them as YAML snapshots for manual transport into Prism's MongoDB.

## Architecture

```
Domain-joined Windows machine          Prism server
┌──────────────────────────┐          ┌──────────────────────┐
│  Collect-ADComputers.ps1 │          │  import-snapshot.ts  │
│  (PowerShell + RSAT AD)  │──YAML──▶│  (validates + loads) │
│                          │  file    │         │            │
└──────────────────────────┘          │    MongoDB           │
                                      └──────────────────────┘
```

This two-stage approach supports air-gapped or restricted networks where the AD domain controller is not accessible from the Prism server.

## Prerequisites

### Collection machine (Windows, domain-joined)

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

### Import machine (Prism server)

- Node.js 18+
- MongoDB connection configured in `.env`

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

### 2. Transport the YAML file

Copy the YAML file to the Prism server via your preferred method (USB, file share, SCP, etc.).

### 3. Import into MongoDB

```bash
npx tsx connectors/ad-computers/import-snapshot.ts ./ad-computers-snapshot-20260311-093000.yaml
```

The import script:
- Parses the YAML
- Validates each asset against the `AssetComputer` schema
- Creates a snapshot in the `snapshots_ad-computers` collection
- Reports validation errors for any malformed entries

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

Set up a Windows Scheduled Task to run the collection periodically:

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument '-File C:\scripts\Collect-ADComputers.ps1 -OutputPath \\share\prism\ad-snapshot.yaml'
$trigger = New-ScheduledTaskTrigger -Daily -At '06:00'
Register-ScheduledTask -TaskName 'Prism-AD-Collection' -Action $action -Trigger $trigger
```
