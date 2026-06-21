import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import mongoInstance from '../../lib/mongo.js';
import { createSnapshot } from '../../lib/snapshot.js';
import { createLogger } from '../../lib/logger.js';
import { AssetComputer } from '../../schemas/specific/asset-computer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const logger = createLogger('cylance');

interface AuroraProduct {
  name: string;
  version: string;
  status: string;
}

interface AuroraDevice {
  id: string;
  name: string;
  hostname?: string;
  ip_addresses?: string[];
  mac_addresses?: string[];
  os_version?: string;
  os_kernel_version?: string;
  state?: string;
  is_safe?: boolean;
  agent_version?: string;
  background_detection?: boolean;
  date_first_registered?: string;
  date_offline?: string;
  days_to_deletion?: number;
  dlcm_status?: string;
  policy?: { id: string; name: string };
  products?: AuroraProduct[];
}

interface AuroraDeviceListResponse {
  page_number: number;
  page_size: number;
  total_pages: number;
  total_number_of_items: number;
  page_items: AuroraDevice[];
}

function buildAuthToken(tenantId: string, appId: string, appSecret: string): string {
  return jwt.sign(
    { iss: 'http://cylance.com', tid: tenantId, sub: appId },
    appSecret,
    {
      algorithm: 'HS256',
      expiresIn: 1800,
      jwtid: randomUUID(),
    },
  );
}

async function getAccessToken(baseUrl: string, tenantId: string, appId: string, appSecret: string): Promise<string> {
  const authToken = buildAuthToken(tenantId, appId, appSecret);
  try {
    const response = await axios.post(
      `${baseUrl}/auth/v2/token`,
      { auth_token: authToken },
      { headers: { 'Content-Type': 'application/json' } },
    );
    return response.data.access_token;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Cylance auth failed ${error.response?.status}: ${JSON.stringify(error.response?.data)}`,
      );
    }
    throw error;
  }
}

async function fetchAllDevices(baseUrl: string, accessToken: string, devicesPath: string): Promise<AuroraDevice[]> {
  const devices: AuroraDevice[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    logger.info(`Fetching devices page ${page}/${totalPages}...`);
    const response = await axios.get<AuroraDeviceListResponse | string>(
      `${baseUrl}${devicesPath}`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        params: { page, page_size: 200 },
      },
    );
    const body = response.data;
    if (typeof body === 'string') {
      throw new Error(
        `Devices endpoint returned HTML instead of JSON — wrong API path or domain. ` +
        `Check the Aurora API docs for the correct device listing URL. ` +
        `Response preview: ${body.slice(0, 200)}`
      );
    }
    totalPages = body.total_pages ?? 1;
    devices.push(...(body.page_items ?? []));
    page++;
  } while (page <= totalPages);

  return devices;
}

function toIso(date: string | undefined): string {
  if (!date) return new Date().toISOString();
  const parsed = new Date(date);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function parseOs(osVersion: string): { os: string; osVersion: string } {
  // osVersion is a full string like "Windows 10 Professional, 64-bit" or "macOS 13.2.1"
  if (/^windows/i.test(osVersion)) return { os: 'Windows', osVersion };
  if (/^macos|^mac os/i.test(osVersion)) return { os: 'macOS', osVersion };
  if (/linux|ubuntu|debian|centos|rhel|fedora/i.test(osVersion)) return { os: 'Linux', osVersion };
  return { os: osVersion, osVersion };
}

function transformDevice(device: AuroraDevice): Partial<AssetComputer> {
  const statusMap: Record<string, 'running' | 'stopped' | 'unknown'> = {
    online: 'running',
    offline: 'stopped',
    inactive: 'stopped',
  };

  const { os, osVersion } = parseOs(device.os_version ?? '');

  const ips = device.ip_addresses ?? [];
  const macs = device.mac_addresses ?? [];
  const network = ips.map((ip, idx) => ({
    interface: idx === 0 ? 'primary' : `eth${idx}`,
    ipAddress: ip,
    macAddress: macs[idx],
    type: 'physical' as const,
  }));

  return {
    id: device.id,
    name: device.name,
    type: 'computer' as const,
    discoveredAt: toIso(device.date_first_registered),
    source: 'cylance',
    schemaVersion: 1,
    tags: [],
    os,
    osVersion,
    hostname: device.hostname ?? device.name,
    network,
    status: statusMap[device.state?.toLowerCase() ?? ''] ?? 'unknown',
    extendedData: {
      cylanceAgentVersion: device.agent_version,
      cylanceState: device.state,
      cylanceIsSafe: device.is_safe,
      cylanceOsKernelVersion: device.os_kernel_version,
      cylancePolicyId: device.policy?.id,
      cylancePolicyName: device.policy?.name,
      cylanceProducts: device.products,
      cylanceBackgroundDetection: device.background_detection,
      cylanceDateOffline: device.date_offline,
      cylanceDlcmStatus: device.dlcm_status,
      cylanceDaysToDelection: device.days_to_deletion,
    },
  };
}

function saveSnapshotToFile(snapshot: object): string {
  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outputDir, `cylance-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

async function collect(): Promise<void> {
  const startTime = Date.now();

  const tenantId = process.env.CYLANCE_TENANT_ID?.trim();
  const appId = process.env.CYLANCE_APP_ID?.trim();
  const appSecret = process.env.CYLANCE_APP_SECRET?.trim();
  const baseUrl = (process.env.CYLANCE_BASE_URL ?? 'https://protectapi-au.cylance.com').trim();
  const devicesPath = (process.env.CYLANCE_DEVICES_PATH ?? '/devices/v2/extended').trim();

  if (!tenantId || !appId || !appSecret) {
    throw new Error('CYLANCE_TENANT_ID, CYLANCE_APP_ID, and CYLANCE_APP_SECRET are required');
  }

  logger.info(`Credentials loaded — tenant: ${tenantId.length}ch, app: ${appId.length}ch, secret: ${appSecret.length}ch`);

  logger.info('Starting Cylance collection...');

  try {
    logger.info('Authenticating with Cylance API...');
    const accessToken = await getAccessToken(baseUrl, tenantId, appId, appSecret);

    logger.info(`Fetching Cylance devices from ${devicesPath}...`);
    const devices = await fetchAllDevices(baseUrl, accessToken, devicesPath);
    logger.info(`Found ${devices.length} devices`);

    logger.info('Transforming to AssetComputer schema...');
    const assets = devices.map(transformDevice);

    const collectionDuration = Date.now() - startTime;
    const snapshotResult = createSnapshot<AssetComputer>(
      'cylance',
      'AssetComputer',
      1,
      assets,
      { allowPartialSuccess: true, collectionDuration },
    );

    if (!snapshotResult.success) {
      throw new Error(`Snapshot creation failed: ${snapshotResult.error}`);
    }

    const filePath = saveSnapshotToFile(snapshotResult.snapshot);
    logger.info(`Saved snapshot to ${filePath}`);
    logger.info(`   - Total items: ${snapshotResult.snapshot.metadata.totalItems}`);
    logger.info(`   - Valid items: ${snapshotResult.snapshot.metadata.validItems}`);
    logger.info(`   - Duration: ${collectionDuration}ms`);

    try {
      await mongoInstance.connect();
      const collection = mongoInstance.getCollectionForSource('cylance');
      const insertedId = await mongoInstance.insertSnapshot(collection, snapshotResult.snapshot);
      logger.info(`Uploaded to MongoDB (ID: ${insertedId})`);
    } catch (mongoError) {
      logger.warn(`MongoDB upload skipped: ${mongoError}`);
    } finally {
      await mongoInstance.disconnect();
    }

    logger.info('Collection complete!');
  } catch (error) {
    logger.error(`Collection failed: ${error}`);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  collect()
    .then(() => process.exit(0))
    .catch(error => {
      logger.error(`${error}`);
      process.exit(1);
    });
}

export { collect, buildAuthToken, parseOs, transformDevice };
