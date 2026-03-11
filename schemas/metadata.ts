import { z, ZodSchema } from 'zod';
import { BaseAssetSchema } from './base/asset.js';
import { BaseSystemSchema } from './base/system.js';
import { BaseFlowSchema } from './base/flow.js';
import { AssetComputerSchemaV1 } from './specific/asset-computer.js';
import { AssetNetworkSchemaV1 } from './specific/asset-network.js';
import { AssetControlDeviceSchemaV1 } from './specific/asset-control-device.js';
import { SyncRuleSchemaV1 } from './sync-rule.js';
import { ChangesetSchemaV1 } from './changeset.js';
import { SnapshotSchemaV1 } from './snapshot.js';
import { DatasetAssetSchemaV1, DatasetMetadataSchemaV1 } from './dataset.js';

/**
 * Schema Registry - Central registry of all versioned schemas
 * 
 * Maps schema names to version-specific schema definitions.
 * Each schema can have multiple versions (v1, v2, v3, etc.)
 */
export const SCHEMA_REGISTRY: Record<string, Record<number, ZodSchema>> = {
  // Base schemas
  'BaseAsset': {
    1: BaseAssetSchema,
  },
  'BaseSystem': {
    1: BaseSystemSchema,
  },
  'BaseFlow': {
    1: BaseFlowSchema,
  },
  
  // Specific asset schemas
  'AssetComputer': {
    1: AssetComputerSchemaV1,
  },
  'AssetNetwork': {
    1: AssetNetworkSchemaV1,
  },
  'AssetControlDevice': {
    1: AssetControlDeviceSchemaV1,
  },
  
  // Sync and merge schemas
  'SyncRule': {
    1: SyncRuleSchemaV1,
  },
  'Changeset': {
    1: ChangesetSchemaV1,
  },
  'Snapshot': {
    1: SnapshotSchemaV1,
  },
  'DatasetAsset': {
    1: DatasetAssetSchemaV1,
  },
  'DatasetMetadata': {
    1: DatasetMetadataSchemaV1,
  },
};

/**
 * Current schema versions
 * 
 * These constants define the latest version for each schema type.
 * Update these when adding new schema versions.
 */
export const CURRENT_VERSIONS = {
  BaseAsset: 1,
  BaseSystem: 1,
  BaseFlow: 1,
  AssetComputer: 1,
  AssetNetwork: 1,
  AssetControlDevice: 1,
  SyncRule: 1,
  Changeset: 1,
  Snapshot: 1,
  DatasetAsset: 1,
  DatasetMetadata: 1,
} as const;

/**
 * Get the latest version number for a schema
 */
export function getLatestVersion(schemaName: string): number {
  return CURRENT_VERSIONS[schemaName as keyof typeof CURRENT_VERSIONS] || 1;
}

/**
 * Get a specific version of a schema
 */
export function getSchema(schemaName: string, version: number): ZodSchema | undefined {
  return SCHEMA_REGISTRY[schemaName]?.[version];
}

/**
 * Validate data against a specific schema version
 * 
 * @param data - The data to validate
 * @param schemaName - Name of the schema (e.g., 'AssetComputer')
 * @param version - Schema version number
 * @returns Validation result with parsed data or error
 */
export function validateWithVersion<T>(
  data: unknown,
  schemaName: string,
  version: number
): { success: true; data: T } | { success: false; error: string } {
  const schema = getSchema(schemaName, version);
  
  if (!schema) {
    return {
      success: false,
      error: `Schema ${schemaName} version ${version} not found`,
    };
  }
  
  try {
    const parsed = schema.parse(data);
    return { success: true, data: parsed as T };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
}

/**
 * Validate data against the latest schema version
 */
export function validateLatest<T>(
  data: unknown,
  schemaName: string
): { success: true; data: T; version: number } | { success: false; error: string } {
  const version = getLatestVersion(schemaName);
  const result = validateWithVersion<T>(data, schemaName, version);
  
  if (result.success) {
    return { ...result, version };
  }
  return result;
}

/**
 * Batch validate multiple items
 * 
 * @returns Object with valid items, errors, and statistics
 */
export function batchValidate<T>(
  items: unknown[],
  schemaName: string,
  version: number
): {
  valid: T[];
  errors: Array<{ index: number; error: string; data: unknown }>;
  stats: { total: number; valid: number; invalid: number };
} {
  const valid: T[] = [];
  const errors: Array<{ index: number; error: string; data: unknown }> = [];
  
  items.forEach((item, index) => {
    const result = validateWithVersion<T>(item, schemaName, version);
    if (result.success) {
      valid.push(result.data);
    } else {
      errors.push({ index, error: result.error, data: item });
    }
  });
  
  return {
    valid,
    errors,
    stats: {
      total: items.length,
      valid: valid.length,
      invalid: errors.length,
    },
  };
}

/**
 * Self-test function to verify all schemas are valid
 * 
 * Run with: tsx schemas/metadata.ts
 */
export function selfTest(): boolean {
  console.log('Running schema self-test...\n');
  
  let allPassed = true;
  
  for (const [schemaName, versions] of Object.entries(SCHEMA_REGISTRY)) {
    for (const [version, schema] of Object.entries(versions)) {
      try {
        // Schemas should be valid Zod objects
        if (!schema || typeof schema.parse !== 'function') {
          console.error(`❌ ${schemaName} v${version}: Invalid schema object`);
          allPassed = false;
          continue;
        }
        console.log(`✅ ${schemaName} v${version}: Valid`);
      } catch (error) {
        console.error(`❌ ${schemaName} v${version}:`, error);
        allPassed = false;
      }
    }
  }
  
  console.log(`\n${allPassed ? '✅ All schemas valid' : '❌ Some schemas failed'}`);
  return allPassed;
}

// Run self-test if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const passed = selfTest();
  process.exit(passed ? 0 : 1);
}
