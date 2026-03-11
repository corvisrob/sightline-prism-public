# Connector Overview

## Available Connectors

### Mock Connectors (Testing/Development)

These connectors generate synthetic data without requiring external services or credentials:

| Connector | Type | Data Generated | Use Case |
|-----------|------|----------------|----------|
| **aws-ec2-mock** | Cloud | 2 EC2 instances with networking, tags | Test AWS VM sync patterns |
| **jira-assets-mock** | CMDB | 15 assets with location, ownership, lifecycle data | Test CMDB business metadata sync |

**Running mock connectors:**
```bash
npx tsx connectors/aws-ec2-mock/collect.ts
npx tsx connectors/jira-assets-mock/collect.ts
```

### Production Connectors (Real APIs)

These connectors integrate with real services and require credentials:

| Connector | Type | API Used | Prerequisites |
|-----------|------|----------|---------------|
| **azure-vms** | Cloud | Azure Resource Manager | Service principal or Azure CLI auth |
| **crowdstrike** | Security | CrowdStrike Falcon API | API client ID/secret |
| **jira-assets** | CMDB | Jira REST API v3 | Jira Cloud instance, API token |
| **agent-cmdb** | Agent | Local system (psutil, platform) | Python 3.8+, psutil, pymongo |

**Setting up production connectors:**

See individual connector READMEs:
- [azure-vms/README.md](azure-vms/README.md)
- [crowdstrike/README.md](crowdstrike/README.md)
- [jira-assets/README.md](jira-assets/README.md)
- [agent-cmdb/README.md](agent-cmdb/README.md)

## Quick Start

### 1. Test with Mock Data (Local)

```bash
# Collect mock data (no setup required)
npx tsx connectors/aws-ec2-mock/collect.ts
npx tsx connectors/jira-assets-mock/collect.ts

# Run sync engine with file-based rules
npx tsx scripts/run-sync.ts aws-mock-to-consolidated
npx tsx scripts/run-sync.ts jira-mock-to-consolidated
```

**Note:** Sync rules are read from `examples/sync-rules/*.json` files. In production, Windmill reads these directly from git - no MongoDB import needed.

### 2. Switch to Production Data

When ready for real data:

1. Configure credentials in `.env` file
2. Run production connector: `npx tsx connectors/<name>/collect.ts`
3. Update sync rule `sourceDataset` field to use real connector name
4. Re-import sync rule to MongoDB
5. Run sync engine with updated rule

Example transition:

```bash
# Was using mock:
sourceDataset: "aws-ec2-mock"

# Switch to real:
sourceDataset: "aws-ec2"  # After implementing real AWS SDK integration

# Or switch to existing production connector:
sourceDataset: "azure-vms"  # Already has real Azure SDK
```

## Creating New Connectors

See [Adding Connectors Guide](../docs/adding-connectors.md) for:
- Connector structure and patterns
- Schema selection
- Snapshot creation
- Testing and validation

## Connector Patterns

### Mock Connector Pattern

```typescript
async function generateMockData(): Promise<MockType[]> {
  // Return array of mock objects
}

function transformToSchema(mock: MockType): TargetSchema {
  // Transform mock to schema
}

async function collect(): Promise<void> {
  const mockData = await generateMockData();
  const assets = mockData.map(transformToSchema);
  
  const snapshotResult = createSnapshot(
    'source-name-mock',  // Add '-mock' suffix
    'SchemaName',
    1,
    assets
  );
  
  const collection = mongoInstance.getCollectionForSource('source-name-mock');
  await mongoInstance.insertSnapshot(collection, snapshotResult.snapshot);
}
```

### Production Connector Pattern

```typescript
async function fetchFromAPI(): Promise<ExternalType[]> {
  // Real API calls with auth
}

function transformToSchema(external: ExternalType): TargetSchema {
  // Transform API response to schema
}

async function collect(): Promise<void> {
  const externalData = await fetchFromAPI();
  const assets = externalData.map(transformToSchema);
  
  const snapshotResult = createSnapshot(
    'source-name',  // No '-mock' suffix
    'SchemaName',
    1,
    assets
  );
  
  const collection = mongoInstance.getCollectionForSource('source-name');
  await mongoInstance.insertSnapshot(collection, snapshotResult.snapshot);
}
```

## Naming Conventions

| Type | Connector Name | Dataset Collection Name | Example |
|------|----------------|------------------------|---------|
| Mock | `<source>-mock/` | `datasets_<source>-mock` | `aws-ec2-mock` → `datasets_aws-ec2-mock` |
| Real | `<source>/` | `datasets_<source>` | `azure-vms` → `datasets_azure_vms` |

## Priority Recommendations

When creating sync rules for connectors:

| Connector Type | Base Priority | Rationale |
|----------------|---------------|-----------|
| Mock connectors | 50-60 | Test data, lowest priority |
| Agent-based (CrowdStrike) | 80-90 | Real-time agent reports, high accuracy |
| Cloud APIs (Azure, AWS) | 70-80 | Authoritative for infrastructure |
| CMDB (Jira Assets) | 60-75 | Good for business context, varies by field |
| Network scanning | 40-50 | Discovery-only data |

Field-specific priorities can be higher than connector base priority:
- `assetTag` from CMDB: Priority 85 (physical ID)
- `lastSeenDate` from agent: Priority 95 (real-time check-in)
- `costCenter` from CMDB: Priority 80 (financial authority)

## See Also

- [Running Sync Engine](../examples/RUNNING_SYNC.md) - Step-by-step sync workflow
- [Data Sync Documentation](../docs/data-sync.md) - Complete sync system reference
- [Example Sync Rules](../examples/sync-rules/) - Pre-configured rules with explanations
