import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import axios from 'axios';
import mongoInstance from '../../lib/mongo.js';
import { createSnapshot } from '../../lib/snapshot.js';
import { createLogger } from '../../lib/logger.js';
import { AssetComputer } from '../../schemas/specific/asset-computer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const logger = createLogger('crowdstrike');

/**
 * CrowdStrike Falcon Collector
 *
 * Collects endpoint data from the CrowdStrike Falcon API and normalizes it to
 * the AssetComputer schema. Authenticates via OAuth2 client credentials, then
 * queries device IDs and fetches device details in batches.
 *
 * The snapshot is written to a local JSON file first, then uploaded to MongoDB.
 * A MongoDB failure is logged as a warning and does not fail the run, so the
 * JSON file is always produced even when the database is unavailable.
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
  
  // Get device details in batches (entities endpoint accepts max 100 IDs per request)
  const hosts: CrowdStrikeHost[] = [];
  const batchSize = 100;
  
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
 * Write the snapshot to a timestamped JSON file under the connector's output/ dir.
 */
function saveSnapshotToFile(snapshot: object): string {
  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outputDir, `crowdstrike-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

/**
 * Main collection function
 */
async function collect(): Promise<void> {
  const startTime = Date.now();

  logger.info('🚀 Starting CrowdStrike collection...');

  try {
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

    // Write JSON snapshot to disk first — always runs, even if MongoDB is down
    const filePath = saveSnapshotToFile(snapshotResult.snapshot);
    logger.info(`💾 Saved snapshot to ${filePath}`);
    logger.info(`   - Total items: ${snapshotResult.snapshot.metadata.totalItems}`);
    logger.info(`   - Valid items: ${snapshotResult.snapshot.metadata.validItems}`);
    logger.info(`   - Duration: ${collectionDuration}ms`);

    // Best-effort upload to MongoDB — a failure is logged but does not fail the run
    try {
      await mongoInstance.connect();
      const collection = mongoInstance.getCollectionForSource('crowdstrike');
      const insertedId = await mongoInstance.insertSnapshot(collection, snapshotResult.snapshot);
      logger.info(`✅ Uploaded to MongoDB (ID: ${insertedId})`);
    } catch (mongoError) {
      logger.warn(`⚠️  MongoDB upload skipped: ${mongoError}`);
    } finally {
      await mongoInstance.disconnect();
    }

    logger.info('✅ Collection complete!');
  } catch (error) {
    logger.error(`❌ Collection failed: ${error}`);
    throw error;
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
