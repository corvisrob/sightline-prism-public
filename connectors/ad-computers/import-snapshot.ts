#!/usr/bin/env npx tsx
/**
 * Import AD Computers YAML Snapshot into MongoDB
 *
 * Reads a YAML snapshot file produced by Collect-ADComputers.ps1 and inserts
 * it into the prism MongoDB database, validating against AssetComputer schema.
 *
 * Usage:
 *   npx tsx connectors/ad-computers/import-snapshot.ts <yaml-file>
 *
 * Example:
 *   npx tsx connectors/ad-computers/import-snapshot.ts /mnt/share/ad-computers-snapshot-20260311-093000.yaml
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as dotenv from 'dotenv';
import mongoInstance from '../../lib/mongo.js';
import { createSnapshot } from '../../lib/snapshot.js';
import { createLogger } from '../../lib/logger.js';
import type { AssetComputer } from '../../schemas/specific/asset-computer.js';

dotenv.config();

const logger = createLogger('ad-computers');

const SOURCE_ID = 'ad-computers';

async function importSnapshot(yamlPath: string): Promise<void> {
  const startTime = Date.now();

  logger.info('Starting AD computers YAML import...');
  logger.info(`  File: ${yamlPath}`);

  if (!fs.existsSync(yamlPath)) {
    logger.error(`File not found: ${yamlPath}`);
    process.exit(1);
  }

  // Read and parse YAML
  logger.info('Parsing YAML snapshot...');
  const content = fs.readFileSync(yamlPath, 'utf8');
  const raw = yaml.load(content) as Record<string, unknown>;

  if (!raw || typeof raw !== 'object') {
    logger.error('Invalid YAML: expected a snapshot object at the top level');
    process.exit(1);
  }

  // The PowerShell script writes the full snapshot structure
  const assets = raw.data as Record<string, unknown>[];

  if (!Array.isArray(assets)) {
    logger.error('Invalid snapshot: "data" field must be an array of assets');
    process.exit(1);
  }

  logger.info(`  Found ${assets.length} asset(s) in snapshot`);

  // Re-validate and create a proper snapshot through the TypeScript pipeline
  logger.info('Validating against AssetComputer schema...');
  await mongoInstance.connect();

  const collectionDuration = Date.now() - startTime;
  const snapshotResult = createSnapshot<AssetComputer>(
    SOURCE_ID,
    'AssetComputer',
    1,
    assets,
    { allowPartialSuccess: true, collectionDuration, logger },
  );

  if (!snapshotResult.success) {
    throw new Error(`Snapshot validation failed: ${snapshotResult.error}`);
  }

  // Preserve the original snapshot time from the YAML if present
  if (raw.snapshotTime) {
    snapshotResult.snapshot.snapshotTime = new Date(raw.snapshotTime as string);
  }

  // Insert into MongoDB
  logger.info('Inserting snapshot into MongoDB...');
  const collection = mongoInstance.getCollectionForSource(SOURCE_ID);
  const insertedId = await mongoInstance.insertSnapshot(collection, snapshotResult.snapshot);

  logger.info('Import complete!');
  logger.info(`  - Snapshot ID: ${insertedId}`);
  logger.info(`  - Total items: ${snapshotResult.snapshot.metadata.totalItems}`);
  logger.info(`  - Valid items: ${snapshotResult.snapshot.metadata.validItems}`);
  logger.info(`  - Invalid items: ${snapshotResult.snapshot.metadata.invalidItems}`);
  logger.info(`  - Duration: ${Date.now() - startTime}ms`);

  await mongoInstance.disconnect();
}

// CLI entry point
const yamlPath = process.argv[2];

if (!yamlPath) {
  console.error('Usage: npx tsx connectors/ad-computers/import-snapshot.ts <yaml-file>');
  console.error('\nExample:');
  console.error('  npx tsx connectors/ad-computers/import-snapshot.ts ./ad-computers-snapshot-20260311-093000.yaml');
  process.exit(1);
}

importSnapshot(yamlPath)
  .then(() => process.exit(0))
  .catch(error => {
    logger.error(`${error}`);
    process.exit(1);
  });
