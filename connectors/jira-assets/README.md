# Jira Assets Connector

Collects asset data from Jira issues and normalizes to the `BaseAsset` schema.

## Overview

This connector treats Jira issues as asset records. Common use cases:
- **Asset tracking project**: Dedicated Jira project for hardware/software inventory
- **CMDB integration**: Jira as lightweight CMDB
- **IT asset management**: Track laptops, servers, licenses as issues

## Configuration

Set these environment variables in your `.env` file:

```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=prism

# Jira API
JIRA_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your_api_token
JIRA_PROJECT_KEY=ASSET
```

## Jira Setup

### 1. Create Asset Project

1. Create a new Jira project (or use existing)
2. Create issue type "Asset" (or use existing type)

### 2. Configure Custom Fields

Add custom fields for asset properties:

| Field Name | Field Type | Field ID (example) | Purpose |
|-----------|------------|-------------------|---------|
| Asset ID | Text | customfield_10101 | Unique asset identifier |
| Asset Type | Select | customfield_10100 | computer/network/control-device |
| Location | Text | customfield_10102 | Physical location |
| Owner | Text | customfield_10103 | Asset owner/contact |
| IP Address | Text | customfield_10104 | Network address |
| Serial Number | Text | customfield_10105 | Hardware serial |
| Manufacturer | Text | customfield_10106 | Vendor/manufacturer |
| Model | Text | customfield_10107 | Model/SKU |

**Note**: Update `collect.ts` with your actual custom field IDs.

### 3. Get Custom Field IDs

```bash
curl -u email@company.com:api_token \
  https://your-domain.atlassian.net/rest/api/3/field \
  | jq '.[] | select(.name | contains("Asset")) | {name, id}'
```

## Running Locally

```bash
# Install dependencies
npm install

# Run connector
npm run collect:jira-assets
```

## Production Setup

### Install HTTP Client

For production use, install axios:

```bash
npm install axios
```

Then update `collect.ts` to use real Jira API:

```typescript
import axios from 'axios';

async function fetchJiraAssets(): Promise<JiraIssue[]> {
  const jiraUrl = process.env.JIRA_URL;
  const projectKey = process.env.JIRA_PROJECT_KEY || 'ASSET';
  
  const auth = Buffer.from(
    `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
  ).toString('base64');
  
  const issues: JiraIssue[] = [];
  let startAt = 0;
  const maxResults = 100;
  
  // Paginate through all issues
  while (true) {
    const response = await axios.get(
      `${jiraUrl}/rest/api/3/search`,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
        },
        params: {
          jql: `project = ${projectKey} AND issuetype = Asset ORDER BY created DESC`,
          startAt,
          maxResults,
          fields: [
            'summary',
            'description',
            'issuetype',
            'status',
            'labels',
            'created',
            'updated',
            'customfield_10100', // Add your custom field IDs
            'customfield_10101',
            // ... etc
          ],
        },
      }
    );
    
    issues.push(...response.data.issues);
    
    if (response.data.issues.length < maxResults) {
      break; // Last page
    }
    
    startAt += maxResults;
  }
  
  return issues;
}
```

### Jira Authentication

1. **Generate API Token**:
   - Go to https://id.atlassian.com/manage-profile/security/api-tokens
   - Click "Create API token"
   - Save the token securely

2. **Set Environment Variables**:
   ```bash
   JIRA_EMAIL=your-email@company.com
   JIRA_API_TOKEN=your_generated_token
   ```

### JQL Query Customization

Customize the JQL query to filter assets:

```typescript
// Only active assets
jql: `project = ASSET AND status != Retired ORDER BY created DESC`

// Specific asset type
jql: `project = ASSET AND "Asset Type" = computer ORDER BY created DESC`

// Updated in last 30 days
jql: `project = ASSET AND updated >= -30d ORDER BY updated DESC`
```

## Data Mapping

### Jira Issue → BaseAsset

| Jira Field | BaseAsset Field | Notes |
|-----------|----------------|-------|
| `key` | `extendedData.jiraIssueKey` | Issue key (ASSET-101) |
| `fields.summary` | `name` | Issue summary as asset name |
| `fields.description` | `description` | Issue description |
| `fields.labels` | `tags` | Labels as tags |
| `customfield_10101` | `id` | Asset ID custom field |
| `customfield_10100` | `type` | Asset type (computer/network/etc) |
| `customfield_10102` | `location.building` | Location text |
| `customfield_10103` | `ownership.owner` | Owner email/name |

### Extended Data

Jira-specific fields stored in `extendedData`:
- `jiraIssueKey`: Issue key
- `jiraStatus`: Current status
- `jiraIssueType`: Issue type name
- `jiraCreated`: Issue creation date
- `jiraUpdated`: Last updated date
- `jiraIpAddress`: IP address custom field
- `jiraSerialNumber`: Serial number
- `jiraManufacturer`: Manufacturer/vendor
- `jiraModel`: Model number
- `assetStatus`: Normalized status (active/retired/etc)

## Custom Field Mapping

Update the connector to match your Jira instance:

```typescript
// 1. Find your custom field IDs
// Run: curl -u email:token https://your-domain.atlassian.net/rest/api/3/field

// 2. Update interface in collect.ts
interface JiraIssue {
  fields: {
    // ... standard fields
    customfield_XXXXX?: string; // Your actual field ID
  };
}

// 3. Update transform function
const assetId = fields.customfield_XXXXX || issue.key;
```

## Filtering by Asset Type

Route to specific schemas based on asset type:

```typescript
function transformToSpecificSchema(issue: JiraIssue): any {
  const assetType = issue.fields.customfield_10100;
  
  switch (assetType) {
    case 'computer':
      return transformToAssetComputer(issue);
    case 'network':
      return transformToAssetNetwork(issue);
    case 'control-device':
      return transformToAssetControlDevice(issue);
    default:
      return transformToBaseAsset(issue);
  }
}
```

## Output

Creates snapshots in MongoDB collection: `snapshots_jira-assets`

Each snapshot contains:
- Timestamp
- Schema version (typically BaseAsset v1)
- Array of normalized assets
- Metadata (item counts, validation errors, duration)

## Use Cases

### IT Asset Tracking
Track laptops, monitors, peripherals with:
- Assignment tracking (who has what)
- Lifecycle management (requisition → deployment → retirement)
- Warranty and support information

### License Management
Track software licenses as Jira issues:
- License keys
- Seat counts
- Renewal dates
- Cost tracking

### Equipment Inventory
Manufacturing or lab equipment:
- Calibration schedules
- Maintenance history
- Compliance documentation

## Windmill Integration

See [../../windmill/templates/jira-assets-connector.ts](../../windmill/templates/jira-assets-connector.ts) for Windmill deployment.

## Security Considerations

- Use API tokens, not passwords
- Store credentials securely (environment variables, Windmill resources)
- Use read-only Jira permissions if possible
- Rotate API tokens regularly
- Monitor API usage in Jira admin console
