import { z } from 'zod';

/**
 * Master Asset Field Metadata
 * 
 * Extends normalized asset fields with tracking information for sync/merge operations.
 * 
 * Each field in the master dataset includes:
 * - The actual value
 * - When it was last updated
 * - Which source provided it
 * - Priority of that source
 */

export const FieldMetadataSchema = z.object({
  value: z.any().describe('The actual field value'),
  lastUpdated: z.string().datetime().describe('When this field was last updated'),
  lastUpdateSource: z.string().describe('Source that provided this value (e.g., "crowdstrike", "azure-vms")'),
  lastUpdatePriority: z.number().describe('Priority of the source that provided this value'),
  lastUpdateChangesetId: z.string().optional().describe('ID of changeset that applied this value'),
});

export type FieldMetadata = z.infer<typeof FieldMetadataSchema>;

/**
 * Master Asset Schema Extension
 * 
 * Wraps any asset schema (AssetComputer, AssetNetwork, etc.) with master dataset metadata.
 * 
 * Structure:
 * {
 *   id: "srv-001",
 *   schemaName: "AssetComputer",
 *   schemaVersion: 1,
 *   
 *   // Master dataset metadata
 *   masterMetadata: {
 *     createdAt: "2026-01-01T00:00:00Z",
 *     updatedAt: "2026-02-27T10:00:00Z",
 *     sources: ["azure-vms", "crowdstrike"],
 *     fieldCount: 15
 *   },
 *   
 *   // Normalized data with field-level metadata
 *   data: {
 *     // Each field becomes an object with value + metadata
 *     name: {
 *       value: "srv-001",
 *       lastUpdated: "2026-01-01T00:00:00Z",
 *       lastUpdateSource: "azure-vms",
 *       lastUpdatePriority: 80
 *     },
 *     osVersion: {
 *       value: "Ubuntu 22.04",
 *       lastUpdated: "2026-02-27T09:00:00Z",
 *       lastUpdateSource: "azure-vms",
 *       lastUpdatePriority: 80
 *     },
 *     agentVersion: {
 *       value: "7.10.17605.0",
 *       lastUpdated: "2026-02-27T10:00:00Z",
 *       lastUpdateSource: "crowdstrike",
 *       lastUpdatePriority: 90
 *     }
 *   }
 * }
 */

export const MasterAssetMetadataSchema = z.object({
  createdAt: z.string().datetime().describe('When this master asset was first created'),
  updatedAt: z.string().datetime().describe('When this master asset was last updated'),
  sources: z.array(z.string()).describe('List of sources that have contributed data'),
  fieldCount: z.number().describe('Total number of fields with data'),
  lastSyncedAt: z.record(z.string(), z.string().datetime()).optional().describe('Last sync timestamp per source'),
});

export const MasterAssetSchema = z.object({
  id: z.string().describe('Unique asset identifier'),
  schemaName: z.string().describe('Schema type (e.g., "AssetComputer")'),
  schemaVersion: z.number().describe('Schema version'),
  
  masterMetadata: MasterAssetMetadataSchema,
  
  // The data field contains the normalized asset data
  // Each field is wrapped in FieldMetadata structure
  // Schema validation happens on the unwrapped values
  data: z.record(z.string(), z.any()).describe('Asset data with field-level metadata'),
});

export const MasterAssetSchemaV1 = MasterAssetSchema;

export type MasterAsset = z.infer<typeof MasterAssetSchema>;
export type MasterAssetMetadata = z.infer<typeof MasterAssetMetadataSchema>;

/**
 * Helper function to extract plain data from master asset (without metadata)
 */
export function extractPlainData(masterAsset: MasterAsset): Record<string, any> {
  const plain: Record<string, any> = {
    id: masterAsset.id,
    schemaVersion: masterAsset.schemaVersion,
  };
  
  for (const [key, value] of Object.entries(masterAsset.data)) {
    if (typeof value === 'object' && value !== null && 'value' in value) {
      plain[key] = value.value;
    } else {
      plain[key] = value;
    }
  }
  
  return plain;
}

/**
 * Helper function to wrap plain data as master asset with metadata
 */
export function wrapWithMetadata(
  plainData: Record<string, any>,
  schemaName: string,
  source: string,
  priority: number,
  changesetId?: string
): MasterAsset {
  const now = new Date().toISOString();
  const data: Record<string, FieldMetadata> = {};
  
  for (const [key, value] of Object.entries(plainData)) {
    if (key === 'id' || key === 'schemaVersion') continue;
    
    data[key] = {
      value,
      lastUpdated: now,
      lastUpdateSource: source,
      lastUpdatePriority: priority,
      lastUpdateChangesetId: changesetId,
    };
  }
  
  return {
    id: plainData.id,
    schemaName,
    schemaVersion: plainData.schemaVersion || 1,
    masterMetadata: {
      createdAt: now,
      updatedAt: now,
      sources: [source],
      fieldCount: Object.keys(data).length,
      lastSyncedAt: { [source]: now },
    },
    data,
  };
}
