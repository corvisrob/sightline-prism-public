import * as dotenv from 'dotenv';
import mongoInstance from '../../lib/mongo.js';
import { createSnapshot } from '../../lib/snapshot.js';
import { createLogger } from '../../lib/logger.js';
import { AssetComputer } from '../../schemas/specific/asset-computer.js';
import axios from 'axios';

dotenv.config();

const logger = createLogger('crowdstrike');

/**
 * CrowdStrike Falcon Collector
 * 
 * Collects endpoint data from CrowdStrike Falcon API and normalizes to AssetComputer schema.
 * 
 * IMPORTANT: This is a stub implementation. In production, you would:
 * 1. Install axios or node-fetch for HTTP requests
 * 2. Use proper CrowdStrike API credentials (Client ID/Secret)
 * 3. Handle pagination for large endpoint sets
 * 4. Add error handling for API failures and rate limiting
 * 5. Implement OAuth token refresh logic
 * 
 * For now, this demonstrates the collection pattern with mock data.
 */

interface CrowdStrikeHost {
  device_id: string;
  hostname: string;
  local_ip?: string;
  external_ip?: string;
  mac_address?: string;
  platform_name: string;
  os_version: string;
  os_build?: string;
  agent_version: string;
  status: string;
  last_seen: string;
  first_seen: string;
  connection_state?: string;
  detection_state?: string;
  policies?: {
    prevention?: {
      policy_id: string;
      policy_name: string;
    };
    sensor_update?: {
      policy_id: string;
      policy_name: string;
    };
  };
  tags?: string[];
  system_manufacturer?: string;
  system_product_name?: string;
  cpu_signature?: string;
  bios_version?: string;
}

/**
 * Get OAuth2 access token from CrowdStrike
 */
async function getAccessToken(): Promise<string> {
  const clientId = process.env.CROWDSTRIKE_CLIENT_ID;
  const clientSecret = process.env.CROWDSTRIKE_CLIENT_SECRET;
  const baseUrl = process.env.CROWDSTRIKE_BASE_URL || 'https://api.crowdstrike.com';
  
  if (!clientId || !clientSecret) {
    throw new Error('CROWDSTRIKE_CLIENT_ID and CROWDSTRIKE_CLIENT_SECRET are required');
  }
  
  const response = await axios.post(
    `${baseUrl}/oauth2/token`,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );
  
  return response.data.access_token;
}

/**
 * Fetch with retry logic for rate limiting
 */
async function fetchWithRetry<T>(
  url: string,
  token: string,
  params?: any,
  retries = 3
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        params,
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 429 && i < retries - 1) {
        const waitTime = Math.pow(2, i) * 1000;
        logger.warn(`Rate limited, waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * Fetch CrowdStrike hosts using Falcon API
 */
async function fetchCrowdStrikeHosts(): Promise<CrowdStrikeHost[]> {
  const token = await getAccessToken();
  const baseUrl = process.env.CROWDSTRIKE_BASE_URL || 'https://api.crowdstrike.com';
  
  logger.info('Fetching device IDs from CrowdStrike...');
  
  // Get device IDs
  const idsResponse = await fetchWithRetry<any>(
    `${baseUrl}/devices/queries/devices/v1`,
    token,
    { limit: 5000 }
  );
  
  const deviceIds = idsResponse.resources || [];
  
  if (deviceIds.length === 0) {
    logger.info('No devices found');
    return [];
  }
  
  logger.info(`Found ${deviceIds.length} devices, fetching details...`);
  
  // Get device details in batches (API limit is 5000 per request)
  const hosts: CrowdStrikeHost[] = [];
  const batchSize = 5000;
  
  for (let i = 0; i < deviceIds.length; i += batchSize) {
    const batch = deviceIds.slice(i, i + batchSize);
    
    const detailsResponse = await axios.post(
      `${baseUrl}/devices/entities/devices/v2`,
      { ids: batch },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    const devices = detailsResponse.data.resources || [];
    
    for (const device of devices) {
      hosts.push({
        device_id: device.device_id,
        hostname: device.hostname,
        local_ip: device.local_ip,
        external_ip: device.external_ip,
        mac_address: device.mac_address,
        platform_name: device.platform_name,
        os_version: device.os_version,
        os_build: device.os_build,
        agent_version: device.agent_version,
        status: device.status,
        last_seen: device.last_seen,
        first_seen: device.first_seen,
        connection_state: device.connection_state,
        detection_state: device.detection_state,
        policies: device.policies,
        tags: device.tags,
        system_manufacturer: device.system_manufacturer,
        system_product_name: device.system_product_name,
        cpu_signature: device.cpu_signature,
        bios_version: device.bios_version,
      });
    }
  }
  
  return hosts;
}

/**
 * Transform CrowdStrike host to AssetComputer schema
 */
function transformCrowdStrikeToAsset(host: CrowdStrikeHost): Partial<AssetComputer> {
  // Map status to normalized status
  const statusMap: Record<string, 'running' | 'stopped' | 'unknown'> = {
    'online': 'running',
    'offline': 'stopped',
  };
  
  return {
    id: host.device_id,
    name: host.hostname,
    type: 'computer' as const,
    discoveredAt: new Date().toISOString(),
    source: 'crowdstrike',
    schemaVersion: 1,
    description: `CrowdStrike endpoint: ${host.platform_name}`,
    tags: host.tags || [],
    
    // Computer-specific fields
    os: host.platform_name,
    osVersion: host.os_version,
    
    network: [
      ...(host.local_ip ? [{
        interface: 'primary',
        ipAddress: host.local_ip,
        macAddress: host.mac_address,
        type: 'physical' as const,
      }] : []),
      ...(host.external_ip ? [{
        interface: 'external',
        ipAddress: host.external_ip,
        type: 'physical' as const,
      }] : []),
    ],
    
    status: statusMap[host.status.toLowerCase()] || 'unknown',
    hostname: host.hostname,
    
    // CrowdStrike-specific data goes in extendedData
    extendedData: {
      crowdstrikeDeviceId: host.device_id,
      crowdstrikeAgentVersion: host.agent_version,
      crowdstrikeStatus: host.status,
      crowdstrikeConnectionState: host.connection_state,
      crowdstrikeDetectionState: host.detection_state,
      crowdstrikeLastSeen: host.last_seen,
      crowdstrikeFirstSeen: host.first_seen,
      crowdstrikePreventionPolicy: host.policies?.prevention?.policy_name,
      crowdstrikeSensorUpdatePolicy: host.policies?.sensor_update?.policy_name,
      crowdstrikeOsBuild: host.os_build,
      crowdstrikeSystemManufacturer: host.system_manufacturer,
      crowdstrikeSystemProductName: host.system_product_name,
      crowdstrikeCpuSignature: host.cpu_signature,
      crowdstrikeBiosVersion: host.bios_version,
    },
  };
}

/**
 * Main collection function
 */
async function collect(): Promise<void> {
  const startTime = Date.now();
  
  logger.info('🚀 Starting CrowdStrike collection...');
  
  try {
    // Connect to MongoDB
    await mongoInstance.connect();
    
    // Fetch CrowdStrike hosts
    logger.info('📡 Fetching CrowdStrike endpoints...');
    const hosts = await fetchCrowdStrikeHosts();
    logger.info(`Found ${hosts.length} endpoints`);
    
    // Transform to normalized schema
    logger.info('🔄 Transforming to AssetComputer schema...');
    const assets = hosts.map(transformCrowdStrikeToAsset);
    
    // Create snapshot
    logger.info('📸 Creating snapshot...');
    const collectionDuration = Date.now() - startTime;
    const snapshotResult = createSnapshot<AssetComputer>(
      'crowdstrike',
      'AssetComputer',
      1,
      assets,
      { allowPartialSuccess: true, collectionDuration }
    );
    
    if (!snapshotResult.success) {
      throw new Error(`Snapshot creation failed: ${snapshotResult.error}`);
    }
    
    // Insert to MongoDB
    logger.info('💾 Inserting snapshot to MongoDB...');
    const collection = mongoInstance.getCollectionForSource('crowdstrike');
    const insertedId = await mongoInstance.insertSnapshot(collection, snapshotResult.snapshot);
    
    logger.info('✅ Collection complete!');
    logger.info(`   - Snapshot ID: ${insertedId}`);
    logger.info(`   - Total items: ${snapshotResult.snapshot.metadata.totalItems}`);
    logger.info(`   - Valid items: ${snapshotResult.snapshot.metadata.validItems}`);
    logger.info(`   - Duration: ${collectionDuration}ms`);
    
  } catch (error) {
    logger.error(`❌ Collection failed: ${error}`);
    throw error;
  } finally {
    await mongoInstance.disconnect();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  collect()
    .then(() => process.exit(0))
    .catch(error => {
      logger.error(`${error}`);
      process.exit(1);
    });
}

export { collect };
