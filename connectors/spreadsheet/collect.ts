import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as yaml from 'js-yaml';
import { ExcelLoader, Mappers } from '../../lib/excel-loader.js';
import mongoInstance from '../../lib/mongo.js';
import { createSnapshot } from '../../lib/snapshot.js';
import { createLogger } from '../../lib/logger.js';

dotenv.config();

const logger = createLogger('spreadsheet');

const SOURCE_ID = 'spreadsheet';

/** Known BaseAsset fields — everything else goes into extendedData */
const BASE_ASSET_FIELDS = new Set([
  'id', 'name', 'type', 'description', 'tags',
  'location', 'owner', 'team', 'contact',
]);

/**
 * Scan a folder for .xlsx files that have a matching .mapping.json.
 *
 * Matching rules:
 * 1. Exact: `Foo.xlsx` → `Foo.mapping.json`
 * 2. Underscore-stripped: `Foo_2025.xlsx` → strip after first `_` → `Foo.mapping.json`
 *
 * Exact match takes priority over the stripped variant.
 *
 * @returns Array of matched { xlsxPath, mappingPath } pairs
 */
export function discoverSpreadsheets(
  folderPath: string,
): Array<{ xlsxPath: string; mappingPath: string }> {
  const entries = fs.readdirSync(folderPath);
  const xlsxFiles = entries.filter(f => f.toLowerCase().endsWith('.xlsx'));
  const results: Array<{ xlsxPath: string; mappingPath: string }> = [];

  for (const xlsxFile of xlsxFiles) {
    const baseName = path.basename(xlsxFile, path.extname(xlsxFile));

    // Try exact match first
    const exactMapping = path.join(folderPath, `${baseName}.mapping.json`);
    if (fs.existsSync(exactMapping)) {
      results.push({
        xlsxPath: path.join(folderPath, xlsxFile),
        mappingPath: exactMapping,
      });
      continue;
    }

    // Try stripping everything after the first underscore
    const underscoreIdx = baseName.indexOf('_');
    if (underscoreIdx > 0) {
      const strippedName = baseName.substring(0, underscoreIdx);
      const strippedMapping = path.join(folderPath, `${strippedName}.mapping.json`);
      if (fs.existsSync(strippedMapping)) {
        results.push({
          xlsxPath: path.join(folderPath, xlsxFile),
          mappingPath: strippedMapping,
        });
        continue;
      }
    }

    logger.warn(`Skipping ${xlsxFile}: no matching .mapping.json found`);
  }

  return results;
}

/**
 * Load an XLSX file using a mapping config and write a YAML intermediate file.
 *
 * @returns The parsed rows (array of objects)
 */
export function loadSpreadsheet(
  xlsxPath: string,
  mappingPath: string,
  yamlPath: string,
): Record<string, any>[] {
  const buffer = fs.readFileSync(xlsxPath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );

  const mappingConfig = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  const loader = new ExcelLoader(arrayBuffer);

  // Build mappers from transformer names
  const mappers: Record<string, (value: any) => any> = {};
  if (mappingConfig.transformers) {
    for (const [key, mapperName] of Object.entries(mappingConfig.transformers)) {
      if (typeof mapperName === 'string' && (Mappers as any)[mapperName]) {
        mappers[key] = (Mappers as any)[mapperName];
      }
    }
  }

  const rows = loader.loadList({
    worksheet: mappingConfig.sheetName,
    columns: mappingConfig.columnMapping,
    startRow: mappingConfig.startRow || 2,
    mappers: Object.keys(mappers).length > 0 ? mappers : undefined,
  });

  // Write YAML intermediate file
  const rootKey = mappingConfig.rootKey || 'assets';
  const yamlContent = yaml.dump(
    { [rootKey]: rows },
    { indent: 2, lineWidth: -1, noRefs: true },
  );
  fs.writeFileSync(yamlPath, yamlContent, 'utf8');

  return rows;
}

/**
 * Transform a flat row object into a BaseAsset-shaped object.
 *
 * Recognised fields are mapped to their BaseAsset positions.
 * Any extra fields are placed in `extendedData`.
 */
export function transformToAsset(
  row: Record<string, any>,
  source: string,
  rowIndex?: number,
): Record<string, any> {
  if (!row.id) {
    const label = rowIndex !== undefined ? `Row ${rowIndex}` : 'Row';
    if (row.name) {
      logger.warn(`${label}: missing 'id' field, auto-generating from name`);
    } else {
      logger.warn(`${label}: missing 'id' and 'name' fields, auto-generating id`);
    }
  }

  const id = row.id
    || row.name?.toString().toLowerCase().replace(/\s+/g, '-')
    || `unknown-${Date.now()}`;

  const extendedData: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!BASE_ASSET_FIELDS.has(key) && value !== undefined && value !== null) {
      extendedData[key] = value;
    }
  }

  return {
    id,
    name: row.name || id,
    type: row.type || 'asset',
    discoveredAt: new Date().toISOString(),
    source,
    schemaVersion: 1,
    description: row.description,
    tags: row.tags,
    location: row.location ? { building: row.location } : undefined,
    ownership: row.owner ? { owner: row.owner } : undefined,
    ...(Object.keys(extendedData).length > 0 ? { extendedData } : {}),
  };
}

/**
 * Main collection function
 *
 * Accepts either:
 * - A folder path → discovers all xlsx+mapping pairs and processes them
 * - A single xlsx file path + optional mapping path (original behaviour)
 */
async function collect(): Promise<void> {
  const inputPath = process.env.SPREADSHEET_FILE || process.argv[2];
  const mappingPath = process.env.SPREADSHEET_MAPPING || process.argv[3];

  if (!inputPath) {
    logger.error('Missing spreadsheet file or folder path');
    logger.error('Usage: npm run collect:spreadsheet -- <folder-or-xlsx> [mapping-file]');
    logger.error('   Or: SPREADSHEET_FILE=path npm run collect:spreadsheet');
    process.exit(1);
  }

  // Folder mode: scan for xlsx + mapping pairs
  if (fs.statSync(inputPath).isDirectory()) {
    const pairs = discoverSpreadsheets(inputPath);
    if (pairs.length === 0) {
      logger.warn(`No spreadsheet+mapping pairs found in ${inputPath}`);
      return;
    }
    logger.info(`Found ${pairs.length} spreadsheet(s) to process in ${inputPath}`);
    for (const pair of pairs) {
      await runCollection(pair.xlsxPath, pair.mappingPath, Date.now());
    }
    return;
  }

  // Single-file mode (original behaviour)
  const startTime = Date.now();

  if (!mappingPath) {
    // Auto-detect: derive mapping filename from xlsx basename
    const dir = path.dirname(inputPath);
    const baseName = (path.basename(inputPath, path.extname(inputPath))
      .match(/^[a-zA-Z]+/)?.[0] || 'default').toLowerCase();
    const autoMapping = path.join(dir, `${baseName}.mapping.json`);

    if (!fs.existsSync(autoMapping)) {
      logger.error(`No mapping file provided and auto-detected path not found: ${autoMapping}`);
      process.exit(1);
    }
    logger.info(`Auto-detected mapping: ${autoMapping}`);
    return runCollection(inputPath, autoMapping, startTime);
  }

  return runCollection(inputPath, mappingPath, startTime);
}

async function runCollection(
  xlsxPath: string,
  mappingPath: string,
  startTime: number,
): Promise<void> {
  logger.info('🚀 Starting spreadsheet collection...');

  try {
    // Derive YAML output path from xlsx path
    const xlsxBasename = path.basename(xlsxPath, path.extname(xlsxPath));
    const yamlPath = path.join(path.dirname(xlsxPath), `${xlsxBasename}.yaml`);

    // Phase 1: Load XLSX → YAML
    logger.info(`📄 Loading spreadsheet: ${xlsxPath}`);
    logger.info(`📋 Using mapping: ${mappingPath}`);
    const rows = loadSpreadsheet(xlsxPath, mappingPath, yamlPath);
    logger.info(`📝 Wrote YAML intermediate: ${yamlPath}`);
    logger.info(`   Loaded ${rows.length} rows`);

    // Phase 2: Transform to BaseAsset
    logger.info('🔄 Transforming to BaseAsset schema...');
    const assets = rows.map((row, i) => transformToAsset(row, SOURCE_ID, i + 1));

    // Phase 3: Create snapshot
    logger.info('📸 Creating snapshot...');
    await mongoInstance.connect();

    const collectionDuration = Date.now() - startTime;
    const snapshotResult = createSnapshot(
      SOURCE_ID,
      'BaseAsset',
      1,
      assets,
      { allowPartialSuccess: true, collectionDuration, logger },
    );

    if (!snapshotResult.success) {
      throw new Error(`Snapshot creation failed: ${snapshotResult.error}`);
    }

    // Phase 4: Insert to MongoDB
    logger.info('💾 Inserting snapshot to MongoDB...');
    const collection = mongoInstance.getCollectionForSource(SOURCE_ID);
    const insertedId = await mongoInstance.insertSnapshot(collection, snapshotResult.snapshot);

    logger.info('✅ Collection complete!');
    logger.info(`   - Snapshot ID: ${insertedId}`);
    logger.info(`   - Total items: ${snapshotResult.snapshot.metadata.totalItems}`);
    logger.info(`   - Valid items: ${snapshotResult.snapshot.metadata.validItems}`);
    logger.info(`   - Duration: ${collectionDuration}ms`);
    logger.info(`   - YAML file: ${yamlPath}`);
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
    .catch((error) => {
      logger.error(`${error}`);
      process.exit(1);
    });
}

export { collect };
