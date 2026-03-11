# CrowdStrike Falcon Connector

Collects endpoint data from CrowdStrike Falcon API and normalizes it to the `AssetComputer` schema.

## Configuration

Set these environment variables in your `.env` file:

```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=prism

# CrowdStrike API
CROWDSTRIKE_CLIENT_ID=your_client_id
CROWDSTRIKE_CLIENT_SECRET=your_client_secret
CROWDSTRIKE_BASE_URL=https://api.crowdstrike.com
```

## Running Locally

```bash
# Install dependencies
npm install

# Run connector
npm run collect:crowdstrike
```

## Production Setup

### Install HTTP Client

For production use, install axios:

```bash
npm install axios
```

Then update `collect.ts` to use real CrowdStrike API:

```typescript
import axios from 'axios';

async function getAccessToken(): Promise<string> {
  const response = await axios.post(
    `${process.env.CROWDSTRIKE_BASE_URL}/oauth2/token`,
    new URLSearchParams({
      client_id: process.env.CROWDSTRIKE_CLIENT_ID || '',
      client_secret: process.env.CROWDSTRIKE_CLIENT_SECRET || '',
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );
  return response.data.access_token;
}

async function fetchCrowdStrikeHosts(): Promise<CrowdStrikeHost[]> {
  const token = await getAccessToken();
  const baseUrl = process.env.CROWDSTRIKE_BASE_URL;
  
  // Get device IDs
  const idsResponse = await axios.get(
    `${baseUrl}/devices/queries/devices/v1`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { limit: 5000 },
    }
  );
  
  const deviceIds = idsResponse.data.resources;
  
  if (deviceIds.length === 0) {
    return [];
  }
  
  // Get device details (batch up to 5000 IDs)
  const detailsResponse = await axios.post(
    `${baseUrl}/devices/entities/devices/v2`,
    { ids: deviceIds },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  
  return detailsResponse.data.resources;
}
```

### CrowdStrike API Authentication

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

Implement exponential backoff for rate limit errors (HTTP 429):

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
