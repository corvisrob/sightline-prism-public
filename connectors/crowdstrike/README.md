# CrowdStrike Falcon Connector

Collects endpoint data from CrowdStrike Falcon API and normalizes it to the `AssetComputer` schema.

## Configuration

The connector loads its config from a `.env` file **in this folder**
(`connectors/crowdstrike/.env`), not the repo root. This file is gitignored —
copy the values from the Falcon console into it:

```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=prism

# CrowdStrike API
CROWDSTRIKE_CLIENT_ID=your_client_id
CROWDSTRIKE_CLIENT_SECRET=your_client_secret
# Regional base URL — must match your tenant's cloud (US-1 is the default):
#   US-2:     https://api.us-2.crowdstrike.com
#   EU-1:     https://api.eu-1.crowdstrike.com
#   US-GOV-1: https://api.laggar.gcw.crowdstrike.com
CROWDSTRIKE_BASE_URL=https://api.crowdstrike.com
```

## Running Locally

```bash
# Install dependencies
npm install

# Run connector
npm run collect:crowdstrike
```

## Output

Each run produces two outputs, in this order:

1. **JSON file (always written first):** the snapshot is written to
   `connectors/crowdstrike/output/crowdstrike-<timestamp>.json` before any
   database call. This always succeeds, even when MongoDB is unavailable.
2. **MongoDB upload (best effort):** the same snapshot is then inserted into the
   `snapshots_crowdstrike` collection. If MongoDB is down, the failure is logged
   as a warning (`MongoDB upload skipped: …`) and the run still exits successfully
   with the JSON file intact.

The connector calls the real Falcon API directly — it authenticates via OAuth2
client credentials (`/oauth2/token`), queries device IDs from
`/devices/queries/devices/v1`, then fetches device details from
`/devices/entities/devices/v2` in batches of **100 IDs** (the entities endpoint's
per-request limit). `axios` is already a project dependency; no extra install is
needed.

## CrowdStrike API Authentication

1. Create API credentials in CrowdStrike console:
   - Navigate to **Support** → **API Clients and Keys**
   - Click **Add new API client**
   - Select **Read** permissions for **Hosts**
   - Save Client ID and Secret

2. Set environment variables with your credentials

### Required API Scopes

- `Hosts: Read` - Query host information
- `Detections: Read` (optional) - Include detection data

## Data Mapping

### CrowdStrike Host → AssetComputer

| CrowdStrike Field | AssetComputer Field | Notes |
|------------------|-------------------|-------|
| `device_id` | `id` | Unique device identifier |
| `hostname` | `name` + `hostname` | System hostname |
| `platform_name` | `os` | Windows/Linux/Mac |
| `os_version` | `osVersion` | OS version string |
| `local_ip` | `network[].ipAddress` | Primary IP |
| `external_ip` | `network[].ipAddress` | Public IP |
| `status` | `status` | online→running, offline→stopped |
| `agent_version` | `extendedData.crowdstrikeAgentVersion` | Falcon agent version |
| `tags` | `tags` | Custom tags |

### Extended Data

CrowdStrike-specific fields stored in `extendedData`:
- `crowdstrikeDeviceId`: Unique device ID
- `crowdstrikeAgentVersion`: Falcon sensor version
- `crowdstrikeStatus`: online/offline/unknown
- `crowdstrikeConnectionState`: Connection status
- `crowdstrikeDetectionState`: Detection status
- `crowdstrikeLastSeen`: Last check-in timestamp
- `crowdstrikeFirstSeen`: Initial registration
- `crowdstrikePreventionPolicy`: Applied prevention policy
- `crowdstrikeSensorUpdatePolicy`: Sensor update policy
- `crowdstrikeOsBuild`: Detailed OS build
- `crowdstrikeSystemManufacturer`: Hardware manufacturer
- `crowdstrikeSystemProductName`: System model

## Rate Limiting

CrowdStrike API has rate limits:
- 6000 requests per minute per client

The connector already implements exponential backoff for rate-limit errors
(HTTP 429) in `fetchWithRetry`:

```typescript
async function fetchWithRetry(url: string, token: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error.response?.status === 429 && i < retries - 1) {
        const waitTime = Math.pow(2, i) * 1000;
        console.log(`Rate limited, waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
}
```

## Filtering Endpoints

Filter by status, platform, or tags:

```typescript
// Query only online Windows hosts
const idsResponse = await axios.get(
  `${baseUrl}/devices/queries/devices/v1`,
  {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      limit: 5000,
      filter: "platform_name:'Windows'+status:'online'",
    },
  }
);
```

## Output

Creates snapshots in MongoDB collection: `snapshots_crowdstrike`

Each snapshot contains:
- Timestamp
- Schema version
- Array of normalized `AssetComputer` objects
- Metadata (item counts, validation errors, duration)

## Security Considerations

- Store API credentials securely (Windmill resources, vault, etc.)
- Use read-only API credentials
- Rotate credentials regularly
- Monitor API usage in CrowdStrike console
- Enable IP allowlisting if possible

## Windmill Integration

See [../../windmill/templates/crowdstrike-connector.ts](../../windmill/templates/crowdstrike-connector.ts) for Windmill deployment.
