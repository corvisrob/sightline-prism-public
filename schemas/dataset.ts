import { z } from 'zod';

/**
 * Dataset Types
 * 
 * - connected: Data from connectors (Azure, CrowdStrike, Jira, etc.) - read-only source data
 * - synthetic: Merged/consolidated data created by sync operations - can be source or target
 */

export const DatasetTypeSchema = z.enum(['connected', 'synthetic']);

export type DatasetType = z.infer<typeof DatasetTypeSchema>;

/**
 * Field Metadata
 * 
 * Tracks the provenance and priority of each field value in a synthetic dataset.
 * Only applies to synthetic datasets (connected datasets don't have field metadata).
 */

export const FieldMetadataSchema = z.object({
  value: z.any().describe('The actual field value'),
  lastUpdated: z.string().datetime().describe('When this field was last updated'),
  lastUpdateSource: z.string().describe('Dataset that provided this value (e.g., "crowdstrike", "azure-vms")'),
  lastUpdatePriority: z.number().describe('Priority of the source that provided this value'),
  lastUpdateChangesetId: z.string().optional().describe('ID of changeset that applied this value'),
});

export type FieldMetadata = z.infer<typeof FieldMetadataSchema>;

/**
 * Dataset Metadata
 * 
 * Metadata about the dataset itself - applies to both connected and synthetic.
 */

export const DatasetMetadataSchema = z.object({
  id: z.string().describe('Unique dataset identifier'),
  name: z.string().describe('Human-readable dataset name'),
  type: DatasetTypeSchema,
  schemaName: z.string().describe('Schema type (e.g., "AssetComputer", "AssetNetwork")'),
  schemaVersion: z.number().describe('Schema version'),
  
  createdAt: z.string().datetime().describe('When this dataset was first created'),
  updatedAt: z.string().datetime().describe('When this dataset was last updated'),
  
  // For synthetic datasets: which datasets contributed
  sources: z.array(z.string()).optional().describe('Source dataset IDs that contributed to this synthetic dataset'),
  
  // For connected datasets: connector information
  connectorId: z.string().optional().describe('Connector ID (e.g., "azure-vms", "crowdstrike")'),
  
  description: z.string().optional().describe('Dataset description'),
});

export const DatasetMetadataSchemaV1 = DatasetMetadataSchema;

export type DatasetMetadata = z.infer<typeof DatasetMetadataSchema>;

/**
 * Dataset Asset (for synthetic datasets)
 * 
 * Assets in synthetic datasets include field-level metadata for tracking.
 * Connected datasets don't use this wrapper - they store plain normalized data.
 */

export const DatasetAssetMetadataSchema = z.object({
  createdAt: z.string().datetime().describe('When this asset was first created in the dataset'),
  updatedAt: z.string().datetime().describe('When this asset was last updated'),
  sources: z.array(z.string()).describe('List of source datasets that have contributed data'),
  fieldCount: z.number().describe('Total number of fields with data'),
  lastSyncedAt: z.record(z.string(), z.string().datetime()).optional().describe('Last sync timestamp per source'),
});

export const DatasetAssetSchema = z.object({
  id: z.string().describe('Unique asset identifier'),
  schemaName: z.string().describe('Schema type (e.g., "AssetComputer")'),
  schemaVersion: z.number().describe('Schema version'),
  
  assetMetadata: DatasetAssetMetadataSchema,
  
  // The data field contains the normalized asset data
  // Each field is wrapped in FieldMetadata structure (for synthetic datasets)
  // Schema validation happens on the unwrapped values
  data: z.record(z.string(), z.any()).describe('Asset data with field-level metadata'),
});

export const DatasetAssetSchemaV1 = DatasetAssetSchema;

export type DatasetAsset = z.infer<typeof DatasetAssetSchema>;
export type DatasetAssetMetadata = z.infer<typeof DatasetAssetMetadataSchema>;

/**
 * Helper function to extract plain data from dataset asset (without metadata)
 */
export function extractPlainData(datasetAsset: DatasetAsset): Record<string, any> {
  const plain: Record<string, any> = {
    id: datasetAsset.id,
    schemaVersion: datasetAsset.schemaVersion,
  };
  
  for (const [key, value] of Object.entries(datasetAsset.data)) {
    if (typeof value === 'object' && value !== null && 'value' in value) {
      plain[key] = value.value;
    } else {
      plain[key] = value;
    }
  }
  
  return plain;
}

/**
 * Helper function to wrap plain data as dataset asset with metadata
 */
export function wrapWithMetadata(
  plainData: Record<string, any>,
  schemaName: string,
  sourceDataset: string,
  priority: number,
  changesetId?: string
): DatasetAsset {
  const now = new Date().toISOString();
  
  const data: Record<string, FieldMetadata> = {};
  
  for (const [key, value] of Object.entries(plainData)) {
    if (key === 'id' || key === 'schemaVersion') continue;
    
    data[key] = {
      value,
      lastUpdated: now,
      lastUpdateSource: sourceDataset,
      lastUpdatePriority: priority,
      lastUpdateChangesetId: changesetId,
    };
  }
  
  return {
    id: plainData.id,
    schemaName,
    schemaVersion: plainData.schemaVersion || 1,
    assetMetadata: {
      createdAt: now,
      updatedAt: now,
      sources: [sourceDataset],
      fieldCount: Object.keys(data).length,
      lastSyncedAt: { [sourceDataset]: now },
    },
    data,
  };
}

/**
 * Example connected dataset metadata:
 * 
 * {
 *   id: "ds-azure-vms-prod",
 *   name: "Azure VMs Production",
 *   type: "connected",
 *   schemaName: "AssetComputer",
 *   schemaVersion: 1,
 *   createdAt: "2026-01-01T00:00:00Z",
 *   updatedAt: "2026-02-27T10:00:00Z",
 *   connectorId: "azure-vms",
 *   description: "Azure virtual machines from production subscription"
 * }
 * 
 * Example synthetic dataset metadata:
 * 
 * {
 *   id: "ds-consolidated-assets",
 *   name: "Consolidated Asset Inventory",
 *   type: "synthetic",
 *   schemaName: "AssetComputer",
 *   schemaVersion: 1,
 *   createdAt: "2026-01-01T00:00:00Z",
 *   updatedAt: "2026-02-27T10:00:00Z",
 *   sources: ["ds-azure-vms-prod", "ds-crowdstrike-endpoints", "ds-jira-cmdb"],
 *   description: "Merged asset data from Azure, CrowdStrike, and Jira"
 * }
 */
