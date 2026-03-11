import { validateWithVersion, batchValidate } from '../schemas/metadata.js';
import type { Snapshot } from '../schemas/snapshot.js';
import type { Logger } from './logger.js';

/**
 * Snapshot Document Structure
 * 
 * Standard structure for all snapshot documents stored in MongoDB.
 * Uses Zod schema for validation.
 */
export type SnapshotDocument<T = any> = Omit<Snapshot, 'data'> & { data: T[] };

/**
 * Create a snapshot document
 * 
 * Validates items against the specified schema and creates a standardized
 * snapshot document ready for MongoDB insertion.
 * 
 * @param source - Source identifier (e.g., 'aws-ec2')
 * @param schemaName - Schema name (e.g., 'AssetComputer')
 * @param version - Schema version number
 * @param items - Array of items to validate and include in snapshot
 * @param options - Optional configuration
 * @returns Valid snapshot document or error
 */
export function createSnapshot<T>(
  source: string,
  schemaName: string,
  version: number,
  items: unknown[],
  options: {
    allowPartialSuccess?: boolean; // If true, include valid items even if some are invalid
    collectionDuration?: number;
    logger?: Logger;
  } = {}
): { success: true; snapshot: SnapshotDocument<T> } | { success: false; error: string } {
  // Batch validate all items
  const validation = batchValidate<T>(items, schemaName, version);
  const { logger } = options;

  // Log individual validation errors
  if (logger) {
    for (const err of validation.errors) {
      logger.warn(`Item ${err.index}: ${err.error}`);
    }
  }

  // Determine if snapshot is valid
  const hasErrors = validation.errors.length > 0;
  const shouldFail = hasErrors && !options.allowPartialSuccess;
  
  if (shouldFail) {
    const errorSummary = validation.errors
      .slice(0, 5) // Show first 5 errors
      .map(e => `Item ${e.index}: ${e.error}`)
      .join('; ');

    if (logger) {
      logger.error(`Validation failed: ${validation.stats.invalid} of ${validation.stats.total} items invalid`);
    }

    return {
      success: false,
      error: `Validation failed: ${validation.stats.invalid} of ${validation.stats.total} items invalid. ${errorSummary}`,
    };
  }
  
  // Create snapshot document
  const snapshot: SnapshotDocument<T> = {
    snapshotTime: new Date(),
    schemaName,
    schemaVersion: version,
    source,
    data: validation.valid,
    metadata: {
      totalItems: validation.stats.total,
      validItems: validation.stats.valid,
      invalidItems: validation.stats.invalid,
      collectionDuration: options.collectionDuration,
      errors: hasErrors ? validation.errors.map(e => ({
        index: e.index,
        error: e.error,
      })) : undefined,
    },
  };
  
  if (logger) {
    logger.info(
      `Validation: ${validation.stats.valid} valid, ${validation.stats.invalid} invalid of ${validation.stats.total} total`,
    );
  }

  return { success: true, snapshot };
}

/**
 * Validate a single item against a schema
 * 
 * Helper for ad-hoc validation during collection.
 */
export function validateItem<T>(
  item: unknown,
  schemaName: string,
  version: number
): { success: true; data: T } | { success: false; error: string } {
  return validateWithVersion<T>(item, schemaName, version);
}

/**
 * Extract snapshot metadata without full data
 * 
 * Useful for logging or quick checks without loading all assets.
 */
export function getSnapshotMetadata(snapshot: SnapshotDocument): {
  time: Date;
  source: string;
  schema: string;
  version: number;
  itemCount: number;
  hasErrors: boolean;
} {
  return {
    time: snapshot.snapshotTime,
    source: snapshot.source,
    schema: snapshot.schemaName,
    version: snapshot.schemaVersion,
    itemCount: snapshot.metadata.totalItems,
    hasErrors: snapshot.metadata.invalidItems > 0,
  };
}
